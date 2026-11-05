# Deployment and operations

## Requirements

Docker Desktop or Docker Engine with Compose v2, **5 GB of memory** for Docker and about 6 GB of free disk for the
first build. Tested on Apple Silicon and x86-64 Linux.

## Start the stack

```bash
cp .env.example .env              # optional: every value has a working default
./scripts/fetch-model.sh          # install the trained model into models/current/
docker compose up --build         # first build 10-15 min, later starts 1-2 min
```

The stack is ready when `bootstrap` has exited with code 0 and `./ops/status.sh` reports `"status": "ready"`.
Without `fetch-model.sh` a clearly labelled **placeholder** model (trained on synthetic images) is generated so
that every feature can still be exercised; API responses then carry `"placeholder": true`.

To install a new model later, put it in `models/current/` and run `docker compose run --rm bootstrap`: the model is
copied into the models volume, registered as a new version and indexed, and the inference service reloads it.

## Endpoints

| What | Where |
|---|---|
| API documentation (Swagger) | https://localhost/api/docs (self-signed certificate: accept once) |
| Readiness (all dependencies, circuit breakers) | https://localhost/api/ready |
| Keycloak administration (user `admin`) | https://localhost/auth/admin |
| MinIO console | http://localhost:9001 |
| Traefik dashboard | http://localhost:8088 |
| Vault UI | http://localhost:8200 |
| PostgreSQL | localhost:5433 |

## Demo accounts

Created when `OS_SEED_DEMO=true` (the default). The password for all accounts is `OralScreen@2026` and the
client id is `oralscreen-app`. **Disable these before any real use.**

| User | Role | Facility |
|---|---|---|
| `kavya.asha`, `suma.asha` | ASHA | PHC Puttur, PHC Belthangady |
| `rekha.nurse` | Nurse | PHC Puttur |
| `dr.meera`, `dr.arjun` | Specialist | Oral Medicine Centre, Mangaluru |
| `lead.rao`, `lead.iyer` | Clinical lead (two, for maker-checker) | - |
| `officer.dk` | District officer (aggregates only) | - |
| `admin.ops` | Administrator | - |

Get a token for Swagger or Postman:

```bash
curl -sk https://localhost/auth/realms/oralscreen/protocol/openid-connect/token \
  -d grant_type=password -d client_id=oralscreen-app -d username=kavya.asha -d 'password=OralScreen@2026'
```

## Optional profiles

| Profile | Adds | URL |
|---|---|---|
| `--profile monitoring` | Grafana, Prometheus, Tempo, Loki (set `OS_OTEL_ENABLED=true`) | http://localhost:3000 |
| `--profile mlops` | MLflow tracking server and Flower | http://localhost:5000, http://localhost:5555 |
| `--profile hapi` | External HAPI FHIR server (set `OS_HAPI_URL=http://hapi:8080/fhir`) | http://localhost:8081/fhir |
| `--profile tunnel` | ngrok public URL for Twilio webhooks | http://localhost:4040 |

## Operations scripts

| Command | Purpose |
|---|---|
| `./ops/status.sh` | Container health and readiness |
| `./ops/demo.sh` | End-to-end journey with 50+ automatic checks (screening, referral, review, governance, MLOps) |
| `./ops/chaos.sh all` | Fault-tolerance scenarios: inference down, Redis down, one API replica down, audit tampering |
| `./ops/backup.sh full` | pgBackRest full backup (`incr`, `info`, `check` also available) |
| `./ops/reset.sh` | Delete all data and start fresh |

## Messaging (Twilio)

Without Twilio, sandbox mode stores every message; they are visible at `GET /api/v1/admin/messages`, and a patient
reply can be simulated with `POST /api/v1/admin/simulate/sms-reply`.

For real SMS and voice calls:

1. In `.env` set `OS_MESSAGING_MODE=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`.
   Trial accounts can only send to verified numbers.
2. For replies and voice check-ins Twilio must reach the server: set `NGROK_AUTHTOKEN`, start with
   `--profile tunnel`, copy the public URL into `PUBLIC_WEBHOOK_BASE` and restart `api api-2 worker`.
3. In the Twilio console point the messaging webhook to `<PUBLIC_WEBHOOK_BASE>/api/v1/webhooks/twilio/sms` and the
   status callback to `/api/v1/webhooks/twilio/status`. Request signatures are verified.

## Backups and restore

pgBackRest archives WAL continuously and keeps two full backups in the `pgbackrest` volume. Daily audit-log
snapshots go to the `os-audit` bucket with Object Lock. To restore (this stops the database):

```bash
docker compose stop api api-2 worker relay keycloak postgres
docker compose run --rm --no-deps -u postgres --entrypoint pgbackrest postgres --stanza=oralscreen --delta restore
docker compose up -d
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Port 80, 443, 5432 or 9000 already in use | Set `HTTP_PORT` / `HTTPS_PORT` in `.env`; stop local PostgreSQL or MinIO |
| Containers exit with code 137 | Give Docker more memory (5 GB or more) |
| `bootstrap` fails on first start | `docker compose logs bootstrap`; it is safe to re-run with `docker compose run --rm bootstrap` |
| Keycloak takes a minute to start | Normal on first start (realm import); the API waits for it |
| A phone on the same Wi-Fi cannot upload photos | Set `PUBLIC_HOST` and `OS_S3_PUBLIC_ENDPOINT` to the server's LAN IP |
| Low on disk | Set `INSTALL_EXTRAS=false` (skips Evidently and Flower) and run `docker builder prune` |

Logs are JSON, one event per line, with request ids: `docker compose logs -f api worker`.
