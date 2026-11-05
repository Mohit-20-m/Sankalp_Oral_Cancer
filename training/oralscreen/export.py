"""ONNX export, INT8 quantisation, parity checks, and the model contract.

Two deployable forms (both described in model_contract.json):
  A) lesion_model.onnx   x -> prob, logit, embedding, cam      (head + temperature baked in)
  B) backbone.onnx       x -> embedding, cam_features          + head.json (w, b, T)
     Form B lets the backend retrain ONLY the head on cached embeddings and ship a
     new head.json in seconds; the phone/backend compute (calibration folded into w, b; T = 1)
        prob = sigmoid((w·embedding + b) / T)
        cam  = relu(sum_d w_d * cam_features_d) / max
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from .imaging import MEAN, PAD_RGB, STD
from .utils import LOG, save_json


class FullExport(nn.Module):
    def __init__(self, net, calib: dict):
        super().__init__()
        self.net = net
        self.register_buffer("cal_a", torch.tensor(float(calib["a"]), dtype=torch.float32))
        self.register_buffer("cal_c", torch.tensor(float(calib["c"]), dtype=torch.float32))

    def forward(self, x):
        feats = self.net.backbone.forward_features(x)
        emb = self.net.backbone.forward_head(feats, pre_logits=True)
        logit = self.net.head(emb).squeeze(1)
        prob = torch.sigmoid(self.cal_a * logit + self.cal_c)
        f = self.net.cam_features(x)
        w = self.net.head.weight.view(1, -1, 1, 1)
        c = torch.relu((f * w).sum(1))
        cam = c / (c.flatten(1).amax(1).view(-1, 1, 1) + 1e-6)
        return prob, logit, emb, cam


class BackboneExport(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        feats = self.net.backbone.forward_features(x)
        emb = self.net.backbone.forward_head(feats, pre_logits=True)
        return emb, self.net.cam_features(x)


def _export(module, path: Path, size: int, out_names, opset: int):
    module = module.cpu().eval()
    dummy = torch.randn(1, 3, size, size)
    dyn = {"input": {0: "batch"}}
    for n in out_names:
        dyn[n] = {0: "batch"}
    kwargs = dict(input_names=["input"], output_names=out_names, dynamic_axes=dyn,
                  opset_version=opset, do_constant_folding=True)
    import inspect

    # Always use the classic TorchScript exporter (stable across torch versions, works with
    # dynamic batch + onnxruntime quantisation). Newer torch defaults to dynamo, so opt out.
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        kwargs["dynamo"] = False
    with torch.no_grad():
        torch.onnx.export(module, dummy, str(path), **kwargs)
    import onnx

    onnx.checker.check_model(onnx.load(str(path)))


def quantize_int8(src: Path, dst: Path) -> bool:
    """Dynamic INT8 on MatMul/Gemm (the bulk of ConvNeXt/ViT weights). Conv layers stay FP32:
    ConvInteger is poorly supported in ONNX Runtime Web/mobile, so quantising them hurts."""
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        pre = src.with_name(src.stem + "_pre.onnx")
        try:
            from onnxruntime.quantization.shape_inference import quant_pre_process

            quant_pre_process(str(src), str(pre), skip_symbolic_shape=True)
            inp = pre
        except Exception as e:  # noqa: BLE001
            LOG.info("quant pre-processing skipped for %s (%s)", src.name, e)
            inp = src
        quantize_dynamic(str(inp), str(dst), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
        if pre.exists():
            pre.unlink()
        return True
    except Exception as e:  # noqa: BLE001
        LOG.warning("INT8 quantisation failed for %s (%s)", src.name, e)
        return False


def run_onnx(path: Path, x: np.ndarray, batch: int = 32):
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    outs = None
    for s in range(0, len(x), batch):
        o = sess.run(None, {"input": x[s:s + batch].astype(np.float32)})
        outs = [o_i for o_i in o] if outs is None else [np.concatenate([a, b]) for a, b in zip(outs, o)]
    return outs


def export_all(net, calib: dict, thresholds: dict, size: int, out_dir: Path, cfg: dict,
               parity_x: np.ndarray, parity_y: np.ndarray) -> dict:
    """Export both forms (+INT8), verify against PyTorch, write head.json + contract."""
    out_dir.mkdir(parents=True, exist_ok=True)
    opset = cfg["export"]["opset"]
    net = net.cpu().eval()
    full_p, bb_p = out_dir / "lesion_model.onnx", out_dir / "backbone.onnx"
    _export(FullExport(net, calib), full_p, size, ["prob", "logit", "embedding", "cam"], opset)
    _export(BackboneExport(net), bb_p, size, ["embedding", "cam_features"], opset)

    files = {"full_fp32": full_p.name, "backbone_fp32": bb_p.name}
    if cfg["export"].get("int8", True):
        for src, key in ((full_p, "full_int8"), (bb_p, "backbone_int8")):
            dst = src.with_name(src.stem + "_int8.onnx")
            if quantize_int8(src, dst):
                files[key] = dst.name

    # --- parity: ONNX must reproduce PyTorch, and INT8 must not lose accuracy
    from sklearn.metrics import roc_auc_score

    with torch.no_grad():
        t_logit, _ = net(torch.from_numpy(parity_x))
    t_prob = 1 / (1 + np.exp(-(calib["a"] * t_logit.numpy() + calib["c"])))
    parity = {}
    for key in ("full_fp32", "full_int8"):
        if key not in files:
            continue
        prob = run_onnx(out_dir / files[key], parity_x)[0]
        d = {"max_abs_diff_vs_torch": float(np.max(np.abs(prob - t_prob)))}
        if len(np.unique(parity_y)) == 2:
            d["auc"] = float(roc_auc_score(parity_y, prob))
        parity[key] = d
    if "full_int8" in parity and "auc" in parity["full_int8"]:
        drop = parity["full_fp32"]["auc"] - parity["full_int8"]["auc"]
        parity["int8_auc_drop"] = float(drop)
        parity["int8_recommended"] = bool(drop <= 0.01)
    LOG.info("ONNX parity: %s", parity)

    # Platt calibration folded into the head: prob = sigmoid(w'·e + b'), w' = a·w, b' = a·b + c
    a, c = float(calib["a"]), float(calib["c"])
    w = net.head.weight.detach().numpy().reshape(-1).astype(np.float64)
    b = float(net.head.bias.detach().numpy().reshape(-1)[0])
    head = {"head_version": cfg["project"]["model_version"], "weights": (a * w).tolist(), "bias": a * b + c,
            "temperature": 1.0, "embedding_dim": int(w.shape[0]), "calibration_folded": {"a": a, "c": c},
            "thresholds": thresholds}
    save_json(head, out_dir / "head.json")

    with torch.no_grad():
        _, cf = BackboneExport(net)(torch.zeros(1, 3, size, size))
    contract = {
        "contract_version": "1.0",
        "model_name": cfg["project"]["name"],
        "model_version": cfg["project"]["model_version"],
        "backbone": net.timm_name,
        "task": "binary triage: refer (suspicious, needs specialist) vs no_refer",
        "positive_class": "refer",
        "files": files,
        "input": {
            "name": "input", "dtype": "float32", "layout": "NCHW", "shape": ["batch", 3, size, size],
            "color": "RGB",
            "preprocessing": [
                "decode image, apply EXIF orientation, convert to RGB",
                f"letterbox: resize longest side to {size} keeping aspect ratio (INTER_AREA when shrinking)",
                f"pad to {size}x{size}, image centred, pad colour RGB {list(PAD_RGB)}",
                "scale to [0,1], subtract mean, divide by std (per channel)",
            ],
            "mean": MEAN.tolist(), "std": STD.tolist(), "pad_rgb": list(PAD_RGB), "size": size,
        },
        "outputs_full_model": {
            "prob": "float32 [batch] calibrated probability of 'refer' (Platt calibration applied)",
            "logit": "float32 [batch] raw logit (before calibration)",
            "embedding": f"float32 [batch, {w.shape[0]}] pooled features (use L2-normalised for similarity search)",
            "cam": f"float32 [batch, {cf.shape[2]}, {cf.shape[3]}] heat map in [0,1]; upsample to image size",
        },
        "outputs_backbone_model": {
            "embedding": f"float32 [batch, {w.shape[0]}]",
            "cam_features": f"float32 [batch, {w.shape[0]}, {cf.shape[2]}, {cf.shape[3]}]",
        },
        "head_formula": {
            "prob": "sigmoid((dot(weights, embedding) + bias) / temperature)",
            "cam": "relu(sum_d weights[d] * cam_features[d]) / (max + 1e-6)",
        },
        "decision": {
            "thresholds": thresholds,
            "meaning": {
                "screening": "default operating point; tuned on calibration data to reach the target sensitivity",
                "balanced": "maximises balanced accuracy on calibration data",
            },
            "per_person_score": "maximum prob across the 6 mouth sites",
        },
        "ood_file": "ood_stats.npz",
        "disclaimer": "Screening decision-support aid only. Not a diagnostic device.",
        "parity": parity,
    }
    save_json(contract, out_dir / "model_contract.json")
    return contract
