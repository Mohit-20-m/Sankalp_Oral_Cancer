"""District analytics (de-identified), model registry & MLOps, governance (rules maker-checker, datasheets,
lineage, drift, fairness, incidents)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text

from ...config import get_settings
from ...db import request_session, system_session
from ...domain.decision import RuleSetDef, rule_set_sha
from ...models import (Dataset, DatasetSnapshot, DriftReport, FairnessReport, Incident, LineageEdge, ModelVersion,
                       RuleSet, TrainingRun)
from ...outbox import emit
from ...services import mlops, monitoring
from ...services.rules import invalidate
from ..deps import Ctx, ctx, presign_or_none
from ..schemas import DatasetPatch, IncidentIn, RetrainIn, RuleDecisionIn, RuleProposalIn

router = APIRouter(tags=["analytics, models & governance"])


def _sys(c: Ctx):
    """Aggregate queries run as 'system' AFTER the policy check, and only ever return counts (k-anonymised)."""
    return request_session(c.p.user_id, "system")


def _k(n: int | None) -> int | str | None:
    k = get_settings().k_anonymity_min_cell
    return n if n is None or n == 0 or n >= k else f"<{k}"


# ───────────────────────── district analytics ─────────────────────────
@router.get("/analytics/summary")
async def summary(days: int = 90, c: Ctx = Depends(ctx)):
    await c.can("analytics:read")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with _sys(c) as s:
        by_risk = dict((await s.execute(text("""SELECT coalesce(risk_level,'PENDING'), count(*) FROM screenings
                                               WHERE captured_at >= :since GROUP BY 1"""), {"since": since})).all())
        ref = dict((await s.execute(text("SELECT status, count(*) FROM referrals WHERE created_at >= :since GROUP BY 1"),
                                    {"since": since})).all())
        screened = (await s.execute(text("SELECT count(DISTINCT patient_id) FROM screenings WHERE captured_at >= :since"),
                                    {"since": since})).scalar()
        pop = (await s.execute(text("SELECT coalesce(sum(population),0) FROM villages"))).scalar()
        overdue = (await s.execute(text("""SELECT count(*) FROM referrals WHERE status IN ('pending','booked')
                                           AND due_by < current_date"""))).scalar()
        total_ref = sum(ref.values())
        completed = ref.get("completed", 0)
        return {"window_days": days, "people_screened": screened, "population_covered": pop,
                "coverage_pct": round(100 * screened / pop, 2) if pop else None,
                "screenings_by_risk": {k: _k(v) for k, v in by_risk.items()},
                "referrals_by_status": {k: _k(v) for k, v in ref.items()},
                "referral_completion_rate": round(completed / total_ref, 3) if total_ref else None,
                "referrals_overdue": _k(overdue),
                "privacy": f"de-identified aggregates; cells below {get_settings().k_anonymity_min_cell} suppressed"}


@router.get("/analytics/hotspots")
async def hotspots(days: int = 180, c: Ctx = Depends(ctx)):
    """Village-level high-risk rates for the map (PostGIS), plus DBSCAN clusters of high-risk screenings."""
    await c.can("analytics:read")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with _sys(c) as s:
        rows = (await s.execute(text("""
            SELECT v.id, v.name, v.taluk, v.lat, v.lon, v.population,
                   count(DISTINCT sc.patient_id) AS screened,
                   count(DISTINCT sc.patient_id) FILTER (WHERE sc.risk_level = 'HIGH') AS high
            FROM villages v
            LEFT JOIN patients p ON p.village_id = v.id
            LEFT JOIN screenings sc ON sc.patient_id = p.id AND sc.captured_at >= :since
            GROUP BY v.id ORDER BY high DESC"""), {"since": since})).all()
        clusters = (await s.execute(text("""
            SELECT cid, count(*) AS n, ST_Y(ST_Centroid(ST_Collect(g))) AS lat, ST_X(ST_Centroid(ST_Collect(g))) AS lon
            FROM (SELECT ST_ClusterDBSCAN(geom::geometry, eps := 0.03, minpoints := 3) OVER () AS cid, geom::geometry g
                  FROM screenings WHERE risk_level = 'HIGH' AND geom IS NOT NULL AND captured_at >= :since) t
            WHERE cid IS NOT NULL GROUP BY cid ORDER BY n DESC"""), {"since": since})).all()
        return {"villages": [{"village_id": str(r.id), "name": r.name, "taluk": r.taluk, "lat": r.lat, "lon": r.lon,
                              "screened": _k(r.screened), "high_risk": _k(r.high),
                              "high_risk_rate": round(r.high / r.screened, 3) if r.screened and r.screened >=
                              get_settings().k_anonymity_min_cell else None} for r in rows],
                "high_risk_clusters": [{"cluster": int(r.cid), "screenings": _k(r.n), "lat": r.lat, "lon": r.lon}
                                       for r in clusters]}


@router.get("/analytics/referrals/pending")
async def pending_referrals(c: Ctx = Depends(ctx)):
    await c.can("analytics:read")
    async with _sys(c) as s:
        rows = (await s.execute(text("""
            SELECT f.name AS facility, v.taluk, count(*) AS n,
                   count(*) FILTER (WHERE r.due_by < current_date) AS overdue
            FROM referrals r JOIN facilities f ON f.id = r.facility_id
            JOIN patients p ON p.id = r.patient_id LEFT JOIN villages v ON v.id = p.village_id
            WHERE r.status IN ('pending','booked') GROUP BY 1, 2 ORDER BY overdue DESC"""))).all()
        return [{"facility": r.facility, "taluk": r.taluk, "pending": _k(r.n), "overdue": _k(r.overdue)} for r in rows]


# ───────────────────────── models / MLOps ─────────────────────────
def _mv_out(m: ModelVersion) -> dict:
    return {"version": m.version, "kind": m.kind, "status": m.status, "backbone_version": m.backbone_version,
            "parent_version": m.parent_version, "placeholder": m.is_placeholder, "benchmark": m.benchmark,
            "created_at": m.created_at, "promoted_at": m.promoted_at, "notes": m.notes,
            "thresholds": (m.head or {}).get("thresholds")}


@router.get("/models")
async def models(c: Ctx = Depends(ctx)):
    await c.can("model:read")
    async with _sys(c) as s:
        return [_mv_out(m) for m in (await s.execute(select(ModelVersion)
                                                     .order_by(ModelVersion.created_at))).scalars()]


@router.get("/models/performance")
async def performance(c: Ctx = Depends(ctx)):
    """Data for the 'Model Performance' page: every version scored on the SAME fixed benchmark."""
    await c.can("model:read")
    async with _sys(c) as s:
        vs = (await s.execute(select(ModelVersion).order_by(ModelVersion.created_at))).scalars().all()
        runs = {r.candidate_version: r for r in (await s.execute(select(TrainingRun))).scalars()}
        return [{"version": m.version, "status": m.status, "created_at": m.created_at,
                 "auc": (m.benchmark or {}).get("auc"), "sensitivity": (m.benchmark or {}).get("sensitivity"),
                 "specificity": (m.benchmark or {}).get("specificity"),
                 "balanced_accuracy": (m.benchmark or {}).get("balanced_accuracy"),
                 "confusion": {k: (m.benchmark or {}).get(k) for k in ("tp", "fp", "tn", "fn")},
                 "training_samples": (runs[m.version].metrics or {}).get("train_samples") if m.version in runs else None}
                for m in vs]


@router.get("/models/manifest")
async def manifest(c: Ctx = Depends(ctx)):
    """For the phone: which model to download for offline use (files, sha256, short-lived URLs)."""
    await c.can("model:read")
    cfg = get_settings()
    async with _sys(c) as s:
        m = await s.run_sync(mlops.active_model)
        if m is None:
            raise HTTPException(404, "no active model")
        base = m if m.kind == "full" else (await s.execute(select(ModelVersion).where(
            ModelVersion.version == m.backbone_version))).scalars().first()
        files = {}
        for name, meta in ((base.files if base else {}) or {}).items():
            files[name] = {**meta, "url": presign_or_none(cfg.bucket_models, meta["key"], 3600)}
        return {"active_version": m.version, "backbone_version": m.backbone_version, "placeholder": m.is_placeholder,
                "head": m.head, "files": files,
                "instructions": "Download backbone (int8 if listed) + head; verify sha256 before loading; keep the "
                                "previous version if verification fails."}


@router.post("/models/retrain", status_code=202)
async def retrain(body: RetrainIn, c: Ctx = Depends(ctx)):
    await c.can("model:retrain")
    async with _sys(c) as s:
        run = TrainingRun(trigger="manual", requested_by=uuid.UUID(c.p.user_id),
                          params={"exclude_noncommercial": body.exclude_noncommercial})
        s.add(run)
        await s.flush()
        await emit(s, "model.retrain", {"run_id": str(run.id), "exclude_noncommercial": body.exclude_noncommercial},
                   dedupe_key=f"retrain:{run.id}")
        await c.audit(s, "model.retrain_requested", "training_run", run.id)
        return {"run_id": str(run.id), "status": "queued"}


@router.get("/models/runs")
async def runs(c: Ctx = Depends(ctx)):
    await c.can("model:read")
    async with _sys(c) as s:
        rs = (await s.execute(select(TrainingRun).order_by(TrainingRun.created_at.desc()).limit(50))).scalars()
        return [{"id": str(r.id), "trigger": r.trigger, "status": r.status, "created_at": r.created_at,
                 "finished_at": r.finished_at, "candidate_version": r.candidate_version,
                 "champion_version": r.champion_version, "metrics": r.metrics, "error": r.error,
                 "mlflow_run_id": r.mlflow_run_id} for r in rs]


@router.post("/models/{version}/shadow")
async def shadow(version: str, c: Ctx = Depends(ctx)):
    await c.can("model:shadow")
    async with _sys(c) as s:
        try:
            return await s.run_sync(lambda ss: mlops.set_shadow(ss, version, c.p))
        except ValueError as e:
            raise HTTPException(409, str(e)) from e


@router.delete("/models/shadow")
async def shadow_off(c: Ctx = Depends(ctx)):
    await c.can("model:shadow")
    async with _sys(c) as s:
        return await s.run_sync(lambda ss: mlops.set_shadow(ss, None, c.p))


@router.post("/models/{version}/promote")
async def promote(version: str, c: Ctx = Depends(ctx)):
    """Human approval gate: nothing goes live automatically, even if it scores better."""
    await c.can("model:promote")
    async with _sys(c) as s:
        try:
            return await s.run_sync(lambda ss: mlops.promote(ss, version, c.p))
        except ValueError as e:
            raise HTTPException(409, str(e)) from e


@router.post("/models/rollback")
async def rollback(c: Ctx = Depends(ctx)):
    await c.can("model:rollback")
    async with _sys(c) as s:
        try:
            return await s.run_sync(lambda ss: mlops.rollback(ss, c.p, f"manual rollback by {c.p.username}"))
        except ValueError as e:
            raise HTTPException(409, str(e)) from e


@router.post("/models/reindex", status_code=202)
async def reindex(c: Ctx = Depends(ctx)):
    """After installing a new model into models/current: re-register + re-index reference/benchmark."""
    await c.can("model:retrain")
    async with _sys(c) as s:
        await emit(s, "model.index", {"force": True}, dedupe_key=f"index:{datetime.now(timezone.utc):%Y%m%d%H%M%S}")
        return {"status": "queued"}


@router.get("/models/{version}/card")
async def card(version: str, c: Ctx = Depends(ctx)):
    await c.can("model:read")
    async with _sys(c) as s:
        m = (await s.execute(select(ModelVersion).where(ModelVersion.version == version))).scalars().first()
        if m is None:
            raise HTTPException(404, "unknown version")
        base_card = m.card
        if base_card is None:
            base = (await s.execute(select(ModelVersion).where(ModelVersion.version == m.backbone_version))
                    ).scalars().first()
            base_card = base.card if base else {}
        return {"version": m.version, "status": m.status, "card": base_card, "benchmark": m.benchmark,
                "contract": m.contract, "head_thresholds": (m.head or {}).get("thresholds")}


# ───────────────────────── rules (maker-checker) ─────────────────────────
def _rs_out(r: RuleSet) -> dict:
    return {"version": r.version, "status": r.status, "sha256": r.sha256, "rationale": r.rationale,
            "proposed_by": str(r.proposed_by) if r.proposed_by else None, "proposed_at": r.proposed_at,
            "reviewed_by": str(r.reviewed_by) if r.reviewed_by else None, "reviewed_at": r.reviewed_at,
            "review_comment": r.review_comment, "activated_at": r.activated_at, "definition": r.definition}


@router.get("/rules")
async def rules(c: Ctx = Depends(ctx)):
    await c.can("rules:read")
    async with _sys(c) as s:
        return [_rs_out(r) for r in (await s.execute(select(RuleSet).order_by(RuleSet.version))).scalars()]


@router.post("/rules", status_code=201)
async def propose_rules(body: RuleProposalIn, c: Ctx = Depends(ctx)):
    await c.can("rules:propose")
    try:
        RuleSetDef.model_validate(body.definition)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"invalid rule set: {e}") from e
    async with _sys(c) as s:
        v = ((await s.execute(select(func.max(RuleSet.version)))).scalar() or 0) + 1
        r = RuleSet(version=v, status="pending_approval", definition=body.definition,
                    sha256=rule_set_sha(body.definition), rationale=body.rationale, proposed_by=uuid.UUID(c.p.user_id))
        s.add(r)
        await s.flush()
        await c.audit(s, "rules.proposed", "rule_set", v, None, {"sha256": r.sha256, "rationale": body.rationale})
        return _rs_out(r)


@router.post("/rules/{version}/approve")
async def approve_rules(version: int, body: RuleDecisionIn, c: Ctx = Depends(ctx)):
    async with _sys(c) as s:
        r = (await s.execute(select(RuleSet).where(RuleSet.version == version))).scalars().first()
        if r is None or r.status != "pending_approval":
            raise HTTPException(409, "rule set is not pending approval")
        await c.can("rules:approve", {"proposed_by": r.proposed_by})          # maker-checker in policy
        for old in (await s.execute(select(RuleSet).where(RuleSet.status == "active"))).scalars():
            old.status = "retired"
        r.status, r.reviewed_by, r.reviewed_at = "active", uuid.UUID(c.p.user_id), datetime.now(timezone.utc)
        r.review_comment, r.activated_at = body.comment, datetime.now(timezone.utc)
        await c.audit(s, "rules.approved", "rule_set", version, None, {"sha256": r.sha256, "comment": body.comment})
    invalidate()
    return {"version": version, "status": "active"}


@router.post("/rules/{version}/reject")
async def reject_rules(version: int, body: RuleDecisionIn, c: Ctx = Depends(ctx)):
    async with _sys(c) as s:
        r = (await s.execute(select(RuleSet).where(RuleSet.version == version))).scalars().first()
        if r is None or r.status != "pending_approval":
            raise HTTPException(409, "rule set is not pending approval")
        await c.can("rules:approve", {"proposed_by": r.proposed_by})
        r.status, r.reviewed_by, r.reviewed_at, r.review_comment = "rejected", uuid.UUID(c.p.user_id), \
            datetime.now(timezone.utc), body.comment
        await c.audit(s, "rules.rejected", "rule_set", version, None, {"comment": body.comment})
        return {"version": version, "status": "rejected"}


# ───────────────────────── datasheets, lineage, drift, fairness, incidents ─────────────────────────
@router.get("/governance/datasets")
async def datasets(c: Ctx = Depends(ctx)):
    await c.can("governance:read")
    async with _sys(c) as s:
        return [{"id": str(d.id), "name": d.name, "licence": d.licence, "commercial_use": d.commercial_use,
                 "n_images": d.n_images, "source_url": d.source_url, "known_issues": d.known_issues,
                 "description": d.description} for d in (await s.execute(select(Dataset))).scalars()]


@router.patch("/governance/datasets/{did}")
async def patch_dataset(did: uuid.UUID, body: DatasetPatch, c: Ctx = Depends(ctx)):
    await c.can("governance:write")
    async with _sys(c) as s:
        d = await s.get(Dataset, did)
        if d is None:
            raise HTTPException(404, "dataset not found")
        changes = body.model_dump(exclude_unset=True)
        for k, v in changes.items():
            setattr(d, k, v)
        await c.audit(s, "dataset.updated", "dataset", did, None, changes)
        return {"id": str(did), **changes}


@router.get("/governance/lineage/snapshots")
async def snapshots(c: Ctx = Depends(ctx)):
    await c.can("governance:read")
    async with _sys(c) as s:
        rows = (await s.execute(select(DatasetSnapshot, TrainingRun.candidate_version).outerjoin(
            TrainingRun, TrainingRun.dataset_snapshot_id == DatasetSnapshot.id)
            .order_by(DatasetSnapshot.created_at.desc()))).all()
        return [{"id": str(d.id), "sha256": d.sha256, "n_samples": d.n_samples, "label_counts": d.label_counts,
                 "sources": d.sources, "excluded_noncommercial": d.excluded_noncommercial, "dvc_rev": d.dvc_rev,
                 "used_by_model_version": v, "created_at": d.created_at} for d, v in rows]


@router.get("/governance/lineage/patient/{pid}")
async def lineage_patient(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    """Which training snapshots / model versions used this patient's data (consent withdrawal, DPDP requests)."""
    await c.can("governance:read")
    async with _sys(c) as s:
        rows = (await s.execute(select(LineageEdge.snapshot_id, TrainingRun.candidate_version, func.count())
                                .join(TrainingRun, TrainingRun.dataset_snapshot_id == LineageEdge.snapshot_id,
                                      isouter=True)
                                .where(LineageEdge.patient_id == pid).group_by(LineageEdge.snapshot_id,
                                                                              TrainingRun.candidate_version))).all()
        await c.audit(s, "lineage.queried", "patient", pid, pid)
        return [{"snapshot_id": str(a), "model_version": b, "samples": n} for a, b, n in rows]


