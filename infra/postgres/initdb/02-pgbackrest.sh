#!/bin/bash
# Creates the pgBackRest stanza on first start (WAL archiving is configured in docker-compose `command:`).
set -euo pipefail
pgbackrest --stanza=oralscreen --log-level-console=warn stanza-create || echo "pgbackrest stanza-create failed (archiving will retry)"
