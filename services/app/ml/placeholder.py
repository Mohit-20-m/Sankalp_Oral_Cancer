"""Generates a PLACEHOLDER model folder that follows the model contract exactly.

Why: the whole platform (inference, heat maps, similar cases, retraining, champion/challenger, phone model
download) must run before the real model is installed. The placeholder is a tiny fixed-filter
CNN whose head is fitted on SYNTHETIC images (white patch = refer, red spot = no_refer). It has no
clinical meaning — every API response from it carries "placeholder": true.

Replace it by running scripts/fetch-model.sh and restarting.
"""
from __future__ import annotations

import csv
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
PAD = [124, 116, 104]
SIZE = 224
DIM = 96
STRIDE = 32


def synthetic_mouth(rng: np.random.Generator, refer: bool, w: int = 360, h: int = 300) -> Image.Image:
    img = np.zeros((h, w, 3), np.float32)
    img[:] = (185 + rng.normal(0, 10), 90 + rng.normal(0, 10), 100 + rng.normal(0, 10))
    yy, xx = np.mgrid[0:h, 0:w]
    img += (np.sin(xx / rng.uniform(30, 70)) * 6)[..., None]
    img += rng.normal(0, 8, img.shape)
    for _ in range(int(rng.integers(1, 3))):
        cy, cx, r = rng.integers(50, h - 50), rng.integers(50, w - 50), rng.integers(22, 55)
        m = (yy - cy) ** 2 + ((xx - cx) * rng.uniform(0.7, 1.3)) ** 2 < r ** 2
        img[m] = (238, 234, 226) if refer else (205, 45, 55)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def _preprocess(im: Image.Image) -> np.ndarray:
    w, h = im.size
    s = SIZE / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    im = im.resize((nw, nh), Image.BILINEAR if s >= 1 else Image.BOX)
    canvas = Image.new("RGB", (SIZE, SIZE), tuple(PAD))
    canvas.paste(im, ((SIZE - nw) // 2, (SIZE - nh) // 2))
    return ((np.asarray(canvas, np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)


def _build_onnx(conv_w, conv_b, head_w, head_b, out_dir: Path) -> dict:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    def common_nodes():
        return [
            helper.make_node("Conv", ["input", "conv_w", "conv_b"], ["conv"], strides=[STRIDE, STRIDE]),
            helper.make_node("Relu", ["conv"], ["cam_features"]),
            helper.make_node("GlobalAveragePool", ["cam_features"], ["gap"]),
            helper.make_node("Flatten", ["gap"], ["embedding"], axis=1),
        ]

    grid = SIZE // STRIDE
    inits = [numpy_helper.from_array(conv_w, "conv_w"), numpy_helper.from_array(conv_b, "conv_b")]
    inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", 3, SIZE, SIZE])
    emb_out = helper.make_tensor_value_info("embedding", TensorProto.FLOAT, ["batch", DIM])
    feat_out = helper.make_tensor_value_info("cam_features", TensorProto.FLOAT, ["batch", DIM, grid, grid])
    bb = helper.make_model(helper.make_graph(common_nodes(), "placeholder_backbone", [inp], [emb_out, feat_out],
                                             inits), opset_imports=[helper.make_opsetid("", 17)])
    bb.ir_version = 8
    onnx.checker.check_model(bb)
    onnx.save(bb, str(out_dir / "backbone.onnx"))

    head_inits = inits + [
        numpy_helper.from_array(head_w.reshape(DIM, 1).astype(np.float32), "head_w"),
        numpy_helper.from_array(np.array([head_b], np.float32), "head_b"),
        numpy_helper.from_array(head_w.reshape(1, DIM, 1, 1).astype(np.float32), "cam_w"),
        numpy_helper.from_array(np.array([1], np.int64), "axis1"),
        numpy_helper.from_array(np.array([1e-6], np.float32), "eps"),
    ]
    nodes = common_nodes() + [
        helper.make_node("Gemm", ["embedding", "head_w", "head_b"], ["logit2d"]),
        helper.make_node("Flatten", ["logit2d"], ["logit_f"], axis=0),
        helper.make_node("Squeeze", ["logit_f"], ["logit_s"], ),
        helper.make_node("Reshape", ["logit2d", "neg1"], ["logit"]),
        helper.make_node("Sigmoid", ["logit"], ["prob"]),
        helper.make_node("Mul", ["cam_features", "cam_w"], ["cam_mul"]),
        helper.make_node("ReduceSum", ["cam_mul", "axis1"], ["cam_sum"], keepdims=0),
        helper.make_node("Relu", ["cam_sum"], ["cam_relu"]),
        helper.make_node("ReduceMax", ["cam_relu"], ["cam_max"], axes=[1, 2], keepdims=1),
        helper.make_node("Add", ["cam_max", "eps"], ["cam_den"]),
        helper.make_node("Div", ["cam_relu", "cam_den"], ["cam"]),
    ]
    head_inits.append(numpy_helper.from_array(np.array([-1], np.int64), "neg1"))
    # drop the two helper nodes we don't need (kept simple: Flatten/Squeeze unused outputs are pruned)
    nodes = [n for n in nodes if n.output[0] not in ("logit_f", "logit_s")]
    outs = [helper.make_tensor_value_info("prob", TensorProto.FLOAT, ["batch"]),
            helper.make_tensor_value_info("logit", TensorProto.FLOAT, ["batch"]),
            helper.make_tensor_value_info("embedding", TensorProto.FLOAT, ["batch", DIM]),
            helper.make_tensor_value_info("cam", TensorProto.FLOAT, ["batch", grid, grid])]
    full = helper.make_model(helper.make_graph(nodes, "placeholder_full", [inp], outs, head_inits),
                             opset_imports=[helper.make_opsetid("", 17)])
    full.ir_version = 8
    onnx.checker.check_model(full)
    onnx.save(full, str(out_dir / "lesion_model.onnx"))
    return {"full_fp32": "lesion_model.onnx", "backbone_fp32": "backbone.onnx"}, grid


def generate(out_dir: str | Path, n_train: int = 240, n_bench: int = 60, seed: int = 7) -> Path:
    import onnxruntime as ort
    from sklearn.covariance import LedoitWolf
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_curve

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    conv_w = rng.normal(0, 0.02, (DIM, 3, STRIDE, STRIDE)).astype(np.float32)
    # a few interpretable colour detectors (mean R, G, B and "whiteness") make the toy task learnable
    for c, wts in enumerate(([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 1, 1], [1, -1, -1])):
        conv_w[c] = np.asarray(wts, np.float32)[:, None, None] / (STRIDE * STRIDE)
    conv_b = rng.normal(0, 0.05, DIM).astype(np.float32)
    files, grid = _build_onnx(conv_w, conv_b, np.zeros(DIM, np.float32), 0.0, out)
    sess = ort.InferenceSession(str(out / "backbone.onnx"), providers=["CPUExecutionProvider"])

    def embed(images):
        x = np.stack([_preprocess(im) for im in images])
        return sess.run(None, {"input": x})[0]

    tr_imgs = [synthetic_mouth(rng, i % 2 == 0) for i in range(n_train)]
    tr_y = np.array([1 if i % 2 == 0 else 0 for i in range(n_train)])
    E = embed(tr_imgs)
    lr = LogisticRegression(C=1.0, max_iter=3000, class_weight="balanced").fit(E, tr_y)
    w, b = lr.coef_[0].astype(np.float32), float(lr.intercept_[0])
    files, grid = _build_onnx(conv_w, conv_b, w, b, out)

    # thresholds on a calibration split of the training embeddings
    p = 1 / (1 + np.exp(-(E @ w + b)))
    fpr, tpr, thr = roc_curve(tr_y, p)
    thr = np.clip(thr, 0, 1)
    balanced = float(thr[int(np.argmax(tpr - fpr))])
    ok = np.where(tpr >= 0.9)[0]
    screening = min(float(thr[ok[0]]) if len(ok) else balanced, balanced)
    thresholds = {"balanced": balanced, "screening": screening}
    head = {"head_version": "placeholder-0.1", "weights": w.tolist(), "bias": b, "temperature": 1.0,
            "embedding_dim": DIM, "thresholds": thresholds}
    (out / "head.json").write_text(json.dumps(head))

    lw = LedoitWolf().fit(E)
    d = E - lw.location_
    maha = np.sqrt(np.einsum("ij,jk,ik->i", d, lw.precision_, d))
    np.savez_compressed(out / "ood_stats.npz", mean=lw.location_.astype(np.float32),
                        precision=lw.precision_.astype(np.float32),
                        threshold_p95=np.float32(np.percentile(maha, 95) * 1.5),
                        threshold_p99=np.float32(np.percentile(maha, 99) * 2.0))

    # reference set (similar-case search + head retraining) and fixed benchmark
    ref = out / "reference"
    (ref / "thumbs").mkdir(parents=True, exist_ok=True)
    np.save(ref / "embeddings_raw.npy", E.astype(np.float32))
    np.save(ref / "embeddings.npy", (E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-8)).astype(np.float32))
    with open(ref / "index.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["ref_id", "label", "source", "thumbnail", "split"])
        for i, (im, y) in enumerate(zip(tr_imgs, tr_y)):
            name = f"thumbs/ref_{i:05d}.jpg"
            im.copy().resize((192, 160)).save(ref / name, quality=85)
            wr.writerow([i, "refer" if y else "no_refer", "synthetic-placeholder", name, "dev"])
    bench = out / "benchmark"
    (bench / "images").mkdir(parents=True, exist_ok=True)
    with open(bench / "manifest.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["image", "label", "y", "source"])
        for i in range(n_bench):
            y = int(i % 2 == 0)
            name = f"images/bench_{i:05d}.jpg"
            synthetic_mouth(rng, bool(y)).save(bench / name, quality=92)
            wr.writerow([name, "refer" if y else "no_refer", y, "synthetic-placeholder"])

    contract = {
        "contract_version": "1.0", "model_name": "oralscreen-lesion-triage", "model_version": "placeholder-0.1",
        "placeholder": True, "backbone": "placeholder-fixed-filter-cnn",
        "task": "binary triage: refer (suspicious, needs specialist) vs no_refer", "positive_class": "refer",
        "files": files,
        "input": {"name": "input", "dtype": "float32", "layout": "NCHW", "shape": ["batch", 3, SIZE, SIZE],
                  "color": "RGB", "mean": MEAN.tolist(), "std": STD.tolist(), "pad_rgb": PAD, "size": SIZE,
                  "preprocessing": ["decode, EXIF orientation, RGB", f"letterbox longest side to {SIZE}",
                                    f"pad to {SIZE}x{SIZE} with {PAD}", "scale to [0,1], normalise mean/std"]},
        "outputs_full_model": {"prob": "[batch]", "logit": "[batch]", "embedding": f"[batch, {DIM}]",
                               "cam": f"[batch, {grid}, {grid}]"},
        "outputs_backbone_model": {"embedding": f"[batch, {DIM}]", "cam_features": f"[batch, {DIM}, {grid}, {grid}]"},
        "head_formula": {"prob": "sigmoid((dot(weights, embedding) + bias) / temperature)",
                         "cam": "relu(sum_d weights[d] * cam_features[d]) / (max + 1e-6)"},
        "decision": {"thresholds": thresholds, "per_person_score": "maximum prob across the 6 mouth sites"},
        "ood_file": "ood_stats.npz", "parity": {"int8_recommended": False},
        "disclaimer": "PLACEHOLDER MODEL trained on synthetic images — NOT for clinical use. "
                      "Install the trained model with scripts/fetch-model.sh.",
    }
    (out / "model_contract.json").write_text(json.dumps(contract, indent=2))
    (out / "model_card.json").write_text(json.dumps({
        "model_name": "oralscreen-lesion-triage", "model_version": "placeholder-0.1",
        "created": time.strftime("%Y-%m-%d %H:%M:%S"), "placeholder": True,
        "intended_use": "Integration testing of the backend before the trained model is installed.",
        "not_intended_for": ["any clinical use"],
        "training_data": {"sources": {"synthetic-placeholder": n_train}},
        "limitations": ["Trained on synthetic coloured blobs. Has no knowledge of real oral lesions."]},
        indent=2))
    (out / "PLACEHOLDER.txt").write_text("This folder contains a generated placeholder model. Replace it with the "
                                         "trained model (scripts/fetch-model.sh).\n")
    return out


if __name__ == "__main__":
    import sys

    print(generate(sys.argv[1] if len(sys.argv) > 1 else "/models/current"))