@router.get("/governance/drift")
async def drift(c: Ctx = Depends(ctx)):
    await c.can("governance:read")
    async with _sys(c) as s:
        rows = (await s.execute(select(DriftReport).order_by(DriftReport.created_at.desc()).limit(30))).scalars()
        return [{"id": str(r.id), "created_at": r.created_at, "model_version": r.model_version, "alert": r.alert,
                 "n_current": r.n_current, "metrics": r.metrics,
                 "report_url": presign_or_none(get_settings().bucket_derived, r.report_key)} for r in rows]


@router.post("/governance/drift/run")
async def drift_run(c: Ctx = Depends(ctx)):
    await c.can("governance:write")
    def _run():
        with system_session(c.p.user_id) as s:
            return monitoring.drift_report(s)

    return await run_in_threadpool(_run)


@router.get("/governance/fairness")
async def fairness(c: Ctx = Depends(ctx)):
    await c.can("governance:read")
    async with _sys(c) as s:
        r = (await s.execute(select(FairnessReport).order_by(FairnessReport.created_at.desc()))).scalars().first()
        return None if r is None else {"id": str(r.id), "created_at": r.created_at, "model_version": r.model_version,
                                       "n_reviews": r.n_reviews, "groups": r.metrics}


@router.post("/governance/fairness/run")
async def fairness_run(c: Ctx = Depends(ctx)):
    await c.can("governance:write")
    def _run():
        with system_session(c.p.user_id) as s:
            return monitoring.fairness_report(s)

    return await run_in_threadpool(_run)


@router.get("/governance/incidents")
async def incidents(c: Ctx = Depends(ctx)):
    await c.can("governance:read")
    async with _sys(c) as s:
        return [{"id": str(i.id), "kind": i.kind, "severity": i.severity, "status": i.status,
                 "description": i.description, "model_version": i.model_version, "created_at": i.created_at,
                 "resolution": i.resolution} for i in (await s.execute(select(Incident)
                                                                        .order_by(Incident.created_at.desc()))).scalars()]


@router.post("/governance/incidents", status_code=201)
async def report_incident(body: IncidentIn, c: Ctx = Depends(ctx)):
    """E.g. a case the screening missed that was later found cancerous — feeds review and retraining."""
    await c.can("incident:report")
    async with _sys(c) as s:
        i = Incident(kind=body.kind, severity=body.severity, description=body.description,
                     screening_id=body.screening_id, patient_id=body.patient_id, reported_by=c.p.username)
        s.add(i)
        await s.flush()
        await c.audit(s, "incident.reported", "incident", i.id, body.patient_id, {"kind": body.kind})
        return {"id": str(i.id), "status": i.status}
