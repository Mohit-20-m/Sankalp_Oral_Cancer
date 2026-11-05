"""System: health/readiness, identity, notifications, audit, admin ops, FHIR R4 facade, Twilio webhooks."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func, select, text

from ... import audit as audit_mod
from ... import storage
from ...config import get_settings
from ...db import request_session
from ...domain import fhir
from ...models import (AuditLog, CheckIn, Consent, DeadLetter, Decision, Facility, Medication, Message,
                       OutboxEvent, Patient, Referral, Screening, Staff, TimelineEvent)
from ...outbox import emit
from ...resilience import all_breakers
from ...security.auth import mint_local_token
from ..deps import Ctx, ctx, log_patient_access
from ..schemas import DevTokenIn

router = APIRouter()
health_router = APIRouter()


# ───────────────────────── health ─────────────────────────
@health_router.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc)}


@health_router.get("/ready", tags=["system"])
async def ready():
    """Readiness: every dependency, with degraded (non-critical) vs failed (critical) status."""
    cfg = get_settings()
    checks: dict[str, dict] = {}
    try:
        async with request_session("health", "system") as s:
            await s.execute(text("SELECT 1"))
        checks["postgres"] = {"ok": True, "critical": True}
    except Exception as e:  # noqa: BLE001
        checks["postgres"] = {"ok": False, "critical": True, "error": str(e)[:120]}
    async with httpx.AsyncClient(timeout=5) as h:
        for name, url, critical in (("opa", f"{cfg.opa_url}/health", True),
                                    ("inference", f"{cfg.inference_url}/ready", False),
                                    ("keycloak", f"{cfg.keycloak_internal_url}/realms/{cfg.keycloak_realm}", False),
                                    ("vault", f"{cfg.vault_addr}/v1/sys/health", False)):
            if name == "keycloak" and cfg.auth_mode == "local":
                continue
            try:
                r = await h.get(url)
                checks[name] = {"ok": r.status_code < 500, "critical": critical}
            except Exception as e:  # noqa: BLE001
                checks[name] = {"ok": False, "critical": critical, "error": f"{type(e).__name__}: {e}"[:120]}
    try:
        import redis

        redis.Redis.from_url(cfg.redis_url, socket_timeout=2).ping()
        checks["redis"] = {"ok": True, "critical": False, "note": "work is queued in the outbox if down"}
    except Exception as e:  # noqa: BLE001
        checks["redis"] = {"ok": False, "critical": False, "error": str(e)[:120]}
    try:
        storage.client().head_bucket(Bucket=cfg.bucket_images)
        checks["object_storage"] = {"ok": True, "critical": True}
    except Exception as e:  # noqa: BLE001
        checks["object_storage"] = {"ok": False, "critical": True, "error": str(e)[:120]}
    critical_ok = all(v["ok"] for v in checks.values() if v["critical"])
    degraded = [k for k, v in checks.items() if not v["ok"] and not v["critical"]]
    body = {"status": "ready" if critical_ok and not degraded else "degraded" if critical_ok else "not_ready",
            "checks": checks, "circuits": all_breakers()}
    return Response(content=__import__("json").dumps(body, default=str), media_type="application/json",
                    status_code=200 if critical_ok else 503)


# ───────────────────────── identity ─────────────────────────
@router.post("/auth/dev-token", tags=["system"])
async def dev_token(body: DevTokenIn):
    """LOCAL MODE ONLY (tests / offline demos without Keycloak). Disabled when OS_AUTH_MODE=keycloak."""
    cfg = get_settings()
    if cfg.auth_mode != "local" or cfg.env == "prod":
        raise HTTPException(404, "not available")
    fid = None
    if body.facility_code:
        async with request_session("dev", "system") as s:
            f = (await s.execute(select(Facility).where(Facility.code == body.facility_code))).scalars().first()
            if f is None:
                raise HTTPException(404, "facility not found")
            fid = str(f.id)
    return {"access_token": mint_local_token(body.username, body.role, fid), "token_type": "bearer"}


@router.get("/me", tags=["system"])
async def me(c: Ctx = Depends(ctx)):
    await c.can("staff:me")
    return {"user_id": c.p.user_id, "username": c.p.username, "role": c.p.role, "roles": c.p.roles,
            "facility_id": c.p.facility_id, "name": c.p.full_name}


@router.get("/notifications", tags=["system"])
async def notifications(unread_only: bool = False, c: Ctx = Depends(ctx)):
    await c.can("notification:read")
    async with c.session() as s:
        q = select(Message).where(Message.to_staff_id == uuid.UUID(c.p.user_id)).order_by(Message.created_at.desc())
        if unread_only:
            q = q.where(Message.status != "read")
        return [{"id": str(m.id), "template": m.template, "body": m.body, "related": m.related, "status": m.status,
                 "created_at": m.created_at} for m in (await s.execute(q.limit(100))).scalars()]


@router.post("/notifications/{mid}/read", tags=["system"])
async def mark_read(mid: uuid.UUID, c: Ctx = Depends(ctx)):
    async with c.session() as s:
        m = await s.get(Message, mid)
        if m is None or str(m.to_staff_id) != c.p.user_id:
            raise HTTPException(404, "not found")
        m.status = "read"
        return {"id": str(mid), "status": "read"}


# ───────────────────────── audit ─────────────────────────
@router.get("/audit", tags=["audit"])
async def audit_list(patient_id: str | None = None, actor_id: str | None = None, action: str | None = None,
                     limit: int = 100, c: Ctx = Depends(ctx)):
    await c.can("audit:read")
    async with c.session() as s:
        q = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000))
        if patient_id:
            q = q.where(AuditLog.patient_id == patient_id)
        if actor_id:
            q = q.where(AuditLog.actor_id == actor_id)
        if action:
            q = q.where(AuditLog.action.like(f"{action}%"))
        return [{"id": a.id, "ts": a.ts, "actor_id": a.actor_id, "actor_role": a.actor_role, "action": a.action,
                 "entity_type": a.entity_type, "entity_id": a.entity_id, "patient_id": a.patient_id,
                 "details": a.details, "hash": a.hash, "prev_hash": a.prev_hash} for a in (await s.execute(q)).scalars()]


@router.get("/audit/verify", tags=["audit"])
async def audit_verify(c: Ctx = Depends(ctx)):
    """Recomputes every hash in the chain. Any edited/deleted row is reported with its id."""
    await c.can("audit:verify")
    async with c.session() as s:
        res = await audit_mod.verify_chain(s)
        await c.audit(s, "audit.verified", "audit_log", None, None, {"ok": res["ok"], "checked": res["checked"]})
        return res


@router.get("/audit/patient/{pid}/access", tags=["audit"])
async def who_accessed(pid: str, c: Ctx = Depends(ctx)):
    """Access transparency: who looked at this patient's record and when."""
    await c.can("audit:read")
    async with c.session() as s:
        rows = (await s.execute(select(AuditLog.actor_id, AuditLog.actor_role, AuditLog.entity_type,
                                       func.count(), func.max(AuditLog.ts))
                                .where(AuditLog.patient_id == pid, AuditLog.action == "read.patient")
                                .group_by(AuditLog.actor_id, AuditLog.actor_role, AuditLog.entity_type))).all()
        names = {str(st.id): st.username for st in (await s.execute(select(Staff))).scalars()}
        return [{"actor": names.get(a, a), "role": r, "what": e, "times": n, "last": t} for a, r, e, n, t in rows]


