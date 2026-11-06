"""End-to-end training pipeline.

    python -m oralscreen.pipeline --config config.yaml              # everything
    python -m oralscreen.pipeline --config config.yaml --stage scan # just show what data was found

Stages: scan -> clean -> split -> select -> cv -> final -> evaluate -> export -> verify -> package
"""
from __future__ import annotations

import argparse
import platform
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from . import __version__
from .dedupe import build_cache, choose_representatives, group_duplicates, inspect_images
from .engine import make_loader, predict, train_candidate
from .export import export_all
from .imaging import letterbox, load_rgb, make_thumbnail, preprocess_for_model, save_jpeg
from .metrics import binary_metrics, ece, fit_platt, full_report, sigmoid, thresholds_from
from .models import ScreenNet
from .plots import calibration_plot, cam_grid, confusion_plot, history_plot, roc_plot
from .sources import LABEL_NO_REFER, LABEL_REFER, discover, scan_report
from .splits import make_splits
from .utils import LOG, get_device, load_config, save_json, seed_everything, setup_logging, timed

STAGES = ["scan", "clean", "split", "select", "cv", "final", "evaluate", "export", "verify", "package"]


class Pipeline:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.work = Path(cfg["paths"]["work_dir"])
        self.reports = self.work / "reports"
        self.art = self.work / "artifacts"
        for d in (self.work, self.reports, self.art):
            d.mkdir(parents=True, exist_ok=True)
        setup_logging(self.work / "pipeline.log")
        seed_everything(cfg["project"]["seed"])
        self.device = get_device(cfg["train"].get("device", "auto"))
        self.size = cfg["data"]["image_size"]
        LOG.info("Arogya training v%s | torch %s | device %s | python %s", __version__, torch.__version__,
                 self.device, platform.python_version())

    # ------------------------------------------------------------------ io
    def _save_df(self, df: pd.DataFrame, name: str):
        df.drop(columns=[c for c in ("phashes", "thumb") if c in df.columns]).to_csv(self.work / f"{name}.csv", index=False)
        df.to_pickle(self.work / f"{name}.pkl")

    def _load_df(self, name: str) -> pd.DataFrame:
        p = self.work / f"{name}.pkl"
        if not p.exists():
            raise FileNotFoundError(f"{p} missing — run the earlier stage first")
        return pd.read_pickle(p)

    # --------------------------------------------------------------- stages
    def scan(self) -> pd.DataFrame:
        with timed("scan sources"):
            df = discover(self.cfg)
            rep = scan_report(df)
            rep.to_csv(self.reports / "scan_report.csv", index=False)
            if df.empty:
                raise SystemExit("No images found. Attach the datasets in Kaggle ('Add Data') and re-run.")
            summary = df.groupby(["source", "label"]).size().unstack(fill_value=0)
            LOG.info("Images found per source and label:\n%s", summary.to_string())
            unknown = df[df["label"] == "unknown"]
            if len(unknown):
                LOG.warning("%d images in folders with no label rule (ignored). Folders:\n%s", len(unknown),
                            unknown.groupby(["source", "folder"]).size().to_string())
                if self.cfg["labels"].get("fail_on_unknown"):
                    raise SystemExit("Unknown folders present and fail_on_unknown=true")
            kept = df[df["label"].isin([LABEL_REFER, LABEL_NO_REFER])].reset_index(drop=True)
            if self.cfg["data"].get("max_per_source"):
                kept = (kept.groupby("source", group_keys=False)
                            .apply(lambda g: g.sample(min(len(g), self.cfg["data"]["max_per_source"]),
                                                      random_state=self.cfg["project"]["seed"])))
            self._save_df(kept, "manifest_raw")
            LOG.info("Usable labelled images: %d (refer %d / no_refer %d)", len(kept),
                     (kept.label == LABEL_REFER).sum(), (kept.label == LABEL_NO_REFER).sum())
            return kept

    def clean(self):
        df = self._load_df("manifest_raw")
        with timed("validate images + group duplicates"):
            df = inspect_images(df, self.cfg["data"]["min_side"])
            df = group_duplicates(df, self.cfg, self.device)
            df["rep"] = choose_representatives(df)
            df = build_cache(df, self.work / "image_cache", int(self.cfg["data"].get("cache_max_side", 512)))
            stats = dict(df.attrs.get("dedupe_stats", {}))
            stats["unique_after_grouping_by_label"] = df[df.rep].label.value_counts().to_dict()
            stats["unique_per_source"] = df[df.rep].groupby(["source", "label"]).size().unstack(fill_value=0).to_dict()
            save_json(stats, self.reports / "dedupe_stats.json")
            LOG.info("Unique photos after grouping: %s", stats["unique_after_grouping_by_label"])
            self._save_df(df, "manifest_clean")

    def split(self):
        df = make_splits(self._load_df("manifest_clean"), self.cfg)
        self._save_df(df, "manifest_split")
        tbl = pd.crosstab([df["split"], df["rep"]], df["label"])
        tbl.to_csv(self.reports / "split_table.csv")

    # helpers ------------------------------------------------------------
    def _pool(self, df):
        return df[df["split"].isin(["dev", "calib"])]

    def _fold(self, df, k):
        pool = self._pool(df)
        tr = pool[pool["fold"] != k]
        va = pool[(pool["fold"] == k) & pool["rep"]]
        return tr, va

    def _y(self, df):
        return (df["label"] == LABEL_REFER).astype(int).values

    def select(self):
        df = self._load_df("manifest_split")
        tr, va = self._fold(df, 0)
        results = []
        for cand in self.cfg["train"]["candidates"]:
            with timed(f"candidate {cand['key']} (fold 0)"):
                try:
                    model, hist, best_ep = train_candidate(cand, tr, va, self.cfg, self.device, cand["key"])
                    logit, _ = predict(model, make_loader(va, self.size, False, self.cfg), self.device,
                                       self.cfg["train"]["amp"])
                    y = self._y(va)
                    p = sigmoid(logit)
                    thr = thresholds_from(y, p, self.cfg["evaluate"]["target_sensitivity"])["balanced"]
                    m = binary_metrics(y, p, thr)
                    results.append({"key": cand["key"], "auc": m.get("auc", float("nan")),
                                    "balanced_accuracy@opt": m["balanced_accuracy"],
                                    "sensitivity@opt": m["sensitivity"], "specificity@opt": m["specificity"],
                                    "best_epoch": best_ep})
                    history_plot(hist, self.reports / f"history_{cand['key']}_fold0.png", f"{cand['key']} fold 0")
                    save_json(hist, self.reports / f"history_{cand['key']}_fold0.json")
                    del model
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception as e:  # noqa: BLE001 — one failing candidate must not stop the run
                    LOG.exception("candidate %s failed: %s", cand["key"], e)
        if not results:
            raise SystemExit("All candidates failed — see pipeline.log")
        res = pd.DataFrame(results).sort_values(self.cfg["train"].get("selection_metric", "auc"), ascending=False)
        res.to_csv(self.reports / "candidate_selection.csv", index=False)
        LOG.info("Candidate comparison (fold 0 validation, optimistic threshold):\n%s", res.to_string(index=False))
        best = res.iloc[0]["key"]
        save_json({"best": best, "table": res.to_dict(orient="records")}, self.work / "selection.json")
        LOG.info("Selected backbone: %s", best)

    def _best_cand(self):
        from .utils import load_json

        key = load_json(self.work / "selection.json")["best"]
        return next(c for c in self.cfg["train"]["candidates"] if c["key"] == key)

    def cv(self):
        if not self.cfg["train"].get("run_cv_on_best", True):
            LOG.info("CV skipped by config")
            return
        df = self._load_df("manifest_split")
        cand = self._best_cand()
        rows = []
        for k in range(self.cfg["split"]["n_folds"]):
            tr, va = self._fold(df, k)
            with timed(f"CV fold {k} — {cand['key']}"):
                model, _hist, best_ep = train_candidate(cand, tr, va, self.cfg, self.device, f"cv{k}")
                logit, _ = predict(model, make_loader(va, self.size, False, self.cfg), self.device,
                                   self.cfg["train"]["amp"])
                y, p = self._y(va), sigmoid(logit)
                thr = thresholds_from(y, p, self.cfg["evaluate"]["target_sensitivity"])["balanced"]
                m = binary_metrics(y, p, thr)
                rows.append({"fold": k, "n": len(va), "auc": m.get("auc"), "balanced_accuracy": m["balanced_accuracy"],
                             "sensitivity": m["sensitivity"], "specificity": m["specificity"], "best_epoch": best_ep})
                del model
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        res = pd.DataFrame(rows)
        res.to_csv(self.reports / "cross_validation.csv", index=False)
        summary = {c: {"mean": float(res[c].mean()), "std": float(res[c].std())}
                   for c in ("auc", "balanced_accuracy", "sensitivity", "specificity")}
        save_json({"backbone": cand["key"], "folds": rows, "summary": summary,
                   "note": "per-fold thresholds are optimised on the fold itself (optimistic); "
                           "the held-out test result is the honest number"}, self.reports / "cross_validation.json")
        LOG.info("CV summary: %s", summary)

    def final(self):
        df = self._load_df("manifest_split")
        cand = self._best_cand()
        tr = df[df["split"] == "dev"]
        ca = df[(df["split"] == "calib") & df["rep"]]
        with timed(f"final model — {cand['key']}"):
            model, hist, best_ep = train_candidate(cand, tr, ca, self.cfg, self.device, "final")
        history_plot(hist, self.reports / "history_final.png", f"final {cand['key']}")
        save_json(hist, self.reports / "history_final.json")
        logit, _ = predict(model, make_loader(ca, self.size, False, self.cfg), self.device, self.cfg["train"]["amp"])
        y = self._y(ca)
        a, c = fit_platt(logit, y)
        p = sigmoid(a * logit + c)
        thr = thresholds_from(y, p, self.cfg["evaluate"]["target_sensitivity"])
        ckpt = self.art / "checkpoints"
        ckpt.mkdir(parents=True, exist_ok=True)
        torch.save({"state_dict": model.state_dict(), "timm": cand["timm"], "candidate": cand,
                    "image_size": self.size, "calibration": {"a": a, "c": c}, "thresholds": thr,
                    "best_epoch": best_ep},
                   ckpt / "lesion_model.pt")
        save_json({"platt_a": a, "platt_c": c, "thresholds": thr, "calib_n": len(ca), "best_epoch": best_ep},
                  self.work / "calibration.json")
        LOG.info("Calibration (Platt): prob = sigmoid(%.3f * logit + %.3f); thresholds=%s", a, c, thr)

    def _load_final(self):
        ck = torch.load(self.art / "checkpoints" / "lesion_model.pt", map_location="cpu", weights_only=False)
        net = ScreenNet(ck["timm"], pretrained=False, img_size=ck["image_size"])
        net.load_state_dict(ck["state_dict"])
        return net.to(self.device).eval(), ck

    def evaluate(self):
        df = self._load_df("manifest_split")
        net, ck = self._load_final()
        a, c = ck["calibration"]["a"], ck["calibration"]["c"]
        thr = ck["thresholds"]
        te = df[(df["split"] == "test") & df["rep"]].reset_index(drop=True)
        loader = make_loader(te, self.size, False, self.cfg)
        logit, emb = predict(net, loader, self.device, self.cfg["train"]["amp"])
        y = self._y(te)
        p = sigmoid(a * logit + c)
        nb = self.cfg["evaluate"]["bootstrap"]
        report = {"n_test_unique_photos": len(te), "calibration": {"a": a, "c": c}, "thresholds": thr,
                  "test": full_report(y, p, thr, nb), "ece": ece(y, p)}
        if self.cfg["evaluate"].get("tta"):
            lt, _ = predict(net, loader, self.device, self.cfg["train"]["amp"], tta=True)
            report["test_tta_balanced"] = binary_metrics(y, sigmoid(a * lt + c), thr["balanced"])
        per_source = []
        for src, g in te.assign(p=p, y=y).groupby("source"):
            m = binary_metrics(g["y"].values, g["p"].values, thr["screening"])
            per_source.append({"source": src, "n": len(g), "refer": int(g["y"].sum()),
                               "accuracy": m["accuracy"], "sensitivity": m["sensitivity"],
                               "specificity": m["specificity"], "auc": m.get("auc")})
        pd.DataFrame(per_source).to_csv(self.reports / "per_source_test.csv", index=False)
        report["per_source"] = per_source
        save_json(report, self.reports / "test_metrics.json")
        te.assign(prob=p, logit=logit).drop(columns=["phashes", "thumb"], errors="ignore").to_csv(
            self.reports / "test_predictions.csv", index=False)

        roc_plot(y, p, self.reports / "roc_test.png")
        calibration_plot(y, p, self.reports / "calibration_test.png")
        for name in ("screening", "balanced"):
            confusion_plot(report["test"][name], self.reports / f"confusion_{name}.png",
                           f"Test — {name} threshold {thr[name]:.2f}")
        # heat-map sanity check on a mix of correct/incorrect cases
        idx = np.argsort(-np.abs(p - 0.5))[:8].tolist() + np.argsort(np.abs(p - 0.5))[:4].tolist()
        idx = list(dict.fromkeys(idx))[:12]
        if idx:
            x = torch.from_numpy(np.stack([preprocess_for_model(te.loc[i, "path"], self.size) for i in idx]))
            with torch.no_grad():
                cams = net.cpu().cam(x).numpy()
            net.to(self.device)
            cam_grid([te.loc[i, "path"] for i in idx], [te.loc[i, "label"] for i in idx], p[idx], cams, self.size,
                     self.reports / "heatmaps_test.png")
        s, b = report["test"]["screening"], report["test"]["balanced"]
        LOG.info("HELD-OUT TEST (%d unique photos)\n"
                 "  balanced threshold %.2f: accuracy %.3f | balanced acc %.3f | sens %.3f | spec %.3f | AUC %.3f\n"
                 "  screening threshold %.2f: accuracy %.3f | balanced acc %.3f | sens %.3f | spec %.3f",
                 len(te), thr["balanced"], b["accuracy"], b["balanced_accuracy"], b["sensitivity"], b["specificity"],
                 b.get("auc", float("nan")), thr["screening"], s["accuracy"], s["balanced_accuracy"],
                 s["sensitivity"], s["specificity"])

    def export(self):
        df = self._load_df("manifest_split")
        net, ck = self._load_final()
        te = df[(df["split"] == "test") & df["rep"]].reset_index(drop=True)
        sub = te.sample(min(len(te), 256), random_state=0) if len(te) else te
        px = np.stack([preprocess_for_model(p, self.size) for p in sub["path"]]) if len(sub) else \
            np.zeros((1, 3, self.size, self.size), np.float32)
        py = self._y(sub) if len(sub) else np.zeros(1, int)
        with timed("export ONNX + INT8"):
            contract = export_all(net, ck["calibration"], ck["thresholds"], self.size, self.art, self.cfg, px, py)
        with timed("out-of-distribution stats + reference embeddings"):
            self._ood_and_reference(df, net)
        with timed("benchmark set"):
            self._benchmark(te)
        self._model_card(contract, ck)

    def _embeddings(self, net, frame):
        _, emb = predict(net, make_loader(frame, self.size, False, self.cfg), self.device, self.cfg["train"]["amp"])
        return emb

    def _ood_and_reference(self, df, net):
        from sklearn.covariance import LedoitWolf

        net = net.to(self.device)
        ref = df[df["split"].isin(["dev", "calib"]) & df["rep"]].reset_index(drop=True)
        ref_emb = self._embeddings(net, ref)
        lw = LedoitWolf().fit(ref_emb)
        prec = lw.precision_.astype(np.float32)
        mu = lw.location_.astype(np.float32)

        def maha(e):
            d = e - mu
            return np.sqrt(np.einsum("ij,jk,ik->i", d, prec, d))

        cal = df[(df["split"] == "calib") & df["rep"]]
        cal_d = maha(self._embeddings(net, cal)) if len(cal) else maha(ref_emb)
        np.savez_compressed(self.art / "ood_stats.npz", mean=mu, precision=prec,
                            threshold_p95=np.float32(np.percentile(cal_d, 95)),
                            threshold_p99=np.float32(np.percentile(cal_d, 99)))
        # reference set for "similar confirmed cases" (pgvector in the backend)
        refdir = self.art / "reference"
        thumbs = refdir / "thumbs"
        thumbs.mkdir(parents=True, exist_ok=True)
        normed = ref_emb / (np.linalg.norm(ref_emb, axis=1, keepdims=True) + 1e-8)
        np.save(refdir / "embeddings.npy", normed.astype(np.float32))
        rows = []
        for i, r in ref.iterrows():
            tname = f"ref_{i:05d}.jpg"
            if self.cfg["export"].get("reference_thumbnails", True):
                save_jpeg(make_thumbnail(load_rgb(r["path"]), self.cfg["export"]["thumbnail_size"]),
                          thumbs / tname, 85)
            rows.append({"ref_id": i, "label": r["label"], "source": r["source"], "thumbnail": f"thumbs/{tname}",
                         "split": r["split"]})
        pd.DataFrame(rows).to_csv(refdir / "index.csv", index=False)
        # raw (un-normalised) embeddings + labels: backend head retraining starts from these
        np.save(refdir / "embeddings_raw.npy", ref_emb.astype(np.float32))

    def _benchmark(self, te):
        bdir = self.art / "benchmark"
        imgs = bdir / "images"
        imgs.mkdir(parents=True, exist_ok=True)
        rows = []
        for i, r in te.iterrows():
            name = f"bench_{i:05d}.jpg"
            save_jpeg(make_thumbnail(load_rgb(r["path"]), self.cfg["export"]["benchmark_max_side"]), imgs / name, 92)
            rows.append({"image": f"images/{name}", "label": r["label"], "y": int(r["label"] == LABEL_REFER),
                         "source": r["source"]})
        pd.DataFrame(rows).to_csv(bdir / "manifest.csv", index=False)
        LOG.info("Benchmark set: %d images (fixed; never used for training)", len(rows))

    def _model_card(self, contract, ck):
        from .utils import load_json

        def maybe(p):
            p = self.reports / p
            return load_json(p) if p.exists() else None

        test = maybe("test_metrics.json") or {}
        cv = maybe("cross_validation.json")
        dd = maybe("dedupe_stats.json") or {}
        sel = load_json(self.work / "selection.json") if (self.work / "selection.json").exists() else {}
        split = pd.read_csv(self.reports / "split_table.csv") if (self.reports / "split_table.csv").exists() else None
        card = {
            "model_name": self.cfg["project"]["name"], "model_version": self.cfg["project"]["model_version"],
            "created": time.strftime("%Y-%m-%d %H:%M:%S"), "pipeline_version": __version__,
            "intended_use": "Decision support for frontline screening of oral potentially malignant disorders and "
                            "oral cancer from smartphone photographs. Flags photos that need specialist review.",
            "not_intended_for": ["diagnosis", "use without a clinician confirming results",
                                 "histopathology, X-ray or non-oral images"],
            "backbone": ck["timm"], "candidate_selection": sel.get("table"),
            "training_data": {"sources": dd.get("unique_per_source"), "deduplication": dd,
                              "split_table": split.to_dict(orient="records") if split is not None else None},
            "label_definition": {"refer": "oral cancer / OSCC / malignant / leukoplakia / lichen planus",
                                 "no_refer": "normal / non-cancer / benign / canker sores / cold sores / "
                                             "gingivostomatitis / thrush / benign ulcers"},
            "evaluation": {"held_out_test": test.get("test"), "per_source": test.get("per_source"),
                           "calibration_ece": test.get("ece"), "cross_validation": cv and cv.get("summary")},
            "operating_points": ck["thresholds"], "calibration": ck["calibration"],
            "limitations": [
                "Trained on open datasets of uncertain provenance and licence; images were deduplicated but labels "
                "were taken as provided by the sources.",
                "No patient identifiers were available; near-duplicate grouping approximates patient-level splitting.",
                "Not validated prospectively, and not validated on photographs taken by community health workers in "
                "Dakshina Kannada/Udupi.",
                "Some lesion types or mouth sites may be under-represented; see per-source results.",
                "Performance can drop on poor-quality photos — the app's quality gate must run first.",
            ],
            "ethical_considerations": "Output is a screening aid; every 'refer' result must be reviewed by a "
                                      "specialist. Never present as a diagnosis.",
            "contract": "model_contract.json",
        }
        save_json(card, self.art / "model_card.json")

    def verify(self):
        """Independent check using ONLY the exported files + contract (exactly what the backend sees)."""
        from . import inference_reference as ir

        shutil.copy2(Path(ir.__file__), self.art / "inference_reference.py")
        with timed("verify exported artifacts (standalone reference inference)"):
            rep = ir.verify(self.art)
        save_json(rep, self.reports / "artifact_verification.json")
        LOG.info("Artifact verification: %s", rep)
        if not rep.get("ok"):
            raise SystemExit("Exported model forms disagree — see artifact_verification.json")

    def package(self):
        # copy reports + config into artifacts, then zip
        for p in self.reports.glob("*"):
            dst = self.art / "reports" / p.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dst)
        shutil.copy2(self.work / "manifest_split.csv", self.art / "reports" / "manifest_split.csv")
        save_json(self.cfg, self.art / "training_config.json")
        (self.art / "README_ARTIFACTS.md").write_text(ARTIFACT_README, encoding="utf-8")
        zip_path = Path(self.cfg["paths"]["artifacts_zip"])
        if zip_path.exists():
            zip_path.unlink()
        shutil.make_archive(str(zip_path.with_suffix("")), "zip", root_dir=self.art)
        LOG.info("📦 Artifacts zipped: %s (%.1f MB)", zip_path, zip_path.stat().st_size / 1e6)

    def run(self, stages):
        for st in stages:
            getattr(self, st)()


