#!/usr/bin/env bash
# PostgreSQL backups with pgBackRest (full | incr | info | check).  Restore: see README → Backups.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T -u postgres postgres oralscreen-backup "${1:-full}"