@router.get("/audit/export/fhir", tags=["audit"])
async def audit_fhir(patient_id: str | None = None, limit: int = 200, c: Ctx = Depends(ctx)):
    await c.can("audit:read")
    async with c.session() as s:
        q = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000))
        if patient_id:
            q = q.where(AuditLog.patient_id == patient_id)
        return fhir.bundle([fhir.audit_event(a) for a in (await s.execute(q)).scalars()])


@router.post("/audit/snapshot", tags=["audit"], status_code=202)
async def audit_snapshot(day: str | None = None, c: Ctx = Depends(ctx)):
    await c.can("audit:verify")
    from ...worker.celery_app import celery_app

    celery_app.send_task("os.audit_snapshot", kwargs={"day": day}, queue="oralscreen")
    return {"status": "queued", "day": day or "yesterday"}


# ───────────────────────── admin / ops ─────────────────────────
@router.get("/admin/messages", tags=["admin"])
async def admin_messages(limit: int = 100, c: Ctx = Depends(ctx)):
    """Outgoing SMS / calls (in sandbox mode this is where 'sent' messages appear). Numbers are masked."""
    await c.can("admin:ops")
    from ...messaging import mask

    async with request_session(c.p.user_id, "system") as s:
        q = select(Message).where(Message.channel != "in_app").order_by(Message.created_at.desc()).limit(limit)
        return [{"id": str(m.id), "channel": m.channel, "to": mask(m.to_number), "template": m.template,
                 "language": m.language, "body": m.body, "status": m.status, "provider": m.provider,
                 "error": m.error, "created_at": m.created_at, "sent_at": m.sent_at}
                for m in (await s.execute(q)).scalars()]


