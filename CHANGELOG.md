# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-05

The backend platform.

### Added
- FastAPI service with about 100 endpoints: patients and consent, screening submission with checksummed uploads
  and idempotent retries, referrals, specialist review, follow-ups, analytics, governance, audit, administration,
  Twilio webhooks and FHIR R4.
- Inference service (ONNX Runtime, INT8): probability, heat map, embedding, out-of-distribution distance and
  shadow-head scoring; placeholder model for installations without the trained model.
- Screening pipeline in Celery workers behind a transactional outbox, with server-side photo quality gate
  (sharpness cut-off calibrated on the clinical benchmark) and per-site score selection.
- Clinical decision engine with versioned rule sets, maker-checker approval, fail-safe rules and decision replay.
  Default rules combine the AI with habits, symptoms, mouth opening and the symptom timeline; AI-only and
  unclear-photo flags go to review instead of automatic referral.
- Retake workflow for flagged or unusable sites with a 24-hour timeout to the specialist queue.
- Care continuity: nearest-facility referrals (PostGIS), SMS and voice check-ins, signed QR referral slips,
  follow-ups, Provider Connect with patient one-time codes, automatic referral after specialist confirmation.
- MLOps: head retraining on specialist labels, fixed benchmark, shadow mode, approval, rollback and lineage.
- Security: Keycloak, OPA policies, PostgreSQL row-level security, hash-chained audit log, Vault, Traefik.
- Docker Compose stack, operations scripts (status, demo, chaos, backup, reset) and documentation.
- CI: backend lint and unit tests, OPA policy tests, compose validation; weekly full-stack end-to-end workflow.

## [0.1.0] - 2026-11-05

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

[Unreleased]: https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Mohit-20-m/Sankalp_Oral_Cancer/releases/tag/v0.1.0
