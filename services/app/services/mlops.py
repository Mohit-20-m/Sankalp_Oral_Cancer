"""Continuous learning with human control.

* index_model_artifacts(): registers the model in models/current, indexes its reference set (pgvector) and the
  FIXED benchmark (embeddings computed by the running inference service, so numbers match production).
* retrain_head(): trains a new head on reference + specialist-confirmed labels, evaluates candidate vs champion on
  the benchmark, writes a content-addressed dataset snapshot (lineage) and logs to MLflow.
* promote / shadow / rollback: update models/state.json — the inference service hot-reloads heads.
* auto_rollback_check(): if AI-vs-specialist disagreement jumps after a promotion, roll back automatically.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sqlalchemy import delete, func, select

from .. import audit, storage
from ..config import get_settings
from ..models import (BenchmarkItem, Dataset, DatasetSnapshot, ImageResult, Incident, Label, LineageEdge,
                      ModelVersion, ReferenceCase, Review, ScreeningImage, Staff, SystemSetting, TrainingRun)
from ..observability import log
from ..resilience import breaker
from . import inference_client
from .notify import notify_staff


# ───────────────────────── state file (read by inference) ─────────────────────────
def models_root() -> Path:
    return Path(get_settings().models_dir)


def read_state() -> dict:
    p = models_root() / "state.json"
    return json.loads(p.read_text()) if p.exists() else {"active_head": "base", "shadow_head": None}


def write_state(**updates) -> dict:
    st = {**read_state(), **updates, "updated_at": datetime.now(timezone.utc).isoformat()}
    p = models_root() / "state.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=2))
    os.replace(tmp, p)                     # atomic: inference never reads a half-written file
    return st


# ───────────────────────── metrics ─────────────────────────
def _metrics(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    from sklearn.metrics import roc_auc_score

    pred = p >= thr
    tp = int((pred & (y == 1)).sum())
    tn = int((~pred & (y == 0)).sum())
    fp = int((pred & (y == 0)).sum())
    fn = int((~pred & (y == 1)).sum())
    sens = tp / max(1, tp + fn)
    spec = tn / max(1, tn + fp)
    return {"n": int(len(y)), "auc": float(roc_auc_score(y, p)) if len(set(y.tolist())) == 2 else None,
            "threshold": float(thr), "sensitivity": sens, "specificity": spec, "balanced_accuracy": (sens + spec) / 2,
            "accuracy": (tp + tn) / max(1, len(y)), "tp": tp, "tn": tn, "fp": fp, "fn": fn}


def _thresholds(y: np.ndarray, p: np.ndarray, target_sens: float = 0.90) -> dict:
    from sklearn.metrics import roc_curve

    fpr, tpr, thr = roc_curve(y, p)
    thr = np.clip(thr, 0, 1)
    balanced = float(thr[int(np.argmax(tpr - fpr))])
    ok = np.where(tpr >= target_sens)[0]
    screening = float(thr[ok[0]]) if len(ok) else balanced
    return {"balanced": balanced, "screening": min(screening, balanced)}


def _head_probs(head: dict, X: np.ndarray) -> np.ndarray:
    w = np.asarray(head["weights"], np.float32)
    return 1 / (1 + np.exp(-((X @ w + float(head["bias"])) / float(head.get("temperature", 1.0)))))


# ───────────────────────── registry & indexing ─────────────────────────
def current_contract() -> dict:
    return json.loads((models_root() / "current" / "model_contract.json").read_text())


def active_model(s) -> ModelVersion | None:
    return s.execute(select(ModelVersion).where(ModelVersion.status == "active")
                     .order_by(ModelVersion.promoted_at.desc().nullslast())).scalars().first()


def index_model_artifacts(s, force: bool = False) -> dict:
    """Idempotent: register models/current as a ModelVersion and index reference + benchmark sets."""
    cfg = get_settings()
    root = models_root() / "current"
    contract = current_contract()
    version = str(contract["model_version"])
    head = json.loads((root / "head.json").read_text())
    card = json.loads((root / "model_card.json").read_text()) if (root / "model_card.json").exists() else {}
    mv = s.execute(select(ModelVersion).where(ModelVersion.version == version)).scalars().first()
    summary = {"model_version": version, "placeholder": bool(contract.get("placeholder"))}
    if mv is None:
        files = {}
        for name in contract["files"].values():
            p = root / name
            if p.exists():
                key = f"models/{version}/{name}"
                data = p.read_bytes()
                storage.put_bytes(cfg.bucket_models, key, data)
                files[name] = {"key": key, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        for extra in ("model_contract.json", "head.json", "model_card.json"):
            p = root / extra
            if p.exists():
                key = f"models/{version}/{extra}"
                storage.put_bytes(cfg.bucket_models, key, p.read_bytes(), "application/json")
                files[extra] = {"key": key, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                                "bytes": p.stat().st_size}
        for other in s.execute(select(ModelVersion).where(ModelVersion.status.in_(["active", "shadow"]))).scalars():
            other.status, other.retired_at = "retired", datetime.now(timezone.utc)
        mv = ModelVersion(version=version, kind="full", backbone_version=version, status="active",
                          is_placeholder=bool(contract.get("placeholder")), files=files, head=head,
                          contract=contract, card=card, promoted_at=datetime.now(timezone.utc),
                          notes="Registered from models/current at start-up")
        s.add(mv)
        s.flush()
        write_state(active_head="base", shadow_head=None, backbone_version=version)
        audit.record_sync(s, "system", "system", "model.registered", "model_version", version, None,
                          {"placeholder": mv.is_placeholder, "files": list(files)})
        summary["registered"] = True
    # datasets (datasheets) from the model card
    for src, n in ((card.get("training_data") or {}).get("sources") or {}).items():
        if isinstance(n, dict):
            n = sum(v for v in n.values() if isinstance(v, (int, float)))
        if not s.execute(select(Dataset).where(Dataset.name == str(src))).scalars().first():
            s.add(Dataset(name=str(src), licence="unknown — verify before commercial use", commercial_use=False,
                          n_images=int(n) if n else None, description="Imported from the model card"))
    s.flush()
    # reference set
    n_ref = s.execute(select(func.count()).select_from(ReferenceCase)
                      .where(ReferenceCase.backbone_version == version)).scalar()
    ref_dir = root / "reference"
    if (force or n_ref == 0) and (ref_dir / "index.csv").exists():
        s.execute(delete(ReferenceCase).where(ReferenceCase.backbone_version == version,
                                              ReferenceCase.origin == "phase1_reference"))
        normed = np.load(ref_dir / "embeddings.npy", mmap_mode="r")
        raw = (np.load(ref_dir / "embeddings_raw.npy", mmap_mode="r")
               if (ref_dir / "embeddings_raw.npy").exists() else normed)
        datasets = {d.name: d.id for d in s.execute(select(Dataset)).scalars()}
        rows = list(csv.DictReader(open(ref_dir / "index.csv")))
        batch: list = []
        for i, r in enumerate(rows):
            if len(batch) >= 250:            # write in chunks and release them: keeps the worker's memory flat
                s.flush()
                for o in batch:
                    s.expunge(o)
                batch.clear()
                log.info("reference_index_progress", done=i, total=len(rows))
            thumb_key = None
            tp = ref_dir / r["thumbnail"]
            if tp.exists():
                thumb_key = f"reference/{version}/{tp.name}"
                storage.put_bytes(cfg.bucket_derived, thumb_key, tp.read_bytes(), "image/jpeg")
            rc = ReferenceCase(ref_key=f"{version}:{r['ref_id']}", origin="phase1_reference", label=r["label"],
                               source=r.get("source"), dataset_id=datasets.get(r.get("source")),
                               thumbnail_key=thumb_key, backbone_version=version,
                               embedding=np.asarray(normed[i], np.float32),
                               embedding_raw=np.asarray(raw[i], np.float32))
            s.add(rc)
            batch.append(rc)
        s.flush()
        summary["reference_indexed"] = len(rows)
    # benchmark (embeddings from the live inference service = production numbers)
    n_bench = s.execute(select(func.count()).select_from(BenchmarkItem)
                        .where(BenchmarkItem.backbone_version == version)).scalar()
    bdir = root / "benchmark"
    if (force or n_bench == 0) and (bdir / "manifest.csv").exists():
        s.execute(delete(BenchmarkItem).where(BenchmarkItem.backbone_version == version))
        rows = list(csv.DictReader(open(bdir / "manifest.csv")))
        blobs = [(bdir / r["image"]).read_bytes() for r in rows]
        served = inference_client.info().get("model_version")
        if str(served) != version:              # inference still has the old backbone → make it reload
            served = inference_client.reload().get("model_version")
        if str(served) != version:
            raise RuntimeError(f"inference serves {served}, expected {version} — will retry")
        embs = inference_client.embed(blobs)
        for r, data, e in zip(rows, blobs, embs):
            key = f"benchmark/{version}/{Path(r['image']).name}"
            storage.put_bytes(cfg.bucket_models, key, data, "image/jpeg")
            s.add(BenchmarkItem(image_key=key, y=int(r["y"]), source=r.get("source"), backbone_version=version,
                                embedding_raw=e))
        summary["benchmark_indexed"] = len(rows)
        s.flush()
        # score the base head on the benchmark so every later candidate is compared on the same data
        mv.benchmark = evaluate_head_on_benchmark(s, head, version)
    return summary


def evaluate_head_on_benchmark(s, head: dict, backbone_version: str) -> dict | None:
    rows = s.execute(select(BenchmarkItem).where(BenchmarkItem.backbone_version == backbone_version)).scalars().all()
    if not rows:
        return None
    X = np.asarray([np.asarray(r.embedding_raw, np.float32) for r in rows])
    y = np.asarray([r.y for r in rows])
    p = _head_probs(head, X)
    thr = (head.get("thresholds") or {}).get("screening", 0.5)
    return _metrics(y, p, thr)


# ───────────────────────── retraining ─────────────────────────
def _training_pool(s, backbone_version: str, exclude_noncommercial: bool):
    X, y, edges, sources = [], [], [], {}
    q = select(ReferenceCase).where(ReferenceCase.backbone_version == backbone_version)
    if exclude_noncommercial:
        nc = select(Dataset.id).where(Dataset.commercial_use.is_(False))
        q = q.where((ReferenceCase.dataset_id.is_(None)) | (ReferenceCase.dataset_id.not_in(nc)))
    for r in s.execute(q).scalars():
        X.append(np.asarray(r.embedding_raw if r.embedding_raw is not None else r.embedding, np.float32))
        y.append(1 if r.label == "refer" else 0)
        edges.append(("reference", r.ref_key, None, r.dataset_id))
        sources[r.source or "reference"] = sources.get(r.source or "reference", 0) + 1
    labs = s.execute(
        select(Label, ImageResult.embedding, ScreeningImage.patient_id)
        .join(ScreeningImage, ScreeningImage.id == Label.image_id)
        .join(ImageResult, ImageResult.image_id == Label.image_id)
        .where(Label.status == "active", Label.consent_ai_training.is_(True),
               ImageResult.model_version == backbone_version, ImageResult.embedding.isnot(None))
        .order_by(Label.created_at)).all()
    seen = set()
    for lab, emb, pid in labs:
        if lab.image_id in seen:
            continue
        seen.add(lab.image_id)
        X.append(np.asarray(emb, np.float32))
        y.append(1 if lab.label == "refer" else 0)
        edges.append(("label", str(lab.id), pid, None))
        sources["specialist_confirmed"] = sources.get("specialist_confirmed", 0) + 1
    return np.asarray(X), np.asarray(y), edges, sources


def _snapshot(s, X, y, edges, sources, exclude_nc) -> DatasetSnapshot:
    cfg = get_settings()
    buf = io.BytesIO()
    np.savez_compressed(buf, X=X, y=y, ids=np.asarray([e[1] for e in edges]))
    data = buf.getvalue()
    sha = hashlib.sha256(data).hexdigest()
    snap = s.execute(select(DatasetSnapshot).where(DatasetSnapshot.sha256 == sha)).scalars().first()
    if snap:
        return snap
    key = f"datasets/{sha}.npz"
    storage.put_bytes(cfg.bucket_models, key, data)
    snap = DatasetSnapshot(sha256=sha, object_key=key, n_samples=int(len(y)),
                           label_counts={"refer": int(y.sum()), "no_refer": int((1 - y).sum())}, sources=sources,
                           excluded_noncommercial=exclude_nc)
    s.add(snap)
    s.flush()
    for kind, sid, pid, did in edges:
        s.add(LineageEdge(snapshot_id=snap.id, sample_kind=kind, sample_id=str(sid), patient_id=pid, dataset_id=did))
    if cfg.dvc_enabled:
        snap.dvc_rev = _dvc_track(data, sha)
    return snap


def _dvc_track(data: bytes, sha: str) -> str | None:
    """Optional: also version the snapshot with DVC (no-SCM mode, MinIO remote)."""
    import subprocess

    cfg = get_settings()
    work = Path("/tmp/dvc-store")
    work.mkdir(exist_ok=True)
    try:
        if not (work / ".dvc").exists():
            subprocess.run(["dvc", "init", "--no-scm", "-q"], cwd=work, check=True)
            subprocess.run(["dvc", "remote", "add", "-d", "minio", f"s3://{cfg.bucket_models}/dvc"], cwd=work, check=True)
            subprocess.run(["dvc", "remote", "modify", "minio", "endpointurl", cfg.s3_endpoint], cwd=work, check=True)
        (work / f"{sha}.npz").write_bytes(data)
        subprocess.run(["dvc", "add", "-q", f"{sha}.npz"], cwd=work, check=True)
        env = {**os.environ, "AWS_ACCESS_KEY_ID": cfg.s3_access_key, "AWS_SECRET_ACCESS_KEY": cfg.s3_secret_key}
        subprocess.run(["dvc", "push", "-q"], cwd=work, check=True, env=env)
        return (work / f"{sha}.npz.dvc").read_text().split("md5: ")[1].split()[0]
    except Exception as e:  # noqa: BLE001
        log.warning("dvc_track_failed", error=str(e))
        return None


def _mlflow_log(run: TrainingRun, params: dict, metrics: dict, head: dict) -> str | None:
    cfg = get_settings()

    def _do():
        import socket
        from urllib.parse import urlparse

        u = urlparse(cfg.mlflow_tracking_uri)        # fast reachability probe: MLflow's client retries for minutes
        socket.create_connection((u.hostname, u.port or 80), timeout=2).close()
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "10")
        import mlflow

        mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        mlflow.set_experiment("oralscreen-head-retraining")
        with mlflow.start_run(run_name=f"run-{str(run.id)[:8]}") as r:
            mlflow.log_params({k: str(v) for k, v in params.items()})
            mlflow.log_metrics({k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))})
            mlflow.log_dict(head, "head.json")
            return r.info.run_id

    try:
        return breaker("mlflow", 2, 120).call(_do)
    except Exception as e:  # noqa: BLE001 — MLflow is optional (mlops profile)
        log.info("mlflow_unavailable_metrics_kept_in_db", error=str(e)[:120])
        return None


def retrain_head(s, run_id, exclude_noncommercial: bool = False, target_sensitivity: float = 0.90) -> dict:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_predict

    run = s.get(TrainingRun, run_id)
    run.status, run.started_at = "running", datetime.now(timezone.utc)
    s.flush()
    champion = active_model(s)
    backbone = champion.backbone_version if champion else current_contract()["model_version"]
    X, y, edges, sources = _training_pool(s, backbone, exclude_noncommercial)
    if len(y) < 20 or len(set(y.tolist())) < 2:
        raise ValueError(f"not enough labelled data to retrain ({len(y)} samples)")
    cv = StratifiedKFold(n_splits=min(5, int(min(y.sum(), len(y) - y.sum()))), shuffle=True, random_state=0)
    grid = GridSearchCV(LogisticRegression(max_iter=4000, class_weight="balanced"),
                        {"C": [0.01, 0.03, 0.1, 0.3, 1.0, 3.0]}, scoring="roc_auc", cv=cv, n_jobs=1)
    grid.fit(X, y)
    oof = cross_val_predict(grid.best_estimator_, X, y, cv=cv, method="predict_proba")[:, 1]
    thresholds = _thresholds(y, oof, target_sensitivity)
    lr = grid.best_estimator_
    n_versions = s.execute(select(func.count()).select_from(ModelVersion)
                           .where(ModelVersion.backbone_version == backbone, ModelVersion.kind == "head")).scalar()
    version = f"{backbone}+head.{n_versions + 1}"
    head = {"head_version": version, "weights": lr.coef_[0].astype(float).tolist(), "bias": float(lr.intercept_[0]),
            "temperature": 1.0, "embedding_dim": int(X.shape[1]), "thresholds": thresholds}
    cand_b = evaluate_head_on_benchmark(s, head, backbone)
    champ_head = (champion.head if champion else None) or json.loads(
        (models_root() / "current" / "head.json").read_text())
    champ_b = evaluate_head_on_benchmark(s, champ_head, backbone)
    better = bool(cand_b and champ_b and cand_b["auc"] is not None and champ_b["auc"] is not None
                  and cand_b["auc"] >= champ_b["auc"] + 0.002 and cand_b["sensitivity"] >= champ_b["sensitivity"])
    snap = _snapshot(s, X, y, edges, sources, exclude_noncommercial)
    heads_dir = models_root() / "heads"
    heads_dir.mkdir(parents=True, exist_ok=True)
    (heads_dir / f"{version}.json").write_text(json.dumps(head))
    storage.put_bytes(get_settings().bucket_models, f"heads/{version}.json", json.dumps(head).encode(),
                      "application/json")
    mv = ModelVersion(version=version, kind="head", backbone_version=backbone,
                      parent_version=champion.version if champion else None,
                      status="candidate" if better else "rejected", head=head, benchmark=cand_b,
                      training_run_id=run.id, contract=champion.contract if champion else None,
                      notes=("Beats champion on the fixed benchmark — awaiting human approval" if better else
                             "Did not beat the champion on the benchmark (AUC and sensitivity must not drop)"))
    s.add(mv)
    metrics = {"cv_auc": float(grid.best_score_), "train_samples": int(len(y)),
               "candidate_benchmark": cand_b, "champion_benchmark": champ_b, "eligible": better,
               "best_C": grid.best_params_["C"]}
    run.metrics, run.params = metrics, {"C_grid": [0.01, 0.03, 0.1, 0.3, 1.0, 3.0],
                                        "exclude_noncommercial": exclude_noncommercial,
                                        "target_sensitivity": target_sensitivity}
    run.dataset_snapshot_id, run.champion_version, run.candidate_version = snap.id, \
        champion.version if champion else None, version
    run.mlflow_run_id = _mlflow_log(run, {**run.params, "backbone": backbone, "version": version},
                                    {"cv_auc": metrics["cv_auc"], "train_samples": len(y),
                                     **{f"cand_{k}": v for k, v in (cand_b or {}).items() if isinstance(v, float)},
                                     **{f"champ_{k}": v for k, v in (champ_b or {}).items() if isinstance(v, float)}},
                                    head)
    run.status, run.finished_at = "succeeded", datetime.now(timezone.utc)
    audit.record_sync(s, str(run.requested_by or "system"), "system", "model.retrained", "model_version", version,
                      None, {"eligible": better, "snapshot": snap.sha256, "cand": cand_b, "champ": champ_b})
    return {"version": version, "eligible": better, **metrics}


# ───────────────────────── promotion / shadow / rollback ─────────────────────────
def _head_ref(mv: ModelVersion) -> str:
    return "base" if mv.kind == "full" else mv.version


def set_shadow(s, version: str | None, actor) -> dict:
    if version:
        mv = s.execute(select(ModelVersion).where(ModelVersion.version == version)).scalars().one()
        if mv.status not in ("candidate", "shadow"):
            raise ValueError("only candidate versions can run in shadow mode")
        mv.status = "shadow"
    st = write_state(shadow_head=version)
    audit.record_sync(s, actor.user_id, actor.role, "model.shadow", "model_version", version, None, st)
    return st


def promote(s, version: str, actor) -> dict:
    mv = s.execute(select(ModelVersion).where(ModelVersion.version == version)).scalars().one()
    if mv.status not in ("candidate", "shadow", "retired", "rolled_back"):
        raise ValueError(f"cannot promote a version in status '{mv.status}'")
    if mv.status in ("retired", "rolled_back") and mv.backbone_version != (active_model(s).backbone_version
                                                                        if active_model(s) else None):
        raise ValueError("this version uses a different backbone than the one installed — reinstall it first")
    prev = active_model(s)
    if prev:
        prev.status, prev.retired_at = "retired", datetime.now(timezone.utc)
    mv.status, mv.promoted_at, mv.approved_by = "active", datetime.now(timezone.utc), actor.user_id
    st = write_state(active_head=_head_ref(mv), shadow_head=None, previous_active=prev.version if prev else None)
    audit.record_sync(s, actor.user_id, actor.role, "model.promoted", "model_version", version, None,
                      {"previous": prev.version if prev else None})
    return {"active": version, "previous": prev.version if prev else None, "state": st}


def rollback(s, actor, reason: str = "manual rollback") -> dict:
    cur = active_model(s)
    if cur is None:
        raise ValueError("no active model")
    prev = s.execute(select(ModelVersion).where(ModelVersion.status == "retired",
                                                ModelVersion.backbone_version == cur.backbone_version,
                                                ModelVersion.promoted_at.isnot(None))
                     .order_by(ModelVersion.promoted_at.desc())).scalars().first()
    if prev is None:
        raise ValueError("nothing to roll back to")
    cur.status, cur.retired_at, cur.notes = "rolled_back", datetime.now(timezone.utc), reason
    prev.status, prev.promoted_at = "active", datetime.now(timezone.utc)
    st = write_state(active_head=_head_ref(prev), shadow_head=None)
    audit.record_sync(s, getattr(actor, "user_id", "system"), getattr(actor, "role", "system"), "model.rolled_back",
                      "model_version", cur.version, None, {"restored": prev.version, "reason": reason})
    return {"active": prev.version, "rolled_back": cur.version, "state": st}


def disagreement_rate(s, model_version: str, since=None) -> tuple[float | None, int]:
    q = select(Review.ai_agreed).where(Review.model_version == model_version, Review.ai_agreed.isnot(None))
    if since is not None:
        q = q.where(Review.created_at >= since)
    vals = [v for (v,) in s.execute(q).all()]
    if not vals:
        return None, 0
    return 1 - (sum(vals) / len(vals)), len(vals)


def auto_rollback_check(s) -> dict:
    cfg = get_settings()
    cur = active_model(s)
    if cur is None or cur.kind != "head" or not cur.parent_version:
        return {"checked": False}
    rate, n = disagreement_rate(s, cur.version, cur.promoted_at)
    base, n_base = disagreement_rate(s, cur.parent_version)
    if rate is None or n < cfg.auto_rollback_min_reviews or base is None:
        return {"checked": True, "action": "none", "n": n}
    if rate > base + cfg.auto_rollback_margin:
        class _Sys:
            user_id, role = "system", "system"

        res = rollback(s, _Sys, f"auto-rollback: disagreement {rate:.0%} vs baseline {base:.0%} over {n} reviews")
        s.add(Incident(kind="auto_rollback", severity="high", model_version=cur.version, reported_by="system",
                       description=res["rolled_back"] + " rolled back automatically: specialist disagreement "
                                   f"{rate:.0%} vs {base:.0%} baseline ({n} reviews)."))
        for lead in s.execute(select(Staff).where(Staff.role.in_(["clinical_lead", "admin"]))).scalars():
            notify_staff(s, lead.id, "staff_model_alert",
                         detail=f"{cur.version} auto-rolled back (disagreement {rate:.0%} vs {base:.0%}).")
        return {"checked": True, "action": "rolled_back", **res}
    return {"checked": True, "action": "none", "rate": rate, "baseline": base, "n": n}


def get_setting(s, key: str, default=None):
    row = s.get(SystemSetting, key)
    return row.value if row else default
