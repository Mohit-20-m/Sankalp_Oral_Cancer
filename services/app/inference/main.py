"""Inference service (ONNX Runtime). Stateless; scales independently of the API.

POST /v1/predict   multipart: files=<image>... (+ optional ids)  ->  per image: prob, logit, cam grid,
                   embedding, OOD distance/flag, shadow-head prob, latency
POST /v1/embed     same input -> embeddings only (benchmark / reference indexing)
GET  /v1/info      model + head versions, file checksums, thresholds, placeholder flag
GET  /health /ready
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from ..config import get_settings
from ..ml.bundle import ModelBundle
from ..observability import log, setup_logging, setup_tracing

setup_logging("oralscreen-inference")
app = FastAPI(title="Sankalp inference", version="2.0.0")
Instrumentator().instrument(app).expose(app, include_in_schema=False)
setup_tracing("oralscreen-inference", fastapi_app=app)

_bundle: ModelBundle | None = None
_load_error: str | None = None
_lock = threading.Lock()
MAX_BATCH = 8


def bundle() -> ModelBundle:
    global _bundle, _load_error
    if _bundle is None:
        with _lock:
            if _bundle is None:
                root = Path(get_settings().models_dir)
                if not (root / "current" / "model_contract.json").exists():
                    from ..ml.placeholder import generate

                    log.warning("no_model_found_generating_placeholder", path=str(root / "current"))
                    generate(root / "current")
                try:
                    _bundle = ModelBundle(root, os.environ.get("OS_INFERENCE_PRECISION", "auto"))
                    _load_error = None
                    log.info("model_loaded", **{k: v for k, v in _bundle.info().items() if k != "files_sha256"})
                except Exception as e:  # noqa: BLE001
                    _load_error = str(e)
                    raise
    return _bundle


@app.on_event("startup")
def _warm() -> None:
    try:
        b = bundle()
        b.run(np.zeros((1, 3, b.size, b.size), np.float32))
    except Exception as e:  # noqa: BLE001
        log.error("model_load_failed", error=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    if _bundle is None:
        return JSONResponse({"status": "not_ready", "error": _load_error}, status_code=503)
    return {"status": "ready", "model_version": _bundle.active_version, "placeholder": _bundle.is_placeholder}


@app.get("/v1/info")
def info():
    return bundle().info()


@app.post("/v1/reload")
def reload_model():
    """Re-read models/current (after installing a new model) and heads/state.json."""
    global _bundle
    with _lock:
        _bundle = None
    return bundle().info()


async def _read(files: list[UploadFile]) -> list[bytes]:
    if not files:
        raise HTTPException(400, "no images")
    if len(files) > MAX_BATCH:
        raise HTTPException(413, f"max {MAX_BATCH} images per call")
    return [await f.read() for f in files]


@app.post("/v1/predict")
async def predict(files: list[UploadFile] = File(...), ids: str = Form("")):
    b = bundle()
    blobs = await _read(files)
    id_list = [i for i in ids.split(",") if i] or [str(i) for i in range(len(blobs))]
    t0 = time.perf_counter()
    xs, sizes, bad = [], [], {}
    for i, data in enumerate(blobs):
        try:
            xs.append(b.preprocess(data))
            from PIL import Image
            import io

            with Image.open(io.BytesIO(data)) as im:
                from PIL import ImageOps

                sizes.append(ImageOps.exif_transpose(im).size)
        except Exception as e:  # noqa: BLE001
            bad[i] = f"undecodable image: {e}"
            xs.append(np.zeros((3, b.size, b.size), np.float32))
            sizes.append((b.size, b.size))
    out = b.run(np.stack(xs))
    ms = (time.perf_counter() - t0) * 1000
    results = []
    for i in range(len(blobs)):
        if i in bad:
            results.append({"id": id_list[i], "error": bad[i]})
            continue
        r = {"id": id_list[i], "prob": float(out["prob"][i]), "logit": float(out["logit"][i]),
             "cam": out["cam"][i].round(4).tolist(), "embedding": out["embedding"][i].tolist(),
             "letterbox": b.letterbox_box(*sizes[i], b.size), "input_size": b.size}
        if "ood_distance" in out:
            r["ood_distance"] = float(out["ood_distance"][i])
            r["out_of_distribution"] = bool(out["ood"][i])
        if "shadow_prob" in out:
            r["shadow"] = {"head": b.shadow.version, "prob": float(out["shadow_prob"][i])}
        results.append(r)
    return {"model_version": b.version, "head_version": b.active.version, "active_version": b.active_version,
            "contract_sha256": b.contract_sha, "thresholds": b.thresholds, "placeholder": b.is_placeholder,
            "latency_ms": round(ms, 1), "results": results}


@app.post("/v1/embed")
async def embed(files: list[UploadFile] = File(...)):
    b = bundle()
    blobs = await _read(files)
    out = b.run(np.stack([b.preprocess(d) for d in blobs]))
    return {"model_version": b.version, "embeddings": out["embedding"].tolist()}
