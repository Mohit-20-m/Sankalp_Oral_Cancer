"""Screenings: offline-first submission, resumable uploads, results with heat maps, decision history + replay."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from sqlalchemy import select

from ... import storage
from ...config import get_settings
from ...domain.clinical import compute_opening, score_habits
from ...domain.decision import evaluate
from ...models import (Decision, ImageResult, Patient, Referral, RuleSet, Screening, ScreeningImage,
                       TimelineEvent)
from ...observability import SCREENINGS
from ...outbox import emit
from ...services.rules import active_rule_set
from ..deps import Ctx, ctx, idem_lookup, idem_store, log_patient_access, presign_or_none
from ..schemas import MultipartDone, ScreeningIn

router = APIRouter(prefix="/screenings", tags=["screening"])
MULTIPART_THRESHOLD = 5 * 1024 * 1024
PART = 5 * 1024 * 1024


def _image_key(scr_id, img_id, site) -> str:
    return f"screenings/{scr_id}/{site}-{img_id}.jpg"


@router.post("", status_code=201)
async def create_screening(body: ScreeningIn, c: Ctx = Depends(ctx), idempotency_key: str | None = Header(None)):
    """Step 1 (works after the phone was offline): send the whole screening + photo manifest.
    The response tells the phone where to upload each photo. Re-sending the same client_uuid is safe."""
    await c.can("screening:create", {"patient_id": body.patient_id})
    cfg = get_settings()
    async with c.session() as s:
        if (prev := await idem_lookup(s, c, idempotency_key, "POST", "/screenings", body)) is not None:
            return prev
        existing = (await s.execute(select(Screening).where(Screening.client_uuid == body.client_uuid))
                    ).scalars().first()
        if existing:                         # offline re-sync of the same screening -> same answer
            return await _upload_plan(s, existing)
        p = await s.get(Patient, body.patient_id)
        if p is None:
            raise HTTPException(404, "patient not found")
        rs = await active_rule_set(s)
        score, level, factors = score_habits(body.habits.model_dump(), body.symptoms.model_dump(),
                                             rs.definition["habit_scoring"])
        mo = body.mouth_opening.model_dump() if body.mouth_opening else {}
        mm, detail = compute_opening(mo, rs.definition["mouth_opening"])
        scr = Screening(client_uuid=body.client_uuid, patient_id=p.id, facility_id=p.facility_id,
                        worker_id=uuid.UUID(c.p.user_id), captured_at=body.captured_at,
                        habits=body.habits.model_dump(), symptoms=body.symptoms.model_dump(), habit_score=score,
                        habit_level=level, mouth_opening={**mo, "computed": detail}, mouth_opening_mm=mm,
                        device=body.device, app_version=body.app_version, lat=body.lat, lon=body.lon,
                        expected_images=len(body.images), on_device_result=body.on_device_result)
        s.add(scr)
        await s.flush()
        for im in body.images:
            img_id = uuid.uuid4()
            s.add(ScreeningImage(id=img_id, client_uuid=im.client_uuid, screening_id=scr.id, patient_id=p.id,
                                 site=im.site, object_key=_image_key(scr.id, img_id, im.site), sha256=im.sha256,
                                 content_type=im.content_type, size_bytes=im.size_bytes,
                                 quality={"phone": im.quality}))
        s.add(TimelineEvent(patient_id=p.id, occurred_at=body.captured_at, kind="screening", source=c.p.role,
                            summary=f"Mouth screening by {c.p.username}", created_by=c.p.username,
                            data={"screening_id": str(scr.id), "patch_noticed": body.symptoms.patch_noticed,
                                  "burning": body.symptoms.burning}))
        await s.flush()
        await c.audit(s, "create.screening", "screening", scr.id, p.id,
                      {"images": len(body.images), "habit_level": level, "mouth_opening_mm": mm})
        out = await _upload_plan(s, scr)
        await idem_store(s, c, idempotency_key, "POST", "/screenings", body, out, 201)
        return out


async def _upload_plan(s, scr: Screening) -> dict:
    cfg = get_settings()
    imgs = (await s.execute(select(ScreeningImage).where(ScreeningImage.screening_id == scr.id))).scalars().all()
    plan = []
    for im in imgs:
        item = {"image_id": str(im.id), "client_uuid": str(im.client_uuid), "site": im.site,
                "status": im.upload_status,
                "direct_upload": f"/api/v1/screenings/{scr.id}/images/{im.id}/content"}
        if im.upload_status == "pending":
            try:
                if (im.size_bytes or 0) > MULTIPART_THRESHOLD:
                    parts = -(-im.size_bytes // PART)
                    item["multipart"] = storage.start_multipart(cfg.bucket_images, im.object_key, im.content_type,
                                                                parts)
                else:
                    item["presigned_put"] = storage.presign_put(cfg.bucket_images, im.object_key, im.content_type)
            except Exception:  # noqa: BLE001 — storage down: phone uses direct upload later
                pass
        plan.append(item)
    return {"screening_id": str(scr.id), "status": scr.status, "images": plan,
            "next": "upload each photo (presigned URL or direct_upload), then POST /screenings/{id}/submit"}


@router.put("/{sid}/images/{iid}/content")
async def upload_direct(sid: uuid.UUID, iid: uuid.UUID, file: UploadFile = File(...), c: Ctx = Depends(ctx)):
    """Upload through the API (fallback when the phone cannot reach object storage directly).
    The SHA-256 must match the manifest, otherwise the photo is rejected and the phone retries."""
    await c.can("image:upload")
    cfg = get_settings()
    data = await file.read()
    if len(data) > cfg.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "photo too large")
    async with c.session() as s:
        im = await s.get(ScreeningImage, iid)
        if im is None or im.screening_id != sid:
            raise HTTPException(404, "image not found")
        if hashlib.sha256(data).hexdigest() != im.sha256:
            raise HTTPException(422, "checksum mismatch — photo corrupted in transit, please retry")
        storage.put_bytes(cfg.bucket_images, im.object_key, data, im.content_type)
        im.upload_status, im.size_bytes = "uploaded", len(data)
        return {"image_id": str(iid), "status": "uploaded"}


@router.post("/{sid}/images/{iid}/complete")
async def complete_multipart(sid: uuid.UUID, iid: uuid.UUID, body: MultipartDone, c: Ctx = Depends(ctx)):
    await c.can("image:upload")
    cfg = get_settings()
    async with c.session() as s:
        im = await s.get(ScreeningImage, iid)
        if im is None or im.screening_id != sid:
            raise HTTPException(404, "image not found")
        storage.complete_multipart(cfg.bucket_images, im.object_key, body.upload_id, body.parts)
        im.upload_status = "uploaded"
        return {"image_id": str(iid), "status": "uploaded"}


@router.post("/{sid}/submit", status_code=202)
async def submit(sid: uuid.UUID, c: Ctx = Depends(ctx)):
    """Step 2: all photos sent. Presigned uploads are confirmed by checking storage; then the AI pipeline is queued
    through the transactional outbox (survives a Redis/worker outage)."""
    await c.can("screening:create")
    cfg = get_settings()
    async with c.session() as s:
        scr = await s.get(Screening, sid)
        if scr is None:
            raise HTTPException(404, "screening not found")
        imgs = (await s.execute(select(ScreeningImage).where(ScreeningImage.screening_id == sid))).scalars().all()
        missing = []
        for im in imgs:
            if im.upload_status == "pending":
                if storage.exists(cfg.bucket_images, im.object_key):
                    im.upload_status = "uploaded"
                else:
                    missing.append(im.site)
        if missing:
            raise HTTPException(409, {"error": "photos not uploaded yet", "missing_sites": missing})
        if scr.status == "received":
            scr.status = "processing"
            await emit(s, "screening.process", {"screening_id": str(sid), "trigger": "initial"},
                       dedupe_key=f"process:{sid}")
            SCREENINGS.labels("pending").inc()
        await c.audit(s, "submit.screening", "screening", sid, scr.patient_id)
        return {"screening_id": str(sid), "status": scr.status,
                "message": "Queued for AI analysis. Poll GET /screenings/{id} for the result."}


@router.post("/{sid}/retake", status_code=202)
async def retake(sid: uuid.UUID, files: list[UploadFile] = File(...), sites: str = Form(...),
                 quality: str = Form("[]"), c: Ctx = Depends(ctx)):
    """AI-only flag (rule R1b): the ASHA retakes ONLY the requested site(s), once. The new photo is stored next to
    the original (both stay visible to the specialist) and the screening is analysed again. Per site the newest
    usable photo decides — an unusable retake never hides the original flag."""
    cfg = get_settings()
    site_list = [x.strip() for x in sites.split(",") if x.strip()]
    if len(site_list) != len(files):
        raise HTTPException(422, "one site per photo")
    try:
        q_list = json.loads(quality) if quality else []
    except ValueError:
        q_list = []
    async with c.session() as s:
        scr = await s.get(Screening, sid)
        if scr is None:
            raise HTTPException(404, "screening not found")
        await c.can("screening:create", {"patient_id": str(scr.patient_id)})
        dec = await s.get(Decision, scr.decision_id) if scr.decision_id else None
        offer = (dec.outputs or {}).get("retake") if dec else None
        if scr.status != "retake_requested" or not offer:
            raise HTTPException(409, "no retake was requested for this screening (or it has expired)")
        wanted = set(offer["sites"])
        if not set(site_list) <= wanted:
            raise HTTPException(422, {"error": "only the requested sites can be retaken", "requested": sorted(wanted)})
        originals = {i.site: i for i in (await s.execute(select(ScreeningImage).where(
            ScreeningImage.screening_id == sid).order_by(ScreeningImage.created_at))).scalars()}
        for n, (f, site) in enumerate(zip(files, site_list)):
            data = await f.read()
            if len(data) > cfg.max_upload_mb * 1024 * 1024:
                raise HTTPException(413, "photo too large")
            img_id = uuid.uuid4()
            key = _image_key(sid, img_id, site)
            storage.put_bytes(cfg.bucket_images, key, data, f.content_type or "image/jpeg")
            orig = originals.get(site)
            s.add(ScreeningImage(id=img_id, client_uuid=uuid.uuid4(), screening_id=sid, patient_id=scr.patient_id,
                                 site=site, object_key=key, sha256=hashlib.sha256(data).hexdigest(),
                                 content_type=f.content_type or "image/jpeg", size_bytes=len(data),
                                 upload_status="uploaded",
                                 quality={"phone": q_list[n] if n < len(q_list) else {}, "retake": True,
                                          "retake_of": str(orig.id) if orig else None}))
        scr.status = "processing"
        await emit(s, "screening.process", {"screening_id": str(sid), "trigger": "retake"},
                   dedupe_key=f"retake:{sid}")
        await c.audit(s, "retake.screening", "screening", sid, scr.patient_id, {"sites": site_list})
        return {"screening_id": str(sid), "status": "processing", "sites": site_list,
                "message": "Retake received. Poll GET /screenings/{id} for the updated result."}


@router.get("/{sid}")
async def get_screening(sid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("screening:read")
    cfg = get_settings()
    async with c.session() as s:
        scr = await s.get(Screening, sid)
        if scr is None:
            raise HTTPException(404, "screening not found")
        await log_patient_access(s, c, scr.patient_id, "screening")
        dec = await s.get(Decision, scr.decision_id) if scr.decision_id else None
        rows = (await s.execute(select(ScreeningImage, ImageResult).outerjoin(
            ImageResult, ImageResult.image_id == ScreeningImage.id).where(ScreeningImage.screening_id == sid)
            .order_by(ScreeningImage.created_at.desc(), ImageResult.created_at.desc()))).all()
        sites = {}
        for img, res in rows:                      # newest photo per site (a retake replaces the original here)
            if img.site in sites:
                continue
            sites[img.site] = {
                "image_id": str(img.id), "upload_status": img.upload_status,
                "retake": bool((img.quality or {}).get("retake")),
                "quality": img.quality, "image_url": presign_or_none(cfg.bucket_images, img.object_key),
                "ai": None if res is None else {
                    "prob": res.prob, "out_of_distribution": res.out_of_distribution,
                    "highlighted_area_pct": res.lesion_area_pct, "model_version": res.model_version,
                    "head_version": res.head_version, "heatmap_url": presign_or_none(cfg.bucket_derived, res.cam_key),
                    "shadow": res.shadow}}
        ref = (await s.execute(select(Referral).where(Referral.screening_id == sid))).scalars().first()
        return {"id": str(sid), "patient_id": str(scr.patient_id), "status": scr.status, "ai_status": scr.ai_status,
                "captured_at": scr.captured_at, "risk_level": scr.risk_level,
                "reasons": dec.outputs.get("reasons") if dec else [],
                "actions": dec.outputs.get("actions") if dec else [],
                "retake": (dec.outputs or {}).get("retake") if dec and scr.status == "retake_requested" else None,
                "ai_only_flag": bool(dec and any(r.get("rule") in ("R1b", "R1c")
                                                 for r in dec.outputs.get("reasons", []))),
                "disclaimer": "Screening aid only — not a diagnosis. A specialist confirms every high-risk result.",
                "habit": {"score": scr.habit_score, "level": scr.habit_level},
                "mouth_opening_mm": scr.mouth_opening_mm,
                "mouth_opening_detail": (scr.mouth_opening or {}).get("computed"),
                "lesion_score": scr.lesion_score, "sites": sites,
                "referral": {"id": str(ref.id), "status": ref.status, "due_by": ref.due_by} if ref else None,
                "decision": {"id": str(dec.id), "rule_set_version": dec.rule_set_version,
                             "model_version": dec.model_version, "head_version": dec.head_version,
                             "created_at": dec.created_at} if dec else None,
                "on_device_result": scr.on_device_result}


@router.get("/{sid}/decisions")
async def decisions(sid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("screening:read")
    async with c.session() as s:
        rows = (await s.execute(select(Decision).where(Decision.screening_id == sid)
                                .order_by(Decision.created_at))).scalars().all()
        return [{"id": str(d.id), "created_at": d.created_at, "trigger": d.trigger, "risk_level": d.risk_level,
                 "rule_set_version": d.rule_set_version, "model_version": d.model_version,
                 "head_version": d.head_version, "reasons": d.outputs.get("reasons")} for d in rows]


@router.post("/{sid}/replay")
async def replay(sid: uuid.UUID, decision_id: uuid.UUID | None = None, c: Ctx = Depends(ctx)):
    """Decision replay (auditability): re-run the EXACT rule-set version on the EXACT stored inputs and prove the
    outcome is identical. Rule sets are immutable once approved, so replay is deterministic."""
    await c.can("screening:read")
    async with c.session() as s:
        q = select(Decision).where(Decision.screening_id == sid)
        q = q.where(Decision.id == decision_id) if decision_id else q.order_by(Decision.created_at.desc())
        dec = (await s.execute(q)).scalars().first()
        if dec is None:
            raise HTTPException(404, "no decision")
        rs = (await s.execute(select(RuleSet).where(RuleSet.version == dec.rule_set_version))).scalars().one()
        facts = {k: v for k, v in dec.inputs.items() if k not in ("ai", "timeline", "habit_score",
                                                                  "mouth_opening_detail")}
        again = evaluate(rs.definition, facts)
        original = dict(dec.outputs)
        same = again["risk_level"] == dec.risk_level and [r["rule"] for r in again["reasons"]] == \
            [r["rule"] for r in original.get("reasons", []) if r["rule"] not in ("SAFETY", "RETAKE")]
        safety_override = any(r["rule"] == "SAFETY" for r in original.get("reasons", []))
        await c.audit(s, "decision.replayed", "decision", dec.id, None, {"identical": same or safety_override})
        return {"decision_id": str(dec.id), "rule_set_version": rs.version, "rule_set_sha256": rs.sha256,
                "rule_set_sha_matches": rs.sha256 == dec.rule_set_sha256, "model_version": dec.model_version,
                "original_risk": dec.risk_level, "replayed_risk": again["risk_level"],
                "identical": bool(same or (safety_override and dec.risk_level == "HIGH")),
                "note": "An open-referral safety override (only a specialist may downgrade) is applied after rules"
                        if safety_override else None,
                "replayed_reasons": again["reasons"]}