@router.get("/admin/dead-letters", tags=["admin"])
async def dead_letters(c: Ctx = Depends(ctx)):
    await c.can("admin:ops")
    async with request_session(c.p.user_id, "system") as s:
        q = select(DeadLetter).where(DeadLetter.resolved.is_(False)).order_by(DeadLetter.failed_at.desc())
        return [{"id": str(d.id), "task": d.task_name, "payload": d.payload, "error": d.error, "attempts": d.attempts,
                 "failed_at": d.failed_at} for d in (await s.execute(q)).scalars()]


@router.post("/admin/dead-letters/{did}/retry", tags=["admin"])
async def retry_dead_letter(did: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("admin:ops")
    from ...worker.celery_app import celery_app

    async with request_session(c.p.user_id, "system") as s:
        d = await s.get(DeadLetter, did)
        if d is None or d.resolved:
            raise HTTPException(404, "not found")
        celery_app.send_task(d.task_name, args=d.payload.get("args", []), kwargs=d.payload.get("kwargs", {}),
                             queue="oralscreen")
        d.retried_at, d.resolved = datetime.now(timezone.utc), True
        await c.audit(s, "admin.dead_letter_retried", "dead_letter", did, None, {"task": d.task_name})
        return {"id": str(did), "status": "requeued"}


@router.get("/admin/outbox", tags=["admin"])
async def outbox(c: Ctx = Depends(ctx)):
    await c.can("admin:ops")
    async with request_session(c.p.user_id, "system") as s:
        pending = (await s.execute(select(func.count()).select_from(OutboxEvent)
                                   .where(OutboxEvent.published_at.is_(None)))).scalar()
        failing = (await s.execute(select(OutboxEvent).where(OutboxEvent.published_at.is_(None),
                                                             OutboxEvent.attempts > 0).limit(20))).scalars()
        return {"pending": pending, "retrying": [{"id": e.id, "topic": e.topic, "attempts": e.attempts,
                                                  "last_error": e.last_error} for e in failing]}


@router.get("/admin/circuits", tags=["admin"])
async def circuits(c: Ctx = Depends(ctx)):
    await c.can("admin:ops")
    return all_breakers()


@router.post("/admin/simulate/sms-reply", tags=["admin"])
async def simulate_reply(patient_id: uuid.UUID, body: str = "1", c: Ctx = Depends(ctx)):
    """Sandbox demo: pretend the patient replied to the check-in SMS (1 = symptoms back, 2 = no)."""
    await c.can("admin:ops")
    if get_settings().messaging_mode != "sandbox":
        raise HTTPException(409, "only in sandbox mode")
    async with request_session(c.p.user_id, "system") as s:
        p = await s.get(Patient, patient_id)
        if p is None:
            raise HTTPException(404, "patient not found")
        return await _handle_reply(s, p, body.strip(), "sms")


# ───────────────────────── check-in replies (Twilio + sandbox) ─────────────────────────
async def _handle_reply(s, patient: Patient, digit: str, channel: str) -> dict:
    ci = (await s.execute(select(CheckIn).where(CheckIn.patient_id == patient.id, CheckIn.status == "sent")
                          .order_by(CheckIn.sent_at.desc()))).scalars().first()
    if ci is None:
        ci = CheckIn(patient_id=patient.id, channel=channel, scheduled_for=datetime.now(timezone.utc),
                     sent_at=datetime.now(timezone.utc), status="sent")
        s.add(ci)
        await s.flush()
    back = digit.startswith("1")
    ci.response = "symptoms_back" if back else "no_symptoms"
    ci.responded_at, ci.status = datetime.now(timezone.utc), "answered"
    s.add(TimelineEvent(patient_id=patient.id, occurred_at=datetime.now(timezone.utc), kind="checkin",
                        source="ivr" if channel == "voice" else "patient_sms",
                        summary="Patient reports symptoms are back" if back else "Patient reports no symptoms",
                        data={"response": ci.response}))
    if back:
        ci.escalated = True
        await emit(s, "patient.reevaluate", {"patient_id": str(patient.id), "trigger": "checkin_escalation"},
                   dedupe_key=f"reeval:ci:{ci.id}")
        last = (await s.execute(select(Screening).where(Screening.patient_id == patient.id)
                                .order_by(Screening.captured_at.desc()))).scalars().first()
        if last and last.worker_id:
            s.add(Message(channel="in_app", to_staff_id=last.worker_id, template="staff_escalation", status="sent",
                          provider="in_app", body=f"Escalation: {patient.display_id} reports symptoms returned. "
                                                  "Case moved up the specialist queue.",
                          related={"patient_id": str(patient.id)}))
    await audit_mod.record(s, f"patient:{patient.display_id}", "patient", "checkin.answered", "checkin", ci.id,
                           patient.id, {"response": ci.response, "channel": channel})
    return {"checkin_id": str(ci.id), "response": ci.response, "escalated": ci.escalated}


async def _twilio_ok(request: Request) -> dict:
    cfg = get_settings()
    form = dict(await request.form())
    if cfg.messaging_mode == "twilio" and cfg.twilio_validate_signatures:
        from twilio.request_validator import RequestValidator

        url = f"{cfg.public_webhook_base}{request.url.path}"
        if request.url.query:
            url += f"?{request.url.query}"
        if not RequestValidator(cfg.twilio_auth_token).validate(url, form, request.headers.get("X-Twilio-Signature",
                                                                                              "")):
            raise HTTPException(403, "invalid Twilio signature")
    return form


@router.post("/webhooks/twilio/sms", tags=["webhooks"])
async def twilio_sms(request: Request):
    form = await _twilio_ok(request)
    frm, body = form.get("From", ""), (form.get("Body") or "").strip()
    async with request_session("twilio", "system") as s:
        p = (await s.execute(select(Patient).where(Patient.phone == frm))).scalars().first()
        if p is not None and body[:1] in ("1", "2"):
            await _handle_reply(s, p, body, "sms")
    return Response("<Response/>", media_type="application/xml")


@router.post("/webhooks/twilio/voice", tags=["webhooks"])
async def twilio_voice(request: Request, checkin: str = ""):
    """TwiML for the check-in call: plays the question, collects 1 digit."""
    await _twilio_ok(request)
    lang_voice = {"kn": "kn-IN", "tcy": "kn-IN", "en": "en-IN"}
    async with request_session("twilio", "system") as s:
        ci = await s.get(CheckIn, uuid.UUID(checkin)) if checkin else None
        p = await s.get(Patient, ci.patient_id) if ci else None
        msg = (await s.execute(select(Message).where(Message.related["checkin_id"].astext == checkin)
                               .order_by(Message.created_at.desc()))).scalars().first() if checkin else None
    say = (msg.body if msg else "Has the burning in your mouth come back? Press 1 for yes, 2 for no.")
    lang = lang_voice.get(p.language if p else "en", "en-IN")
    twiml = (f'<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" timeout="8" '
             f'action="/api/v1/webhooks/twilio/gather?checkin={checkin}" method="POST">'
             f'<Say language="{lang}">{say}</Say></Gather><Say language="{lang}">'
             f'We did not receive an answer. Your health worker will contact you.</Say></Response>')
    return Response(twiml, media_type="application/xml")


@router.post("/webhooks/twilio/gather", tags=["webhooks"])
async def twilio_gather(request: Request, checkin: str = ""):
    form = await _twilio_ok(request)
    digit = form.get("Digits", "")
    async with request_session("twilio", "system") as s:
        ci = await s.get(CheckIn, uuid.UUID(checkin)) if checkin else None
        if ci and digit in ("1", "2"):
            await _handle_reply(s, await s.get(Patient, ci.patient_id), digit, "voice")
    return Response('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you.</Say></Response>',
                    media_type="application/xml")


@router.post("/webhooks/twilio/status", tags=["webhooks"])
async def twilio_status(request: Request):
    form = await _twilio_ok(request)
    sid, status = form.get("MessageSid") or form.get("CallSid"), form.get("MessageStatus") or form.get("CallStatus")
    if sid and status:
        async with request_session("twilio", "system") as s:
            m = (await s.execute(select(Message).where(Message.provider_sid == sid))).scalars().first()
            if m:
                m.status = {"delivered": "delivered", "failed": "failed", "undelivered": "failed",
                            "completed": "delivered"}.get(status, m.status)
    return Response("<Response/>", media_type="application/xml")


# ───────────────────────── FHIR R4 facade ─────────────────────────
fhir_router = APIRouter(prefix="/fhir", tags=["FHIR R4"])


@fhir_router.get("/metadata")
async def fhir_metadata():
    return fhir.capability_statement()


@fhir_router.get("/Patient/{pid}")
async def fhir_patient(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        p = await s.get(Patient, pid)
        if p is None:
            raise HTTPException(404, "not found")
        await log_patient_access(s, c, pid, "fhir_patient")
        return fhir.patient(p)


@fhir_router.get("/Patient")
async def fhir_patient_search(identifier: str, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    value = identifier.split("|")[-1]
    async with c.session() as s:
        rows = (await s.execute(select(Patient).where((Patient.display_id == value) | (Patient.abha_id == value))
                                )).scalars().all()
        return fhir.bundle([fhir.patient(p) for p in rows])


@fhir_router.get("/Observation")
async def fhir_obs(patient: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        scr = (await s.execute(select(Screening).where(Screening.patient_id == patient))).scalars().all()
        return fhir.bundle([o for sc in scr for o in fhir.observations(sc)])


@fhir_router.get("/DiagnosticReport/{sid}")
async def fhir_report(sid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        sc = await s.get(Screening, sid)
        if sc is None:
            raise HTTPException(404, "not found")
        dec = await s.get(Decision, sc.decision_id) if sc.decision_id else None
        return fhir.diagnostic_report(sc, dec)


@fhir_router.get("/ServiceRequest/{rid}")
async def fhir_sr(rid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        r = await s.get(Referral, rid)
        if r is None:
            raise HTTPException(404, "not found")
        return fhir.service_request(r)


@fhir_router.get("/MedicationStatement")
async def fhir_meds(patient: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        rows = (await s.execute(select(Medication).where(Medication.patient_id == patient))).scalars().all()
        return fhir.bundle([fhir.medication_statement(m) for m in rows])


@fhir_router.get("/Encounter")
async def fhir_enc(patient: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        rows = (await s.execute(select(TimelineEvent).where(TimelineEvent.patient_id == patient,
                                                            TimelineEvent.kind.in_(["provider_visit", "screening",
                                                                                    "review"])))).scalars().all()
        return fhir.bundle([fhir.encounter(e) for e in rows])


@fhir_router.get("/Consent")
async def fhir_consent(patient: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("fhir:read")
    async with c.session() as s:
        rows = (await s.execute(select(Consent).where(Consent.patient_id == patient))).scalars().all()
        return fhir.bundle([fhir.consent(x) for x in rows])
