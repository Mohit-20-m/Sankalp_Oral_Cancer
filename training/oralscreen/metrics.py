"""Metrics with bootstrap confidence intervals, calibration and operating thresholds."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             roc_auc_score, roc_curve)


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.asarray(z, dtype=np.float64)))


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """Temperature scaling: find T minimising NLL of sigmoid(logit / T)."""
    logits = np.asarray(logits, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    best_t, best_nll = 1.0, np.inf
    for t in np.exp(np.linspace(np.log(0.25), np.log(8.0), 400)):
        p = np.clip(sigmoid(logits / t), 1e-7, 1 - 1e-7)
        nll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
        if nll < best_nll:
            best_t, best_nll = float(t), nll
    return best_t


def fit_platt(logits: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Platt scaling: calibrated prob = sigmoid(a * logit + c). Falls back to temperature
    scaling (c = 0) if the fit is degenerate (a <= 0, or a single class)."""
    from sklearn.linear_model import LogisticRegression

    logits = np.asarray(logits, dtype=np.float64).reshape(-1, 1)
    y = np.asarray(y).astype(int)
    if len(np.unique(y)) == 2:
        lr = LogisticRegression(C=1e4, max_iter=2000).fit(logits, y)
        a, c = float(lr.coef_[0, 0]), float(lr.intercept_[0])
        if a > 1e-4:
            return a, c
    return 1.0 / fit_temperature(logits.ravel(), y), 0.0


def thresholds_from(y: np.ndarray, p: np.ndarray, target_sens: float) -> dict:
    """Two operating points chosen on calibration data:
       balanced  — maximises balanced accuracy (Youden's J)
       screening — highest threshold that still reaches the target sensitivity."""
    fpr, tpr, thr = roc_curve(y, p)
    thr = np.clip(thr, 0, 1)
    j = tpr - fpr
    balanced = float(thr[int(np.argmax(j))])
    ok = np.where(tpr >= target_sens)[0]
    screening = float(thr[ok[0]]) if len(ok) else float(thr[-1])
    return {"balanced": balanced, "screening": min(screening, balanced)}


def binary_metrics(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    y = np.asarray(y).astype(int)
    pred = (np.asarray(p) >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    sens = tp / max(1, tp + fn)
    spec = tn / max(1, tn + fp)
    out = {
        "threshold": float(thr), "n": int(len(y)), "positives": int(y.sum()),
        "accuracy": (tp + tn) / max(1, len(y)),
        "balanced_accuracy": (sens + spec) / 2,
        "sensitivity": sens, "specificity": spec,
        "ppv": tp / max(1, tp + fp), "npv": tn / max(1, tn + fn),
        "f1": f1_score(y, pred, zero_division=0),
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
    }
    if len(np.unique(y)) == 2:
        out["auc"] = roc_auc_score(y, p)
        out["average_precision"] = average_precision_score(y, p)
        out["brier"] = brier_score_loss(y, p)
    return {k: (float(v) if isinstance(v, (np.floating, float)) else v) for k, v in out.items()}


def bootstrap_ci(y: np.ndarray, p: np.ndarray, thr: float, n_boot: int = 1000, seed: int = 0) -> dict:
    """95% percentile bootstrap intervals for the headline metrics."""
    rng = np.random.default_rng(seed)
    y, p = np.asarray(y).astype(int), np.asarray(p)
    keys = ["accuracy", "balanced_accuracy", "sensitivity", "specificity", "f1", "auc"]
    samples = {k: [] for k in keys}
    n = len(y)
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        if len(np.unique(y[idx])) < 2:
            continue
        m = binary_metrics(y[idx], p[idx], thr)
        for k in keys:
            samples[k].append(m[k])
    return {k: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))] for k, v in samples.items() if v}


def full_report(y, p, thresholds: dict, n_boot: int) -> dict:
    rep = {}
    for name, thr in thresholds.items():
        m = binary_metrics(y, p, thr)
        m["ci95"] = bootstrap_ci(y, p, thr, n_boot)
        rep[name] = m
    return rep


def ece(y, p, bins: int = 10) -> float:
    y, p = np.asarray(y), np.asarray(p)
    edges = np.linspace(0, 1, bins + 1)
    e = 0.0
    for a, b in zip(edges[:-1], edges[1:]):
        m = (p >= a) & (p < b if b < 1 else p <= b)
        if m.any():
            e += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(e)
