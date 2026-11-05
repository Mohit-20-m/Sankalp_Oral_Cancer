# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-11-05

First public release: the lesion triage model.

### Added
- Training pipeline (`training/`): dataset discovery and label mapping, duplicate grouping (MD5, dihedral pHash,
  embeddings), group-aware stratified splits, backbone selection, 5-fold cross-validation, calibrated final
  training, held-out evaluation with bootstrap confidence intervals, ONNX FP32/INT8 export with parity checks.
- Kaggle training notebook for model v1.0.0.
- Model `oralscreen-lesion-triage` v1.0.0 (EfficientNetV2-S): held-out test AUC 0.969, sensitivity 0.914,
  specificity 0.950 at the screening threshold. Model card, integration contract and evaluation reports.
- Release assets: model bundle and PyTorch checkpoint, with `scripts/fetch-model.sh` for verified download.
- CI: training-code lint, model-metadata and notebook validation, shellcheck.

[Unreleased]: https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/releases/tag/v0.1.0
