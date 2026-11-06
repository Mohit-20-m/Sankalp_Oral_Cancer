# API overview

The REST API is served by FastAPI under `/api/v1`. Interactive documentation (OpenAPI / Swagger) is available at
`https://<host>/api/docs` on a running stack; this page summarises the groups and the conventions.

## Conventions

- **Authentication:** `Authorization: Bearer <token>` with a Keycloak access token (client `oralscreen-app`).
- **Idempotency:** `POST` requests that create data accept an `Idempotency-Key` header; a retried request returns
  the original response. Screenings are additionally de-duplicated by their `client_uuid`.
- **Phone numbers** are stored in E.164 format; a 10-digit Indian mobile number (with or without a leading 0
  or 91) is converted to `+91...` automatically.
- **Request ids:** every response carries a request id that also appears in logs and in the audit trail.
- **Errors:** standard HTTP status codes with a JSON `detail`; `409` signals a state conflict (for example, a
  retake that was not requested).

## Endpoint groups

| Group | Main endpoints | Used by |
|---|---|---|
| Patients and care continuity | `/patients`, `/patients/{id}/consents`, `/patients/{id}/timeline`, `/patients/{id}/medications`, `/patients/{id}/card`, `/consents/{id}/withdraw` | ASHA, nurse |
| Screening | `POST /screenings`, photo upload (`/screenings/{id}/images/{image}/content`), `/screenings/{id}/submit`, `/screenings/{id}/retake`, `GET /screenings/{id}`, `/screenings/{id}/decisions`, `/screenings/{id}/replay` | ASHA, nurse |
| Referrals, review and follow-up | `/referrals`, `/referrals/scan`, `/referrals/{id}/slip`, `/review/queue`, `/review/cases/{id}`, `/review/cases/{id}/review`, `/followups` | Facility staff, specialist |
| Provider Connect | `/provider-connect/request`, `/provider-connect/verify`, `/provider/summary` | Local doctor |
| Analytics, models and governance | `/analytics/*`, `/models`, `/models/retrain`, `/models/{v}/shadow`, `/models/{v}/promote`, `/models/rollback`, `/rules`, `/rules/{v}/approve`, `/governance/*` | District officer, clinical lead |
| Audit | `/audit`, `/audit/verify`, `/audit/patient/{id}/access`, `/audit/export/fhir` | Admin, patient-facing staff |
| Administration | `/admin/messages`, `/admin/dead-letters`, `/admin/outbox`, `/admin/circuits`, `/admin/simulate/sms-reply` | Admin |
| Webhooks | `/webhooks/twilio/sms`, `/voice`, `/gather`, `/status` | Twilio |
| FHIR R4 | `/fhir/*`: Patient, Consent, Encounter, Observation, MedicationStatement, DiagnosticReport, ServiceRequest, AuditEvent (Bundle, CapabilityStatement) | Health information exchange |
| System | `/api/health`, `/api/ready` (probes), `/me`, `/notifications` | All |

## Screening upload protocol

1. `POST /screenings` with patient, habits, symptoms, mouth-opening readings and a manifest of photos (site, SHA-256,
   size, content type, client quality metrics). The response lists, per photo, a presigned upload URL (or a
   multipart plan for large files) and an API fallback URL.
2. Upload each photo; the checksum must match the manifest.
3. `POST /screenings/{id}/submit` queues analysis and returns `202`.
4. Poll `GET /screenings/{id}` until `status` is `completed` or `retake_requested`. The response contains the risk
   level, reasons, actions, per-site results (probability, heat-map link, out-of-distribution flag), the referral
   and, if requested, the sites to retake.
5. For a retake, `POST /screenings/{id}/retake` with the new photos for the requested sites (multipart form), then
   poll again.

## Inference service

Internal only (not routed by Traefik):

| Endpoint | Purpose |
|---|---|
| `POST /v1/predict` | Up to 8 images: probability, logit, heat map, embedding, out-of-distribution distance, shadow-head probability |
| `POST /v1/embed` | Embeddings only (reference indexing, benchmark) |
| `GET /v1/info` | Model, head and contract versions, file checksums, thresholds |
| `POST /v1/reload` | Reload `models/current` after a new model is installed |
