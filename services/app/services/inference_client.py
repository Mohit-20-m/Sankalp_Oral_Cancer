"""Client for the inference service (circuit breaker + timeouts)."""
from __future__ import annotations

import time

import httpx

from ..config import get_settings
from ..observability import INFERENCE_FAILURES, INFERENCE_LATENCY
from ..resilience import breaker


def predict(images: list[tuple[str, bytes]]) -> dict:
    """images: [(id, jpeg bytes)] -> inference response. Raises on failure (callers fall back safely)."""
    s = get_settings()

    def _call():
        files = [("files", (f"{i}.jpg", data, "image/jpeg")) for i, data in images]
        r = httpx.post(f"{s.inference_url}/v1/predict", files=files, data={"ids": ",".join(i for i, _ in images)},
                       timeout=s.inference_timeout_s)
        r.raise_for_status()
        return r.json()

    t0 = time.perf_counter()
    try:
        out = breaker("inference", fail_max=3, reset_s=20).call(_call)
    except Exception:
        INFERENCE_FAILURES.inc()
        raise
    INFERENCE_LATENCY.observe(time.perf_counter() - t0)
    return out


def predict_batched(images: list[tuple[str, bytes]], batch: int = 8) -> dict:
    merged: dict | None = None
    for s in range(0, len(images), batch):
        out = predict(images[s:s + batch])
        if merged is None:
            merged = out
        else:
            merged["results"].extend(out["results"])
    return merged or {"results": []}


def info() -> dict:
    s = get_settings()
    r = breaker("inference", fail_max=3, reset_s=20).call(httpx.get, f"{s.inference_url}/v1/info", timeout=5)
    r.raise_for_status()
    return r.json()


def embed(images: list[bytes]) -> list[list[float]]:
    s = get_settings()
    out = []
    for k in range(0, len(images), 8):
        files = [("files", (f"{i}.jpg", d, "image/jpeg")) for i, d in enumerate(images[k:k + 8])]
        r = httpx.post(f"{s.inference_url}/v1/embed", files=files, timeout=s.inference_timeout_s)
        r.raise_for_status()
        out.extend(r.json()["embeddings"])
    return out


def reload() -> dict:
    s = get_settings()
    r = httpx.post(f"{s.inference_url}/v1/reload", timeout=60)
    r.raise_for_status()
    return r.json()
