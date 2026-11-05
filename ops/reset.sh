#!/usr/bin/env bash
# Deletes ALL data (database, photos, models volume, Vault) and starts fresh.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "This deletes all OralScreen data volumes. Type 'reset' to continue: " a
[ "$a" = "reset" ] || exit 1
docker compose --profile monitoring --profile mlops --profile hapi --profile tunnel down -v
echo "Done. Start again with: docker compose up --build"
