#!/usr/bin/env bash
# Download the trained model from the GitHub Release, verify its SHA-256 and unpack it into models/current/.
#
#   ./scripts/fetch-model.sh                    # model bundle (ONNX FP32 + INT8, head, contract, OOD stats, embeddings)
#   ./scripts/fetch-model.sh --with-checkpoint  # + PyTorch checkpoint (for fine-tuning) into models/checkpoints/
#   ./scripts/fetch-model.sh --force            # re-download even if models/current/ is already this version
#
# Environment overrides: AROGYA_REPO (owner/name), AROGYA_MODEL_TAG (release tag), AROGYA_MODEL_VERSION,
# AROGYA_MODEL_BASE_URL (download from a mirror instead of GitHub Releases).
set -euo pipefail

REPO="${AROGYA_REPO:-Mohit-20-m/Sankalp_Oral_Cancer}"
TAG="${AROGYA_MODEL_TAG:-v0.1.0}"
VERSION="${AROGYA_MODEL_VERSION:-1.0.0}"
BUNDLE="sankalp-model-${VERSION}.zip"
CHECKPOINT="lesion_model-${VERSION}.pt"
BASE="${AROGYA_MODEL_BASE_URL:-https://github.com/${REPO}/releases/download/${TAG}}"   # override for a mirror

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="${ROOT}/models"
WITH_CKPT=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --with-checkpoint) WITH_CKPT=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v unzip >/dev/null || die "unzip is required"
if command -v sha256sum >/dev/null; then SHA=(sha256sum); elif command -v shasum >/dev/null; then SHA=(shasum -a 256); else die "sha256sum or shasum is required"; fi

if [[ $FORCE -eq 0 && -f "${MODELS}/current/model_contract.json" ]] \
   && grep -q "\"model_version\": \"${VERSION}\"" "${MODELS}/current/model_contract.json" \
   && [[ $WITH_CKPT -eq 0 || -f "${MODELS}/checkpoints/${CHECKPOINT}" ]]; then
  say "models/current already holds model ${VERSION} — nothing to do (use --force to re-download)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  say "downloading $1"
  curl -fL --retry 3 --progress-bar -o "${TMP}/$1" "${BASE}/$1" || die "download failed: ${BASE}/$1"
}

verify() {
  local expected actual
  expected="$(awk -v f="$1" '$2 == f || $2 == "*"f {print $1}' "${TMP}/SHA256SUMS")"
  [[ -n "$expected" ]] || die "no checksum listed for $1"
  actual="$("${SHA[@]}" "${TMP}/$1" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || die "checksum mismatch for $1 (expected $expected, got $actual)"
  say "checksum ok: $1"
}

fetch SHA256SUMS
fetch "$BUNDLE"
verify "$BUNDLE"

mkdir -p "$MODELS"
rm -rf "${MODELS}/current.new"
mkdir -p "${MODELS}/current.new"
unzip -q "${TMP}/${BUNDLE}" -d "${MODELS}/current.new"
[[ -f "${MODELS}/current.new/current/model_contract.json" ]] || die "bundle does not contain current/model_contract.json"
rm -rf "${MODELS}/current"
mv "${MODELS}/current.new/current" "${MODELS}/current"
rm -rf "${MODELS}/current.new"
say "model ${VERSION} installed in models/current/"

if [[ $WITH_CKPT -eq 1 ]]; then
  fetch "$CHECKPOINT"
  verify "$CHECKPOINT"
  mkdir -p "${MODELS}/checkpoints"
  mv "${TMP}/${CHECKPOINT}" "${MODELS}/checkpoints/${CHECKPOINT}"
  say "checkpoint saved to models/checkpoints/${CHECKPOINT}"
fi
