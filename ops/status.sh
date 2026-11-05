#!/usr/bin/env bash
# Container health + the API readiness report (every dependency, circuit breakers).
cd "$(dirname "$0")/.." || exit 1
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
curl -sk https://localhost/api/ready | python3 -m json.tool 2>/dev/null || echo "API not reachable yet"
