"""Patients, consent (DPDP), care timeline, medicines, QR health card and Provider Connect."""
from __future__ import annotations

import hashlib
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from sqlalchemy import or_, select, update

from ... import storage
from ...config import get_settings
from ...db import request_session
from ...models import (Consent, ConsentText, Facility, HealthCard, Label, LineageEdge, Medication, ModelVersion,
                       Patient, ProviderAccess, Referral, Screening, ScreeningImage, TimelineEvent, TrainingRun,
                       Village)
from ...outbox import emit
from ...security.tokens import check_otp, hash_otp, issue_token, new_otp, qr_png_base64, verify_token
from ...services.notify import queue_sms  # noqa: F401  (sync helper used via run_sync below)
from ..deps import Ctx, ctx, idem_lookup, idem_store, log_patient_access
from ..schemas import (ConsentIn, MedicationIn, PatientIn, PatientPatch, ProviderRequestIn, ProviderVerifyIn,
                       TimelineIn, WithdrawIn)

router = APIRouter(tags=["patients & care continuity"])
_ALPH = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"


def _display_id() -> str:
    return "DK-" + "".join(secrets.choice(_ALPH) for _ in range(6))


def patient_out(p: Patient) -> dict:
    return {"id": str(p.id), "display_id": p.display_id, "full_name": p.full_name, "sex": p.sex,
            "birth_year": p.birth_year, "phone": p.phone, "language": p.language,
            "village_id": str(p.village_id) if p.village_id else None, "facility_id": str(p.facility_id),
            "abha_id": p.abha_id, "created_at": p.created_at}


async def _get_patient(s, pid) -> Patient:
    p = await s.get(Patient, pid)
    if p is None or p.deleted_at is not None:
        raise HTTPException(404, "patient not found (or not visible to you)")
    return p


# ───────────────────────── reference data ─────────────────────────
@router.get("/facilities")
async def facilities(c: Ctx = Depends(ctx)):
    await c.can("staff:me")
    async with c.session() as s:
        rows = (await s.execute(select(Facility).order_by(Facility.name))).scalars().all()
        return [{"id": str(f.id), "code": f.code, "name": f.name, "kind": f.kind, "district": f.district,
                 "lat": f.lat, "lon": f.lon, "accepts_referrals": f.accepts_referrals} for f in rows]


@router.get("/villages")
async def villages(c: Ctx = Depends(ctx)):
    await c.can("staff:me")
    async with c.session() as s:
        rows = (await s.execute(select(Village).order_by(Village.name))).scalars().all()
        return [{"id": str(v.id), "name": v.name, "taluk": v.taluk, "lat": v.lat, "lon": v.lon} for v in rows]


@router.get("/consent-texts")
async def consent_texts(language: str = "kn", c: Ctx = Depends(ctx)):
    await c.can("staff:me")
    async with c.session() as s:
        rows = (await s.execute(select(ConsentText).where(ConsentText.language == language)
                                .order_by(ConsentText.purpose, ConsentText.version.desc()))).scalars().all()
        latest = {}
        for r in rows:
            latest.setdefault(r.purpose, r)
        return [{"id": str(r.id), "purpose": r.purpose, "version": r.version, "language": r.language, "text": r.text,
                 "sha256": r.sha256} for r in latest.values()]


# ───────────────────────── patients ─────────────────────────
@router.post("/patients", status_code=201)
async def create_patient(body: PatientIn, c: Ctx = Depends(ctx), idempotency_key: str | None = Header(None)):
    await c.can("patient:create")
    async with c.session() as s:
        if (prev := await idem_lookup(s, c, idempotency_key, "POST", "/patients", body)) is not None:
            return prev
        p = Patient(display_id=_display_id(), facility_id=uuid.UUID(c.p.facility_id), created_by=uuid.UUID(c.p.user_id),
                    **body.model_dump())
        s.add(p)
        await s.flush()
        await c.audit(s, "create.patient", "patient", p.id, p.id, {"village_id": str(body.village_id)})
        out = patient_out(p)
        await idem_store(s, c, idempotency_key, "POST", "/patients", body, out, 201)
        return out


