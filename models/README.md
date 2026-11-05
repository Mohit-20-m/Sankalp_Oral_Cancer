# Models

Model **weights are not stored in git**. They are published as assets of the GitHub Release
[`v0.1.0`](https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/releases/tag/v0.1.0) and verified by checksum on download.

```bash
./scripts/fetch-model.sh            # downloads, verifies SHA-256 and unpacks into models/current/
./scripts/fetch-model.sh --with-checkpoint   # also the PyTorch checkpoint for fine-tuning
```

| Path | In git | Contents |
|---|---|---|
| [`MODEL_CARD.md`](MODEL_CARD.md) | ✅ | Intended use, results, data, limitations |
| [`v1.0.0/model_contract.json`](v1.0.0/model_contract.json) | ✅ | The integration contract: preprocessing, inputs/outputs, thresholds, parity checks |
| [`v1.0.0/model_card.json`](v1.0.0/model_card.json) | ✅ | Machine-readable card (all metrics with CIs) |
| [`v1.0.0/training_config.json`](v1.0.0/training_config.json) | ✅ | Effective training configuration |
| [`v1.0.0/reports/`](v1.0.0/reports) | ✅ | ROC, confusion, calibration, training curves, CV, per-source results, dataset scan |
| `current/` | ❌ | Unpacked release bundle (what the backend serves) |

## Release bundle (`sankalp-model-1.0.0.zip`)

```
current/
├── model_contract.json          integration contract (see below)
├── model_card.json
├── backbone.onnx                image → embedding [N,1280] + CAM features [N,1280,7,7]
├── backbone_int8.onnx           dynamic INT8, default for CPU serving
├── lesion_model.onnx            image → prob, logit, embedding, cam (full model)
├── lesion_model_int8.onnx
├── head.json                    linear head (Platt calibration folded in) + thresholds
├── ood_stats.npz                Mahalanobis mean / precision / thresholds for "cannot assess"
├── reference/                   embeddings + labels of the development set (similar-case search, head retraining)
└── inference_reference.py       standalone numpy + onnxruntime reference implementation
```

`lesion_model-1.0.0.pt` (PyTorch checkpoint) is a separate asset.

**Not redistributed:** the benchmark and reference *images* come from public datasets whose licences vary, so the
bundle contains their embeddings but not the photographs. Similar-case search therefore shows cases without
thumbnails, and the fixed-benchmark comparison used for head retraining needs the images to be re-created with
the training pipeline.

## Contract in one paragraph

Decode the image, apply EXIF orientation, convert to RGB; letterbox the longest side to 224 px (area interpolation
when shrinking) and pad to 224 × 224 with RGB (124, 116, 104); scale to [0, 1] and normalise with ImageNet
mean/std; feed NCHW float32 as `input`. `prob = sigmoid(w · embedding + b)` with the weights in `head.json`;
refer if `prob ≥ 0.780` (screening threshold). Every client — backend, phone, notebook — must reproduce
[`inference_reference.py`](../training/oralscreen/inference_reference.py) within 1e-3.
