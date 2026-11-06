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
Then open the **web app** at **https://localhost/** (self-signed certificate: accept the browser warning once).
Without `fetch-model.sh` a clearly labelled **placeholder** model (trained on synthetic images) is generated so
that every feature can still be exercised; API responses then carry `"placeholder": true`.

To install a new model later, put it in `models/current/` and run `docker compose run --rm bootstrap`: the model is
copied into the models volume, registered as a new version and indexed, and the inference service reloads it.

## Endpoints

| What | Where |
|---|---|
| Web app | https://localhost/ |
| Provider Connect (opened from the patient's health-card QR) | https://localhost/connect |
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

## Adding staff accounts

Staff accounts live in Keycloak. The application creates a staff profile automatically on a user's first login,
using the **role** and **facility** in their token.

1. Open https://localhost/auth/admin, sign in as `admin` (password `KEYCLOAK_ADMIN_PASSWORD` from `.env`) and switch
   the realm to **oralscreen**.
2. **Users -> Add user:** username, first and last name, and **facility_id** (table below). Create.
3. **Credentials -> Set password:** the realm requires at least 10 characters with an upper-case letter, a digit
   and a special character. Set **Temporary** to **Off** (the web app's login cannot complete a forced password
   change).
4. **Role mapping -> Assign role:** one of `asha`, `nurse`, `specialist`, `clinical_lead`, `district_officer`,
   `admin`.

| Facility | facility_id | Use for |
|---|---|---|
| PHC Puttur | `d5bb6730-0aac-5ec9-92d7-74d62f80641f` | ASHA workers, nurses |
| PHC Belthangady | `e50a168f-8c87-5dc4-aefa-2bcdd3c3a159` | ASHA workers, nurses |
| PHC Bantwal | `243146d0-7ddd-507c-85b8-52cbca9c2515` | ASHA workers, nurses |
| PHC Sullia | `bfc16921-3034-531c-b803-29d2bf481d94` | ASHA workers, nurses |
| Oral Medicine Centre, Mangaluru | `c8cb86ec-8ce4-5e3d-b6d8-1e42fdfa3db6` | Specialists (receives all referrals) |

The identifiers are derived from the facility codes and are the same in every installation. Clinical leads,
district officers and admins need no facility. ASHA workers and nurses only see patients of their own facility;
specialists see the shared review queue of their referral centre.

## Phone capture on the same Wi-Fi

A phone cannot open `localhost`. Find the server's Wi-Fi address (on macOS `ipconfig getifaddr en0`, for example
`192.168.1.20`) and set in `.env`:

```
PUBLIC_HOST=192.168.1.20
OS_S3_PUBLIC_ENDPOINT=https://192.168.1.20
CAPTURE_BASE_URL=https://192.168.1.20
```

Run `docker compose up -d`, open `https://192.168.1.20/`, start a screening, choose **Photos -> Use my phone** and
scan the QR code with the phone. Accept the certificate warning once; photos appear on the desktop as they arrive.

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

> Write comments in `.env` on their own line. Docker Compose reads `KEY=   # comment` as the value `# comment`.

Without Twilio, sandbox mode stores every message; they are visible at `GET /api/v1/admin/messages`, and a patient
reply can be simulated with `POST /api/v1/admin/simulate/sms-reply`.

For real SMS and voice calls:

1. In `.env` set `OS_MESSAGING_MODE=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`.
   Trial accounts can only send to verified numbers.
2. For replies and voice check-ins Twilio must reach the server: set `NGROK_AUTHTOKEN`, start with
   `--profile tunnel`, copy the public URL into `PUBLIC_WEBHOOK_BASE` and restart `api api-2 worker`.
3. In the Twilio console point the messaging webhook to `<PUBLIC_WEBHOOK_BASE>/api/v1/webhooks/twilio/sms` and the
   status callback to `/api/v1/webhooks/twilio/status`. Request signatures are verified.
4. Credentials can be an account SID with either the auth token or an API key (`TWILIO_API_KEY_SID` and
   `TWILIO_API_KEY_SECRET`) that is allowed to send messages.

Twilio **trial** accounts only send Twilio's predefined sample messages to verified numbers (custom text is rejected
with error 572006). For a demo on a trial account set `TWILIO_TRIAL_TEMPLATES=true`: each message is sent as the
closest predefined template while the full text is still stored and shown under admin -> Messages.

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
| Web app does not show the new version | Hard-refresh the browser (Cmd+Shift+R / Ctrl+Shift+R) |
| A new user logs in but sees no patients | Their `facility_id` is missing or wrong (Keycloak -> Users -> Details) |
| Low on disk | Set `INSTALL_EXTRAS=false` (skips Evidently and Flower) and run `docker builder prune` |

Logs are JSON, one event per line, with request ids: `docker compose logs -f api worker`.
