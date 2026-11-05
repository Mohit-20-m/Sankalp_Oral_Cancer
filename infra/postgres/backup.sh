#!/bin/bash
# docker compose exec -u postgres postgres oralscreen-backup [full|incr|info|check]
set -euo pipefail
case "${1:-incr}" in
  full|incr|diff) pgbackrest --stanza=oralscreen --type="$1" backup && pgbackrest --stanza=oralscreen info ;;
  info)           pgbackrest --stanza=oralscreen info ;;
  check)          pgbackrest --stanza=oralscreen check ;;
  *) echo "usage: oralscreen-backup [full|incr|diff|info|check]"; exit 2 ;;
esac
