#!/usr/bin/env bash
# Runs the full end-to-end story (Shekhar, Lalitha, governance, MLOps) against the running stack.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T worker python scripts/demo_journey.py --base https://traefik --insecure "$@"