@router.get("/patients")
async def list_patients(q: str | None = None, village_id: uuid.UUID | None = None, limit: int = 50,
                        c: Ctx = Depends(ctx)):
    await c.can("patient:read")
    async with c.session() as s:
        stmt = select(Patient).where(Patient.deleted_at.is_(None))
        if q:
            stmt = stmt.where(or_(Patient.full_name.ilike(f"%{q}%"), Patient.display_id.ilike(f"%{q}%"),
                                  Patient.phone.ilike(f"%{q}%")))
        if village_id:
            stmt = stmt.where(Patient.village_id == village_id)
        rows = (await s.execute(stmt.order_by(Patient.created_at.desc()).limit(min(limit, 200)))).scalars().all()
        return [patient_out(p) for p in rows]


@router.get("/patients/{pid}")
async def get_patient(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("patient:read", {"patient_id": pid})
    async with c.session() as s:
        p = await _get_patient(s, pid)
        await log_patient_access(s, c, pid, "patient")
        consents = (await s.execute(select(Consent).where(Consent.patient_id == pid))).scalars().all()
        scr = (await s.execute(select(Screening).where(Screening.patient_id == pid)
                               .order_by(Screening.captured_at.desc()))).scalars().all()
        refs = (await s.execute(select(Referral).where(Referral.patient_id == pid))).scalars().all()
        return {**patient_out(p),
                "consents": [{"id": str(x.id), "purpose": x.purpose, "granted": x.granted, "method": x.method,
                              "captured_at": x.captured_at, "withdrawn_at": x.withdrawn_at} for x in consents],
                "screenings": [{"id": str(x.id), "captured_at": x.captured_at, "risk_level": x.risk_level,
                                "status": x.status, "lesion_score": x.lesion_score,
                                "mouth_opening_mm": x.mouth_opening_mm} for x in scr],
                "referrals": [{"id": str(r.id), "status": r.status, "due_by": r.due_by, "priority": r.priority}
                              for r in refs]}


@router.patch("/patients/{pid}")
async def patch_patient(pid: uuid.UUID, body: PatientPatch, c: Ctx = Depends(ctx)):
    await c.can("patient:update", {"patient_id": pid})
    async with c.session() as s:
        p = await _get_patient(s, pid)
        changes = body.model_dump(exclude_unset=True)
        for k, v in changes.items():
            setattr(p, k, v)
        await c.audit(s, "update.patient", "patient", pid, pid, {"fields": sorted(changes)})
        return patient_out(p)


# ───────────────────────── consent ─────────────────────────
@router.post("/patients/{pid}/consents", status_code=201)
async def record_consent(pid: uuid.UUID, body: ConsentIn, c: Ctx = Depends(ctx)):
    await c.can("consent:record", {"patient_id": pid})
    async with c.session() as s:
        await _get_patient(s, pid)
        ct = await s.get(ConsentText, body.consent_text_id)
        if ct is None or ct.purpose != body.purpose:
            raise HTTPException(400, "consent text does not match purpose")
        x = Consent(patient_id=pid, captured_by=uuid.UUID(c.p.user_id), **body.model_dump())
        s.add(x)
        await s.flush()
        await c.audit(s, "consent.recorded", "consent", x.id, pid,
                      {"purpose": body.purpose, "granted": body.granted, "text_version": ct.version,
                       "text_sha256": ct.sha256, "method": body.method})
        return {"id": str(x.id), "purpose": x.purpose, "granted": x.granted}


@router.post("/consents/{cid}/withdraw")
async def withdraw_consent(cid: uuid.UUID, body: WithdrawIn, c: Ctx = Depends(ctx)):
    """DPDP right to withdraw. For ai_training: the patient's labels are excluded from all FUTURE training and the
    model versions that already used them are listed (data lineage) so the clinical lead can decide on retraining."""
    async with c.session() as s:
        x = await s.get(Consent, cid)
        if x is None:
            raise HTTPException(404, "consent not found")
        await c.can("consent:withdraw", {"patient_id": x.patient_id})
        if x.withdrawn_at:
            raise HTTPException(409, "already withdrawn")
        x.withdrawn_at, x.withdrawn_reason = datetime.now(timezone.utc), body.reason
        affected: list[str] = []
        if x.purpose == "ai_training":
            img_ids = select(ScreeningImage.id).where(ScreeningImage.patient_id == x.patient_id)
            await s.execute(update(Label).where(Label.image_id.in_(img_ids))
                            .values(consent_ai_training=False, status="excluded"))
            snaps = select(LineageEdge.snapshot_id).where(LineageEdge.patient_id == x.patient_id)
            runs = (await s.execute(select(TrainingRun.candidate_version)
                                    .where(TrainingRun.dataset_snapshot_id.in_(snaps)))).scalars().all()
            affected = sorted({v for v in runs if v})
        await c.audit(s, "consent.withdrawn", "consent", cid, x.patient_id,
                      {"purpose": x.purpose, "affected_model_versions": affected})
        return {"withdrawn": True, "purpose": x.purpose, "affected_model_versions": affected,
                "note": "Data is excluded from all future training. Versions listed above were trained before "
                        "withdrawal; the clinical lead can retrain without this data."}


# ───────────────────────── timeline ─────────────────────────
def _event_out(e: TimelineEvent) -> dict:
    return {"id": str(e.id), "occurred_at": e.occurred_at, "kind": e.kind, "source": e.source, "summary": e.summary,
            "data": e.data, "created_by": e.created_by}


@router.get("/patients/{pid}/timeline")
async def timeline(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("timeline:read", {"patient_id": pid})
    async with c.session() as s:
        await _get_patient(s, pid)
        await log_patient_access(s, c, pid, "timeline")
        evs = (await s.execute(select(TimelineEvent).where(TimelineEvent.patient_id == pid)
                               .order_by(TimelineEvent.occurred_at))).scalars().all()
        meds = (await s.execute(select(Medication).where(Medication.patient_id == pid)
                                .order_by(Medication.created_at))).scalars().all()
        return {"events": [_event_out(e) for e in evs],
                "medications": [{"id": str(m.id), "name": m.name_matched or m.name_entered, "category": m.category,
                                 "masks_symptoms": m.masks_symptoms, "status": m.status,
                                 "prescribed_by": m.prescribed_by, "started_on": m.started_on,
                                 "recorded_at": m.created_at} for m in meds]}


@router.post("/patients/{pid}/timeline", status_code=201)
async def add_event(pid: uuid.UUID, body: TimelineIn, c: Ctx = Depends(ctx)):
    await c.can("timeline:write", {"patient_id": pid})
    async with c.session() as s:
        await _get_patient(s, pid)
        src = "provider" if c.p.is_provider else c.p.role
        ev = TimelineEvent(patient_id=pid, occurred_at=body.occurred_at or datetime.now(timezone.utc), kind=body.kind,
                           source=src, summary=body.summary, data=body.data, created_by=c.p.username)
        s.add(ev)
        await s.flush()
        await c.audit(s, "timeline.added", "timeline_event", ev.id, pid, {"kind": body.kind})
        # symptoms reported/relieved can change the risk -> re-evaluate in the background
        await emit(s, "patient.reevaluate", {"patient_id": str(pid), "trigger": "timeline_update"},
                   dedupe_key=f"reeval:ev:{ev.id}")
        return _event_out(ev)


@router.post("/patients/{pid}/medications", status_code=201)
async def add_medication(pid: uuid.UUID, name_entered: str | None = Form(None), prescribed_by: str | None = Form(None),
                         started_on: str | None = Form(None), photo: UploadFile | None = File(None),
                         c: Ctx = Depends(ctx)):
    """Record a medicine — typed, or a PHOTO of the tube/strip/prescription (read by OCR in the background)."""
    await c.can("medication:record", {"patient_id": pid})
    cfg = get_settings()
    body = MedicationIn(name_entered=name_entered, prescribed_by=prescribed_by,
                        started_on=started_on or None)
    if not body.name_entered and photo is None:
        raise HTTPException(400, "give a medicine name or a photo")
    async with c.session() as s:
        await _get_patient(s, pid)
        key = None
        if photo is not None:
            data = await photo.read()
            if len(data) > cfg.max_upload_mb * 1024 * 1024:
                raise HTTPException(413, "photo too large")
            key = f"medications/{pid}/{uuid.uuid4().hex}.jpg"
            storage.put_bytes(cfg.bucket_images, key, data, photo.content_type or "image/jpeg")
        ev = TimelineEvent(patient_id=pid, occurred_at=datetime.now(timezone.utc), kind="medication",
                           source="provider" if c.p.is_provider else c.p.role,
                           summary=f"Medicine recorded: {body.name_entered or 'photo — reading label…'}",
                           data={"prescribed_by": body.prescribed_by}, created_by=c.p.username)
        s.add(ev)
        await s.flush()
        m = Medication(patient_id=pid, timeline_event_id=ev.id, photo_key=key, name_entered=body.name_entered,
                       prescribed_by=body.prescribed_by, started_on=body.started_on,
                       status="pending_ocr" if key else "recorded")
        if body.name_entered and not key:
            from ...domain.medicines import match_medicine

            hit = match_medicine(body.name_entered)
            if hit:
                m.name_matched, m.category, m.masks_symptoms, m.match_score = (hit["name"], hit["category"],
                                                                               hit["masks_symptoms"], hit["score"])
        s.add(m)
        await s.flush()
        if key:
            await emit(s, "medication.ocr", {"medication_id": str(m.id)}, dedupe_key=f"ocr:{m.id}")
        elif m.masks_symptoms:
            await emit(s, "patient.reevaluate", {"patient_id": str(pid), "trigger": "medication"},
                       dedupe_key=f"reeval:med:{m.id}")
        await c.audit(s, "medication.recorded", "medication", m.id, pid, {"photo": bool(key)})
        return {"id": str(m.id), "status": m.status, "name_matched": m.name_matched,
                "masks_symptoms": m.masks_symptoms}


@router.get("/patients/{pid}/comparison")
async def comparison(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    """Follow-up comparison: same mouth sites across visits (score, heat-map area, mouth opening)."""
    from ...models import ImageResult
    from ..deps import presign_or_none

    await c.can("screening:read", {"patient_id": pid})
    cfg = get_settings()
    async with c.session() as s:
        await _get_patient(s, pid)
        scrs = (await s.execute(select(Screening).where(Screening.patient_id == pid)
                                .order_by(Screening.captured_at))).scalars().all()
        visits = []
        for sc in scrs:
            rows = (await s.execute(select(ScreeningImage, ImageResult).outerjoin(
                ImageResult, ImageResult.image_id == ScreeningImage.id).where(ScreeningImage.screening_id == sc.id)
                .order_by(ImageResult.created_at.desc()))).all()
            sites = {}
            for img, res in rows:
                if img.site in sites:
                    continue
                sites[img.site] = {"image_url": presign_or_none(cfg.bucket_images, img.object_key),
                                   "heatmap_url": presign_or_none(cfg.bucket_derived, res.cam_key) if res else None,
                                   "prob": res.prob if res else None,
                                   "highlighted_area_pct": res.lesion_area_pct if res else None}
            visits.append({"screening_id": str(sc.id), "captured_at": sc.captured_at, "risk_level": sc.risk_level,
                           "mouth_opening_mm": sc.mouth_opening_mm, "sites": sites})
        change = None
        if len(visits) >= 2:
            a, b = visits[-2], visits[-1]
            change = {"mouth_opening_mm": (b["mouth_opening_mm"] - a["mouth_opening_mm"])
                      if a["mouth_opening_mm"] is not None and b["mouth_opening_mm"] is not None else None,
                      "sites": {site: {"prob_change": (b["sites"][site]["prob"] or 0) - (a["sites"][site]["prob"] or 0),
                                       "area_change_pct": ((b["sites"][site]["highlighted_area_pct"] or 0)
                                                           - (a["sites"][site]["highlighted_area_pct"] or 0))}
                                for site in set(a["sites"]) & set(b["sites"])}}
        await log_patient_access(s, c, pid, "comparison")
        return {"visits": visits, "latest_change": change,
                "note": "Highlighted area is the share of the photo the AI heat map marks (>0.5) — an estimate, "
                        "not a measured lesion size."}


# ───────────────────────── QR health card & Provider Connect ─────────────────────────
@router.post("/patients/{pid}/card")
async def issue_card(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("card:issue", {"patient_id": pid})
    async with c.session() as s:
        p = await _get_patient(s, pid)
        for old in (await s.execute(select(HealthCard).where(HealthCard.patient_id == pid,
                                                             HealthCard.revoked_at.is_(None)))).scalars():
            old.revoked_at = datetime.now(timezone.utc)
        token, jti = issue_token("card", str(pid), ttl_seconds=60 * 60 * 24 * 365 * 3)
        card = HealthCard(patient_id=pid, token_jti=jti, issued_by=uuid.UUID(c.p.user_id))
        s.add(card)
        await s.flush()
        await c.audit(s, "card.issued", "health_card", card.id, pid)
        link = f"{get_settings().public_base_url}/connect?card={token}"
        return {"card_id": str(card.id), "display_id": p.display_id, "token": token, "link": link,
                "qr_png_base64": qr_png_base64(link),
                "printed_text": f"Sankalp Mouth Health Card · {p.display_id} · Show this to any doctor you visit"}


@router.post("/provider-connect/request")
async def provider_request(body: ProviderRequestIn, request: Request):
    """PUBLIC (rate-limited at the gateway). A local doctor scans the card; the PATIENT receives an OTP and
    shares it only if they agree. Nothing about the patient is revealed at this step."""
    claims = verify_token(body.card_token, "card")
    cfg = get_settings()
    async with request_session("provider-connect", "system") as s:
        card = (await s.execute(select(HealthCard).where(HealthCard.token_jti == claims["jti"]))).scalars().first()
        if card is None or card.revoked_at is not None:
            raise HTTPException(401, "card revoked or unknown")
        p = await s.get(Patient, card.patient_id)
        otp = new_otp()
        salt = uuid.uuid4().hex
        pa = ProviderAccess(patient_id=p.id, card_id=card.id, provider_name=body.provider_name,
                            provider_phone=body.provider_phone, provider_reg_no=body.provider_reg_no,
                            otp_hash=f"{salt}${hash_otp(otp, salt)}",
                            otp_expires_at=datetime.now(timezone.utc) + timedelta(minutes=cfg.otp_ttl_minutes))
        s.add(pa)
        await s.flush()
        await s.run_sync(lambda ss: queue_sms(ss, p.phone, "provider_otp", p.language, patient_id=p.id,
                                              related={"provider_access_id": str(pa.id)},
                                              provider=body.provider_name, otp=otp, minutes=cfg.otp_ttl_minutes))
        from ... import audit

        await audit.record(s, f"provider:{body.provider_phone[-4:]}", "provider", "provider.access_requested",
                           "provider_access", pa.id, p.id, {"provider": body.provider_name},
                           None, request.client.host if request.client else None)
        out = {"request_id": str(pa.id), "otp_sent_to": "patient's phone", "expires_in_minutes": cfg.otp_ttl_minutes}
        if cfg.messaging_mode == "sandbox" and cfg.env != "prod":
            out["sandbox_otp"] = otp            # demo convenience only; never in prod / Twilio mode
        return out


@router.post("/provider-connect/verify")
async def provider_verify(body: ProviderVerifyIn, request: Request):
    cfg = get_settings()
    # attempt counter is committed in its own transaction, so wrong guesses are always counted
    async with request_session("provider-connect", "system") as s:
        pa = await s.get(ProviderAccess, body.request_id)
        if pa is None or pa.verified_at or pa.revoked_at:
            raise HTTPException(400, "invalid request")
        if pa.attempts >= 5 or datetime.now(timezone.utc) > pa.otp_expires_at:
            raise HTTPException(429, "code expired or too many attempts — ask for a new code")
        pa.attempts += 1
        salt, stored = pa.otp_hash.split("$", 1)
    if not check_otp(body.otp, salt, stored):
        raise HTTPException(401, "wrong code")
    async with request_session("provider-connect", "system") as s:
        pa = await s.get(ProviderAccess, body.request_id)
        if pa.verified_at:
            raise HTTPException(400, "code already used")
        pa.verified_at = datetime.now(timezone.utc)
        pa.access_expires_at = pa.verified_at + timedelta(hours=cfg.provider_access_hours)
        token, _ = issue_token("provider", str(pa.patient_id), cfg.provider_access_hours * 3600,
                               {"pid": str(pa.id), "name": pa.provider_name})
        from ... import audit

        await audit.record(s, f"provider:{pa.id}", "provider", "provider.access_granted", "provider_access", pa.id,
                           pa.patient_id, {"hours": cfg.provider_access_hours, "method": "patient_otp"},
                           None, request.client.host if request.client else None)
        return {"access_token": token, "token_type": "bearer", "patient_id": str(pa.patient_id),
                "expires_at": pa.access_expires_at,
                "scope": "this patient only: summary, timeline, add note / medicine"}


@router.get("/provider/summary")
async def provider_summary(c: Ctx = Depends(ctx)):
    """What a local doctor sees after OTP consent: no photos, no AI internals — just what matters for care."""
    if not c.p.is_provider:
        raise HTTPException(403, "provider token required")
    pid = uuid.UUID(c.p.patient_scope)
    await c.can("patient:read", {"patient_id": pid})
    async with c.session() as s:
        p = await _get_patient(s, pid)
        await log_patient_access(s, c, pid, "provider_summary")
        scr = (await s.execute(select(Screening).where(Screening.patient_id == pid)
                               .order_by(Screening.captured_at.desc()))).scalars().first()
        ref = (await s.execute(select(Referral).where(Referral.patient_id == pid)
                               .order_by(Referral.created_at.desc()))).scalars().first()
        meds = (await s.execute(select(Medication).where(Medication.patient_id == pid)
                                .order_by(Medication.created_at.desc()).limit(10))).scalars().all()
        return {"patient": {"display_id": p.display_id, "name": p.full_name, "sex": p.sex, "birth_year": p.birth_year},
                "latest_screening": {"date": scr.captured_at, "risk_level": scr.risk_level,
                                     "mouth_opening_mm": scr.mouth_opening_mm} if scr else None,
                "referral": {"status": ref.status, "due_by": ref.due_by, "reason": ref.reason} if ref else None,
                "medicines": [{"name": m.name_matched or m.name_entered, "masks_symptoms": m.masks_symptoms,
                               "recorded": m.created_at} for m in meds],
                "guidance": "Pain relief from gels or painkillers can hide a worsening patch. Any patch or sore "
                            "lasting more than 2 weeks needs specialist review."}
