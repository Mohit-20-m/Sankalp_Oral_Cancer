"""Loads a model artifact folder and runs it EXACTLY as the contract specifies.

Directory layout (bind-mounted at /models):
    current/            model artifacts (or the generated placeholder)
    heads/<ver>.json    heads produced by retraining (same format as head.json)
    state.json          {"active_head": "base" | "<ver>", "shadow_head": null | "<ver>"}
The backbone (expensive) runs once per image; heads (a dot product) are cheap, which is what makes
shadow mode and champion/challenger evaluation essentially free.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Head:
    def __init__(self, version: str, d: dict):
        self.version = version
        self.w = np.asarray(d["weights"], dtype=np.float32)
        self.b = float(d["bias"])
        self.t = float(d.get("temperature", 1.0))
        self.thresholds = d.get("thresholds") or {}
        self.raw = d

    def prob(self, emb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        logit = emb @ self.w + self.b
        return 1.0 / (1.0 + np.exp(-logit / self.t)), logit

    def cam(self, feats: np.ndarray) -> np.ndarray:
        c = np.maximum(np.einsum("d,ndhw->nhw", self.w, feats), 0)
        return c / (c.reshape(len(c), -1).max(1)[:, None, None] + 1e-6)


class ModelBundle:
    def __init__(self, root: str | Path, precision: str = "auto"):
        import onnxruntime as ort

        self.root = Path(root)
        self.dir = self.root / "current"
        self.contract = json.loads((self.dir / "model_contract.json").read_text())
        self.contract_sha = sha256_file(self.dir / "model_contract.json")
        self.card = json.loads((self.dir / "model_card.json").read_text()) if (self.dir / "model_card.json").exists() else {}
        self.version = str(self.contract.get("model_version", "unknown"))
        self.is_placeholder = bool(self.contract.get("placeholder", False))
        files = self.contract["files"]
        recommended = bool((self.contract.get("parity") or {}).get("int8_recommended", False))
        use_int8 = precision == "int8" or (precision == "auto" and recommended)
        key = "backbone_int8" if use_int8 and "backbone_int8" in files else "backbone_fp32"
        self.backbone_file = files[key]
        self.precision = "int8" if key.endswith("int8") else "fp32"
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = int(os.environ.get("OS_INFERENCE_THREADS", "2"))
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(str(self.dir / self.backbone_file), sess_options=opts,
                                         providers=["CPUExecutionProvider"])
        self.file_sha = {k: sha256_file(self.dir / v) for k, v in files.items() if (self.dir / v).exists()}
        inp = self.contract["input"]
        self.size = int(inp["size"])
        self.mean = np.asarray(inp["mean"], np.float32)
        self.std = np.asarray(inp["std"], np.float32)
        self.pad = tuple(int(x) for x in inp["pad_rgb"])
        self.base_head = Head("base", json.loads((self.dir / "head.json").read_text()))
        ood_p = self.dir / self.contract.get("ood_file", "ood_stats.npz")
        self.ood = {k: np.asarray(v) for k, v in np.load(ood_p).items()} if ood_p.exists() else None
        self._heads: dict[str, Head] = {}
        self._state_mtime = -1.0
        self.active: Head = self.base_head
        self.shadow: Head | None = None
        self._lock = threading.Lock()
        self.refresh_heads(force=True)

    # ── heads / state (hot reload: worker writes state.json after a promotion) ──
    def head(self, version: str) -> Head:
        if version in ("base", self.base_head.version):
            return self.base_head
        if version not in self._heads:
            p = self.root / "heads" / f"{version}.json"
            self._heads[version] = Head(version, json.loads(p.read_text()))
        return self._heads[version]

    def refresh_heads(self, force: bool = False) -> None:
        sp = self.root / "state.json"
        mtime = sp.stat().st_mtime if sp.exists() else 0.0
        if not force and mtime == self._state_mtime:
            return
        with self._lock:
            state = json.loads(sp.read_text()) if sp.exists() else {}
            try:
                self.active = self.head(state.get("active_head") or "base")
            except FileNotFoundError:
                self.active = self.base_head
            sh = state.get("shadow_head")
            try:
                self.shadow = self.head(sh) if sh else None
            except FileNotFoundError:
                self.shadow = None
            self._state_mtime = mtime

    @property
    def active_version(self) -> str:
        return self.version if self.active.version == "base" else self.active.version

    @property
    def thresholds(self) -> dict:
        return self.active.thresholds or self.contract["decision"]["thresholds"]

    # ── preprocessing (identical to training/oralscreen/inference_reference.py) ──
    def preprocess(self, data: bytes) -> np.ndarray:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        w, h = im.size
        s = self.size / max(w, h)
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        im = im.resize((nw, nh), Image.BILINEAR if s >= 1 else Image.BOX)
        canvas = Image.new("RGB", (self.size, self.size), self.pad)
        canvas.paste(im, ((self.size - nw) // 2, (self.size - nh) // 2))
        x = (np.asarray(canvas, np.float32) / 255.0 - self.mean) / self.std
        return x.transpose(2, 0, 1)

    @staticmethod
    def letterbox_box(w: int, h: int, size: int) -> tuple[int, int, int, int]:
        s = size / max(w, h)
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        left, top = (size - nw) // 2, (size - nh) // 2
        return left, top, nw, nh

    def run(self, batch: np.ndarray) -> dict:
        self.refresh_heads()
        emb, feats = self.sess.run(None, {"input": batch.astype(np.float32)})
        prob, logit = self.active.prob(emb)
        cam = self.active.cam(feats)
        out = {"prob": prob, "logit": logit, "embedding": emb, "cam": cam}
        if self.shadow is not None:
            out["shadow_prob"], _ = self.shadow.prob(emb)
        if self.ood is not None:
            d = emb - self.ood["mean"]
            maha = np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", d, self.ood["precision"], d), 0))
            out["ood_distance"] = maha
            out["ood"] = maha > float(self.ood["threshold_p99"])
        return out

    def info(self) -> dict:
        return {"model_version": self.version, "active_version": self.active_version,
                "active_head": self.active.version, "shadow_head": self.shadow.version if self.shadow else None,
                "backbone": self.contract.get("backbone"), "precision": self.precision,
                "backbone_file": self.backbone_file, "input_size": self.size,
                "embedding_dim": int(self.base_head.w.shape[0]), "thresholds": self.thresholds,
                "contract_sha256": self.contract_sha, "files_sha256": self.file_sha,
                "placeholder": self.is_placeholder,
                "disclaimer": self.contract.get("disclaimer")}
