"""Reference inference for the exported OralScreen model — STANDALONE (numpy, PIL, onnxruntime only).

This file is copied into the artifacts. The backend and the mobile app must
reproduce exactly this behaviour. Run it to check a set of artifacts:

    python inference_reference.py --artifacts ./artifacts --image some_photo.jpg
    python inference_reference.py --artifacts ./artifacts --verify     # checks both model forms on the benchmark
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


class LesionModel:
    def __init__(self, artifacts: str | Path, form: str = "full", int8: bool = False):
        import onnxruntime as ort

        self.dir = Path(artifacts)
        self.contract = json.loads((self.dir / "model_contract.json").read_text())
        self.head = json.loads((self.dir / "head.json").read_text())
        files = self.contract["files"]
        key = ("full" if form == "full" else "backbone") + ("_int8" if int8 else "_fp32")
        if key not in files:
            key = key.replace("_int8", "_fp32")
        self.form = form
        self.sess = ort.InferenceSession(str(self.dir / files[key]), providers=["CPUExecutionProvider"])
        inp = self.contract["input"]
        self.size = int(inp["size"])
        self.mean = np.array(inp["mean"], np.float32)
        self.std = np.array(inp["std"], np.float32)
        self.pad = tuple(inp["pad_rgb"])
        self.w = np.array(self.head["weights"], np.float32)
        self.b = float(self.head["bias"])
        self.t = float(self.head.get("temperature", 1.0))
        ood = self.dir / self.contract.get("ood_file", "ood_stats.npz")
        self.ood = dict(np.load(ood)) if ood.exists() else None

    # --- preprocessing exactly as in the contract ---------------------------
    def preprocess(self, path_or_pil) -> np.ndarray:
        im = Image.open(path_or_pil) if isinstance(path_or_pil, (str, Path)) else path_or_pil
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        s = self.size / max(w, h)
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        im = im.resize((nw, nh), Image.BILINEAR if s >= 1 else Image.BOX)
        canvas = Image.new("RGB", (self.size, self.size), self.pad)
        canvas.paste(im, ((self.size - nw) // 2, (self.size - nh) // 2))
        x = np.asarray(canvas, np.float32) / 255.0
        x = (x - self.mean) / self.std
        return x.transpose(2, 0, 1)[None].astype(np.float32)

    def predict_tensor(self, x: np.ndarray) -> dict:
        out = self.sess.run(None, {"input": x})
        if self.form == "full":
            prob, _logit, emb, cam = out
        else:
            emb, feats = out
            logit = emb @ self.w + self.b
            prob = 1 / (1 + np.exp(-logit / self.t))
            cam = np.maximum(np.einsum("d,ndhw->nhw", self.w, feats), 0)
            cam = cam / (cam.reshape(len(cam), -1).max(1)[:, None, None] + 1e-6)
        res = {"prob": prob.astype(float), "embedding": emb, "cam": cam}
        if self.ood is not None:
            d = emb - self.ood["mean"]
            maha = np.sqrt(np.einsum("ij,jk,ik->i", d, self.ood["precision"], d))
            res["ood_distance"] = maha
            res["out_of_distribution"] = maha > float(self.ood["threshold_p99"])
        return res

    def predict(self, path) -> dict:
        r = self.predict_tensor(self.preprocess(path))
        thr = self.contract["decision"]["thresholds"]
        p = float(r["prob"][0])
        return {"prob_refer": p,
                "refer_screening": p >= thr["screening"],
                "refer_balanced": p >= thr["balanced"],
                "cannot_assess": bool(r.get("out_of_distribution", [False])[0]),
                "cam_shape": list(r["cam"].shape[1:])}


def verify(artifacts: Path) -> dict:
    """Both model forms (and INT8) must agree on the fixed benchmark set."""
    bdir = artifacts / "benchmark"
    rows = list(csv.DictReader(open(bdir / "manifest.csv")))
    if not rows:
        return {"ok": False, "reason": "empty benchmark"}
    full = LesionModel(artifacts, "full")
    bb = LesionModel(artifacts, "backbone")
    full8 = LesionModel(artifacts, "full", int8=True)
    pf, pb, p8, ys = [], [], [], []
    for r in rows:
        x = full.preprocess(bdir / r["image"])
        pf.append(full.predict_tensor(x)["prob"][0])
        pb.append(bb.predict_tensor(x)["prob"][0])
        p8.append(full8.predict_tensor(x)["prob"][0])
        ys.append(int(r["y"]))
    pf, pb, p8, ys = map(np.array, (pf, pb, p8, ys))
    thr = full.contract["decision"]["thresholds"]["screening"]
    pred = pf >= thr
    sens = (pred & (ys == 1)).sum() / max(1, (ys == 1).sum())
    spec = (~pred & (ys == 0)).sum() / max(1, (ys == 0).sum())
    rep = {"n": int(len(ys)),
           "full_vs_backbone_head_max_diff": float(np.abs(pf - pb).max()),
           "fp32_vs_int8_max_diff": float(np.abs(pf - p8).max()),
           "benchmark_accuracy_screening": float((pred == ys).mean()),
           "benchmark_sensitivity_screening": float(sens), "benchmark_specificity_screening": float(spec)}
    rep["ok"] = rep["full_vs_backbone_head_max_diff"] < 1e-3
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", default=".")
    ap.add_argument("--image")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        print(json.dumps(verify(Path(a.artifacts)), indent=2))
    if a.image:
        print(json.dumps(LesionModel(a.artifacts).predict(a.image), indent=2))


if __name__ == "__main__":
    main()
