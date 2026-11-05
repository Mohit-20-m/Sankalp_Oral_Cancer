"""Model monitoring: data drift (PSI / KS + Evidently report) and subgroup fairness."""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import select

from .. import storage
from ..config import get_settings
from ..models import (BenchmarkItem, DriftReport, FairnessReport, ImageResult, Patient, Review, Screening,
                      ScreeningImage)
from ..observability import log
from .mlops import _head_probs, active_model


def psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index (0.1 = small shift, 0.2+ = significant)."""
    edges = np.quantile(ref, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    edges = np.unique(edges)
    r = np.histogram(ref, edges)[0] / max(1, len(ref))
    c = np.histogram(cur, edges)[0] / max(1, len(cur))
    r, c = np.clip(r, 1e-4, None), np.clip(c, 1e-4, None)
    return float(np.sum((c - r) * np.log(c / r)))


def drift_report(s, days: int = 7) -> dict:
    from scipy.stats import ks_2samp

    mv = active_model(s)
    if mv is None:
        return {"status": "no_model"}
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    bench = s.execute(select(BenchmarkItem).where(BenchmarkItem.backbone_version == mv.backbone_version)).scalars().all()
    if not bench:
        return {"status": "no_benchmark"}
    Xb = np.asarray([np.asarray(b.embedding_raw, np.float32) for b in bench])
    ref_prob = _head_probs(mv.head or {}, Xb) if mv.head else np.zeros(len(bench))
    ref_norm = np.linalg.norm(Xb, axis=1)
    rows = s.execute(select(ImageResult, ScreeningImage.quality).join(ScreeningImage,
                                                                      ScreeningImage.id == ImageResult.image_id)
                     .where(ImageResult.created_at >= start, ImageResult.model_version == mv.backbone_version)).all()
    if len(rows) < 10:
        return {"status": "insufficient_data", "n_current": len(rows)}
    cur_prob = np.asarray([r.prob for r, _ in rows])
    cur_norm = np.asarray([np.linalg.norm(np.asarray(r.embedding, np.float32)) if r.embedding is not None else 0
                           for r, _ in rows])
    ood_rate = float(np.mean([bool(r.out_of_distribution) for r, _ in rows]))
    bright = [((q or {}).get("server") or {}).get("brightness") for _, q in rows]
    bright = np.asarray([b for b in bright if b is not None], np.float32)
    metrics = {"psi_prob": psi(ref_prob, cur_prob), "ks_prob_pvalue": float(ks_2samp(ref_prob, cur_prob).pvalue),
               "psi_embedding_norm": psi(ref_norm, cur_norm),
               "ks_embedding_norm_pvalue": float(ks_2samp(ref_norm, cur_norm).pvalue),
               "ood_rate": ood_rate, "mean_prob_reference": float(ref_prob.mean()),
               "mean_prob_current": float(cur_prob.mean()),
               "mean_brightness_current": float(bright.mean()) if len(bright) else None}
    alert = metrics["psi_prob"] > 0.2 or metrics["psi_embedding_norm"] > 0.2 or ood_rate > 0.10
    report_key = _evidently_html(ref_prob, ref_norm, cur_prob, cur_norm, end)
    rep = DriftReport(model_version=mv.version, window_start=start, window_end=end, n_current=len(rows),
                      metrics=metrics, alert=alert, report_key=report_key)
    s.add(rep)
    s.flush()
    return {"status": "ok", "id": str(rep.id), "alert": alert, "metrics": metrics, "report_key": report_key}


def _evidently_html(ref_prob, ref_norm, cur_prob, cur_norm, when) -> str | None:
    """Optional rich HTML report via Evidently (API differs across versions; failure is non-fatal)."""
    try:
        import pandas as pd

        ref = pd.DataFrame({"prob": ref_prob, "embedding_norm": ref_norm})
        cur = pd.DataFrame({"prob": cur_prob, "embedding_norm": cur_norm})
        html_path = "/tmp/drift_report.html"
        try:                                      # evidently >= 0.7
            from evidently import Report
            from evidently.presets import DataDriftPreset

            Report([DataDriftPreset()]).run(current_data=cur, reference_data=ref).save_html(html_path)
        except ImportError:                       # evidently 0.4.x
            from evidently.metric_preset import DataDriftPreset
            from evidently.report import Report

            r = Report(metrics=[DataDriftPreset()])
            r.run(reference_data=ref, current_data=cur)
            r.save_html(html_path)
        key = f"reports/drift/{when:%Y%m%d-%H%M%S}.html"
        storage.put_bytes(get_settings().bucket_derived, key, open(html_path, "rb").read(), "text/html")
        return key
    except Exception as e:  # noqa: BLE001
        log.info("evidently_report_skipped", error=str(e)[:160])
        return None


POSITIVE_VERDICTS = {"confirm_refer", "needs_biopsy"}


def fairness_report(s) -> dict:
    """AI vs specialist agreement per subgroup (sex, age band, site of facility, phone model).
    Groups with fewer than k reviews are suppressed (privacy + statistical noise)."""
    cfg = get_settings()
    mv = active_model(s)
    rows = s.execute(select(Review, Screening, Patient).join(Screening, Screening.id == Review.screening_id)
                     .join(Patient, Patient.id == Screening.patient_id)).all()
    if not rows:
        return {"status": "no_reviews"}
    year = datetime.now().year

    def band(by):
        if not by:
            return "unknown"
        a = year - by
        return "<30" if a < 30 else "30-44" if a < 45 else "45-59" if a < 60 else "60+"

    groups: dict[str, dict[str, list]] = {"sex": {}, "age_band": {}, "facility": {}, "device": {}}
    for rv, sc, pt in rows:
        ai_pos = sc.risk_level == "HIGH"
        truth = rv.verdict in POSITIVE_VERDICTS
        rec = (ai_pos, truth, bool(rv.ai_agreed))
        for g, key in (("sex", pt.sex), ("age_band", band(pt.birth_year)), ("facility", str(sc.facility_id)[:8]),
                       ("device", (sc.device or {}).get("model", "unknown"))):
            groups[g].setdefault(key or "unknown", []).append(rec)
    out = {}
    for g, d in groups.items():
        out[g] = {}
        for key, recs in d.items():
            if len(recs) < cfg.k_anonymity_min_cell:
                out[g][key] = {"n": len(recs), "suppressed": True}
                continue
            tp = sum(1 for a, t, _ in recs if a and t)
            fn = sum(1 for a, t, _ in recs if not a and t)
            tn = sum(1 for a, t, _ in recs if not a and not t)
            fp = sum(1 for a, t, _ in recs if a and not t)
            out[g][key] = {"n": len(recs), "agreement": sum(r[2] for r in recs) / len(recs),
                           "sensitivity": tp / (tp + fn) if tp + fn else None,
                           "specificity": tn / (tn + fp) if tn + fp else None}
    rep = FairnessReport(model_version=mv.version if mv else "unknown", n_reviews=len(rows), metrics=out)
    s.add(rep)
    s.flush()
    return {"status": "ok", "id": str(rep.id), "n_reviews": len(rows), "groups": out}
