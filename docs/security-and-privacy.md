# Security and privacy

Arogya processes health information about identifiable people, so access control, auditability and consent are
built into every layer rather than added at the edge.

## Identity and access

| Layer | Mechanism | Answers |
|---|---|---|
| Authentication | Keycloak (OpenID Connect); short-lived access tokens with role and facility claims | *Who are you?* |
| Authorisation | Open Policy Agent policies (`infra/opa/policies/authz.rego`, unit-tested) | *May this role perform this action?* |
| Data scope | PostgreSQL **row-level security** on every patient table, forced for the application role | *Which rows may you see?* |

Roles: `asha`, `nurse`, `specialist`, `clinical_lead`, `district_officer`, `admin` and `provider` (a local doctor
with time-limited, patient-specific access). Examples of enforced rules:

- An ASHA or nurse sees only patients of their own facility; a specialist sees cases referred to their centre.
- A district officer sees de-identified aggregates only; cells smaller than 5 are suppressed (k-anonymity).
- A rule-set change must be approved by a clinical lead **other than** the one who proposed it.
- Only a clinical lead can promote or roll back a model.
- A local doctor reaches a patient's summary only after the **patient** shares a one-time code sent to their phone.

The database is accessed through a non-superuser role; the request's user, role and facility are set as session
variables that the row-level security policies read, so a bug in an API handler cannot widen access.

## Audit

- Every read of a patient record and every state change is written to `audit_log` with actor, role, action, entity,
  request id and IP.
- Rows are **hash-chained**: each stores the SHA-256 of the previous hash and its own content, so editing or deleting
  any row breaks the chain. `GET /audit/verify` reports the first broken entry.
- Daily snapshots of the log are written to object storage with Object Lock (write-once).
- Patients can be shown who opened their record (`GET /audit/patient/{id}/access`).
- Every automated decision is stored with its inputs and rule-set hash and can be replayed.

## Consent (India DPDP Act)

- Consent is recorded per purpose (screening, sharing with specialists, AI training) against the exact consent text
  shown, in the patient's language, with the capture method (signature, thumbprint, witnessed verbal).
- Withdrawing AI-training consent excludes the patient's labels from all future training.
- Photos feed model training only with active AI-training consent.

## Data protection

- All traffic goes through Traefik over TLS; HSTS, `nosniff`, frame denial and a strict referrer policy are set.
- Photos and heat maps are stored privately in object storage and shared only through short-lived presigned links.
- Uploads are verified against client-declared SHA-256 checksums.
- Secrets (token-signing key, Twilio credentials) are kept in Vault; `.env` is never committed and
  `.env.example` contains placeholders only.
- Referral slips and health cards carry **signed** tokens; forged or altered codes are rejected.
- Rate limits protect public endpoints (Provider Connect, webhooks) and the API.
- Twilio webhook signatures are verified.

## Deployment checklist

Before exposing an installation beyond a test network:

1. Replace every password and token in `.env` (see `.env.example`).
2. Set `OS_SEED_DEMO=false` and `WEB_SHOW_DEMO_USERS=false`; remove the demo staff accounts from Keycloak.
3. Use a real TLS certificate instead of the self-signed default.
4. Restrict the Traefik dashboard, MinIO console, Vault UI and database ports to an administration network.
5. Configure off-site backups (`ops/backup.sh`) and test a restore.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).
