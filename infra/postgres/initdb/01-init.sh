#!/bin/bash
# Runs once, on first start of the PostgreSQL container (as superuser).
# Creates: owner + app roles, one database per service, required extensions.
set -euo pipefail

: "${OS_DB_OWNER_PASSWORD:?}" "${OS_DB_APP_PASSWORD:?}" "${KEYCLOAK_DB_PASSWORD:?}" "${MLFLOW_DB_PASSWORD:?}"
HAPI_DB_PASSWORD="${HAPI_DB_PASSWORD:-hapi}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  -- application roles: owner runs migrations; app is used by API/workers and is subject to row-level security
  CREATE ROLE oralscreen_owner LOGIN PASSWORD '${OS_DB_OWNER_PASSWORD}';
  CREATE ROLE oralscreen_app   LOGIN PASSWORD '${OS_DB_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
  CREATE ROLE keycloak LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
  CREATE ROLE mlflow   LOGIN PASSWORD '${MLFLOW_DB_PASSWORD}';
  CREATE ROLE hapi     LOGIN PASSWORD '${HAPI_DB_PASSWORD}';

  CREATE DATABASE oralscreen OWNER oralscreen_owner;
  CREATE DATABASE keycloak   OWNER keycloak;
  CREATE DATABASE mlflow     OWNER mlflow;
  CREATE DATABASE hapi       OWNER hapi;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname oralscreen <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  GRANT CONNECT ON DATABASE oralscreen TO oralscreen_app;
  GRANT USAGE ON SCHEMA public TO oralscreen_app;
  ALTER SCHEMA public OWNER TO oralscreen_owner;
  -- tables created later by migrations (as oralscreen_owner) are automatically usable by the app role
  ALTER DEFAULT PRIVILEGES FOR ROLE oralscreen_owner IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oralscreen_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE oralscreen_owner IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO oralscreen_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE oralscreen_owner IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO oralscreen_app;
EOSQL
echo "OralScreen databases initialised"
