#!/usr/bin/env bash
# Fault-tolerance demo. Each scenario breaks one part of the running stack and shows the system staying safe.
#   ./ops/chaos.sh [inference|redis|api|audit|all]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
RUN="docker compose exec -T worker python scripts/quick_screen.py --base https://traefik --insecure"
bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }

inference() {
  bold "1) AI service down → screening is NOT called low risk; it is retried automatically"
  docker compose stop inference
  ( sleep 30; docker compose up -d --no-deps inference >/dev/null 2>&1; echo "   … inference service restarted" ) &
  $RUN --expect NEEDS_REVIEW --wait-final 300
  wait
}

redis() {
  bold "2) Queue (Redis) down → API still accepts the screening; the outbox delivers it when Redis returns"
  docker compose stop redis
  ( sleep 25; docker compose up -d --no-deps redis >/dev/null 2>&1; echo "   … redis restarted" ) &
  $RUN --wait-final 300
  wait
}

api() {
  bold "3) One API replica down → Traefik sends traffic to the other one"
  docker compose stop api
  ok=0; for _ in $(seq 1 20); do
    code=$(docker compose exec -T worker curl -sk -o /dev/null -w '%{http_code}' https://traefik/api/health)
    [ "$code" = "200" ] && ok=$((ok+1)); sleep 0.5; done
  echo "   $ok/20 requests succeeded with api-1 stopped"
  docker compose up -d --no-deps api >/dev/null 2>&1
}

audit() {
  bold "4) Tampering with the audit trail"
  PSQL="docker compose exec -T postgres psql -U postgres -d oralscreen -tA -v ON_ERROR_STOP=0"
  echo "   a) normal UPDATE/DELETE on audit_log (even as superuser):"
  $PSQL -c "UPDATE audit_log SET action='x' WHERE id=(SELECT min(id) FROM audit_log)" 2>&1 | sed 's/^/      /' | head -2
  echo "   b) an attacker disables the trigger and edits a row silently:"
  ID=$($PSQL -c "SELECT id FROM audit_log ORDER BY id LIMIT 1 OFFSET 2")
  $PSQL -q -c "DROP TABLE IF EXISTS chaos_backup; CREATE TABLE chaos_backup AS SELECT id, details FROM audit_log WHERE id=$ID;
               ALTER TABLE audit_log DISABLE TRIGGER USER; UPDATE audit_log SET details='{\"edited\":true}' WHERE id=$ID;" >/dev/null
  echo "   c) chain verification:"
  docker compose exec -T worker python -c "
from app.db import system_session; from app.audit import verify_chain_sync
with system_session('chaos') as s: r = verify_chain_sync(s)
print('      ok =', r['ok'], '| problems:', r['problems'][:1])"
  $PSQL -q -c "UPDATE audit_log a SET details=b.details FROM chaos_backup b WHERE a.id=b.id;
               ALTER TABLE audit_log ENABLE TRIGGER USER; DROP TABLE chaos_backup;" >/dev/null
  echo "   (row restored, triggers re-enabled)"
}

case "${1:-all}" in
  inference) inference ;; redis) redis ;; api) api ;; audit) audit ;;
  all) inference; redis; api; audit ;;
  *) echo "usage: $0 [inference|redis|api|audit|all]"; exit 2 ;;
esac