ARTIFACT_README = """# Arogya model artifacts

Drop this folder's contents into the backend's `models/current/` directory.

| File | Purpose |
|---|---|
| lesion_model.onnx / lesion_model_int8.onnx | full model: input -> prob, logit, embedding, cam |
| backbone.onnx / backbone_int8.onnx | backbone only: input -> embedding, cam_features (use with head.json) |
| head.json | linear head weights + bias (Platt calibration folded in, temperature = 1), thresholds — retrainable by the backend |
| model_contract.json | exact preprocessing, inputs/outputs, thresholds — the integration contract |
| model_card.json | data, metrics, limitations |
| ood_stats.npz | Mahalanobis mean/precision + thresholds for "cannot assess" |
| reference/ | normalised + raw embeddings, labels, thumbnails for similar-case search and head retraining |
| benchmark/ | fixed held-out test images + labels: every future model version is scored on these |
| checkpoints/lesion_model.pt | PyTorch weights for deep fine-tuning later |
| reports/ | metrics, ROC, confusion matrices, calibration, heat maps, CV, dedupe stats |
| inference_reference.py | standalone reference inference (numpy + onnxruntime) — the backend must match it |

Use `prob >= thresholds.screening` as the default "refer" rule. Screening aid only — not a diagnosis.
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description="Arogya training pipeline")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--stage", default="all", help=f"one of {STAGES}, comma list, or 'all'")
    ap.add_argument("--from-stage", default=None, help="run from this stage to the end")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    pipe = Pipeline(cfg)
    if args.from_stage:
        stages = STAGES[STAGES.index(args.from_stage):]
    elif args.stage == "all":
        stages = STAGES
    else:
        stages = [s.strip() for s in args.stage.split(",")]
    pipe.run(stages)


if __name__ == "__main__":
    main(sys.argv[1:])
