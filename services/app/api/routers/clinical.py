"""Referrals (QR slip, scan, status), specialist review queue + case view + review, follow-ups."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text

from ...config import get_settings
from ...models import (Consent, Decision, Facility, FollowUp, ImageResult, Label, Patient, ProviderAccess, Referral,
                       ReferenceCase, Review, ReviewTask, Screening, ScreeningImage, TimelineEvent, Village)
from ...observability import REVIEWS
from ...outbox import emit
from ...security.tokens import issue_token, qr_png_base64, verify_token
from ...services.notify import notify_staff, queue_sms
from ..deps import Ctx, ctx, log_patient_access, presign_or_none
from ..schemas import FollowUpDoneIn, ReferralStatusIn, ReviewIn, ScanIn

router = APIRouter(tags=["referrals, specialist review & follow-up"])
POSITIVE = {"confirm_refer", "needs_biopsy"}


def _ref_out(r: Referral) -> dict:
    return {"id": str(r.id), "screening_id": str(r.screening_id), "patient_id": str(r.patient_id),
            "facility_id": str(r.facility_id), "priority": r.priority, "status": r.status, "reason": r.reason,
            "due_by": r.due_by, "booked_for": r.booked_for, "visited_at": r.visited_at,
            "completed_at": r.completed_at, "outcome": r.outcome, "created_at": r.created_at}


# ───────────────────────── referrals ─────────────────────────
@router.get("/referrals")
async def list_referrals(status: str | None = None, c: Ctx = Depends(ctx)):
    await c.can("referral:read")
    async with c.session() as s:
        q = select(Referral).order_by(Referral.due_by)
        if status:
            q = q.where(Referral.status == status)
        return [_ref_out(r) for r in (await s.execute(q.limit(500))).scalars()]


@router.get("/referrals/{rid}/slip")
async def referral_slip(rid: uuid.UUID, c: Ctx = Depends(ctx)):
    """Printable slip: QR (opaque token only — no names or diagnoses inside the code)."""
    await c.can("referral:read")
    async with c.session() as s:
        r = await s.get(Referral, rid)
        if r is None:
            raise HTTPException(404, "referral not found")
        p = await s.get(Patient, r.patient_id)
        fac = await s.get(Facility, r.facility_id)
        token, jti = issue_token("referral", str(r.id), ttl_seconds=60 * 60 * 24 * 120)
        r.token_jti = jti                       # re-issuing invalidates older printed slips
        payload = f"{get_settings().public_base_url}/r/{token}"
        lang_line = {"kn": "ಇದು ತಪಾಸಣೆ ಚೀಟಿ — ರೋಗನಿರ್ಣಯವಲ್ಲ", "tcy": "ಉಂದು ತಪಾಸಣೆ ಚೀಟಿ", "en": "Screening referral"}
        return {"referral_id": str(r.id), "patient_display_id": p.display_id, "patient_name": p.full_name,
                "facility": {"name": fac.name, "phone": fac.phone} if fac else None, "due_by": r.due_by,
                "priority": r.priority, "language_line": lang_line.get(p.language, lang_line["en"]),
                "qr_payload": payload, "qr_png_base64": qr_png_base64(payload),
                "disclaimer": "Screening aid only — not a diagnosis."}


@router.post("/referrals/scan")
async def scan_referral(body: ScanIn, c: Ctx = Depends(ctx)):
    """Clinic scans the QR → the full case opens (authorisation + row-level security still apply)."""
    await c.can("referral:read")
    claims = verify_token(body.token.rsplit("/", 1)[-1], "referral")
    async with c.session() as s:
        r = await s.get(Referral, uuid.UUID(claims["sub"]))
        if r is None:
            raise HTTPException(404, "referral not visible to you")
        if r.token_jti != claims["jti"]:
            raise HTTPException(410, "this slip was replaced by a newer one")
        await log_patient_access(s, c, r.patient_id, "referral_scan")
        return {"referral": _ref_out(r), "case_url": f"/api/v1/review/cases/{r.screening_id}"}


@router.post("/referrals/{rid}/status")
async def referral_status(rid: uuid.UUID, body: ReferralStatusIn, c: Ctx = Depends(ctx)):
    await c.can("referral:update")
    async with c.session() as s:
        r = await s.get(Referral, rid)
        if r is None:
            raise HTTPException(404, "referral not found")
        allowed = {"pending": {"booked", "visited", "cancelled"}, "booked": {"visited", "cancelled"},
                   "visited": {"completed"}, "completed": set(), "cancelled": set()}
        if body.status not in allowed[r.status]:
            raise HTTPException(409, f"cannot go from {r.status} to {body.status}")
        now = datetime.now(timezone.utc)
        r.status = body.status
        if body.status == "booked":
            r.booked_for = body.booked_for
        if body.status == "visited":
            r.visited_at = now
        if body.status == "completed":
            r.completed_at, r.outcome = now, {**(r.outcome or {}), **(body.outcome or {})}
        s.add(TimelineEvent(patient_id=r.patient_id, occurred_at=now, kind="referral", source=c.p.role,
                            summary=f"Referral {body.status}", data={"referral_id": str(rid), **(body.outcome or {})},
                            created_by=c.p.username))
        await c.audit(s, f"referral.{body.status}", "referral", rid, r.patient_id, body.outcome or {})
        return _ref_out(r)


# ───────────────────────── specialist queue & case ─────────────────────────
@router.get("/review/queue")
async def queue(c: Ctx = Depends(ctx)):
    await c.can("review:queue")
    async with c.session() as s:
        rows = (await s.execute(
            select(ReviewTask, Screening, Patient).join(Screening, Screening.id == ReviewTask.screening_id)
            .join(Patient, Patient.id == ReviewTask.patient_id).where(ReviewTask.status == "open")
            .order_by(ReviewTask.priority, ReviewTask.created_at).limit(200))).all()
        vnames = {v.id: v.name for v in (await s.execute(select(Village))).scalars()}
        fnames = {f.id: f.name for f in (await s.execute(select(Facility))).scalars()}
        now = datetime.now(timezone.utc)
        return [{"task_id": str(t.id), "kind": t.kind, "priority": t.priority, "screening_id": str(sc.id),
                 "patient": {"id": str(p.id), "display_id": p.display_id, "name": p.full_name, "sex": p.sex,
                             "birth_year": p.birth_year, "village": vnames.get(p.village_id)},
                 "facility": fnames.get(sc.facility_id),
                 "risk_level": sc.risk_level, "lesion_score": sc.lesion_score, "mouth_opening_mm": sc.mouth_opening_mm,
                 "habit_level": sc.habit_level, "captured_at": sc.captured_at,
                 "waiting_hours": round((now - t.created_at).total_seconds() / 3600, 1)} for t, sc, p in rows]


async def _similar_cases(s, scr_id, k: int = 3) -> list[dict]:
    """Nearest confirmed cases (pgvector cosine) to the most suspicious photo of this screening."""
    cfg = get_settings()
    best = (await s.execute(select(ImageResult).join(ScreeningImage, ScreeningImage.id == ImageResult.image_id)
                            .where(ScreeningImage.screening_id == scr_id, ImageResult.embedding.isnot(None))
                            .order_by(ImageResult.prob.desc()))).scalars().first()
    if best is None:
        return []
    import numpy as np

    e = np.asarray(best.embedding, np.float32)
    e = (e / (np.linalg.norm(e) + 1e-8)).tolist()
    rows = (await s.execute(text("""
        SELECT id, label, source, origin, diagnosis_code, thumbnail_key, 1 - (embedding <=> CAST(:e AS vector)) AS sim
        FROM reference_cases WHERE backbone_version = :bv
        ORDER BY embedding <=> CAST(:e AS vector) LIMIT :k"""), {"e": str(e), "bv": best.model_version, "k": k})).all()
    return [{"id": str(r.id), "label": r.label, "source": r.source, "origin": r.origin, "diagnosis_code": r.diagnosis_code,
             "similarity": round(float(r.sim), 3), "thumbnail_url": presign_or_none(cfg.bucket_derived,
                                                                                    r.thumbnail_key)} for r in rows]


@router.get("/review/cases/{sid}")
async def case_view(sid: uuid.UUID, c: Ctx = Depends(ctx)):
    """Everything a specialist needs on one screen: photos + heat maps, explanation, measurements, habits,
    full care timeline (incl. medicines), similar confirmed cases, earlier visits."""
    await c.can("review:queue")
    cfg = get_settings()
    async with c.session() as s:
        scr = await s.get(Screening, sid)
        if scr is None:
            raise HTTPException(404, "case not visible to you")
        p = await s.get(Patient, scr.patient_id)
        await log_patient_access(s, c, p.id, "case_view")
        dec = await s.get(Decision, scr.decision_id) if scr.decision_id else None
        rows = (await s.execute(select(ScreeningImage, ImageResult).outerjoin(
            ImageResult, ImageResult.image_id == ScreeningImage.id).where(ScreeningImage.screening_id == sid)
            .order_by(ImageResult.created_at.desc()))).all()
        photos, seen = [], set()
        for img, res in rows:
            if img.id in seen:
                continue
            seen.add(img.id)
            photos.append({"image_id": str(img.id), "site": img.site,
                           "retake": bool((img.quality or {}).get("retake")),
                           "image_url": presign_or_none(cfg.bucket_images, img.object_key),
                           "heatmap_url": presign_or_none(cfg.bucket_derived, res.cam_key) if res else None,
                           "prob": res.prob if res else None,
                           "out_of_distribution": res.out_of_distribution if res else None,
                           "quality_issues": ((img.quality or {}).get("server") or {}).get("issues", [])})
        tl = (await s.execute(select(TimelineEvent).where(TimelineEvent.patient_id == p.id)
                              .order_by(TimelineEvent.occurred_at))).scalars().all()
        prior = (await s.execute(select(Screening).where(Screening.patient_id == p.id, Screening.id != sid)
                                 .order_by(Screening.captured_at.desc()))).scalars().all()
        facts = dec.inputs if dec else {}
        explanation = {
            "summary": "Flagged because: " + " + ".join(
                filter(None, [f"patch score {facts.get('lesion_score'):.2f}" if facts.get("lesion_score") else None,
                              f"mouth opening {facts.get('opening_mm')} mm" if facts.get("opening_mm") else None,
                              facts.get("habit_factors") if facts.get("habit_level") == "high" else None])) or "—",
            "reasons": dec.outputs.get("reasons") if dec else [],
            "threshold": facts.get("lesion_threshold"), "rule_set_version": dec.rule_set_version if dec else None,
            "model_version": dec.model_version if dec else None}
        return {"screening_id": str(sid), "risk_level": scr.risk_level, "captured_at": scr.captured_at,
                "patient": {"id": str(p.id), "display_id": p.display_id, "name": p.full_name, "sex": p.sex,
                            "birth_year": p.birth_year, "language": p.language},
                "habits": scr.habits, "symptoms": scr.symptoms, "habit_score": scr.habit_score,
                "mouth_opening_mm": scr.mouth_opening_mm, "mouth_opening_detail": (scr.mouth_opening or {}).get("computed"),
                "photos": photos, "explanation": explanation, "similar_cases": await _similar_cases(s, sid),
                "timeline": [{"at": e.occurred_at, "kind": e.kind, "source": e.source, "summary": e.summary,
                              "data": e.data} for e in tl],
                "previous_screenings": [{"id": str(x.id), "date": x.captured_at, "risk_level": x.risk_level,
                                         "mouth_opening_mm": x.mouth_opening_mm} for x in prior],
                "disclaimer": "AI output is decision support. The specialist's judgement is final."}


@router.post("/review/cases/{sid}/review", status_code=201)
async def submit_review(sid: uuid.UUID, body: ReviewIn, c: Ctx = Depends(ctx)):
    """The specialist decides. Their verdict becomes (consented) training labels, closes the task, updates the
    referral, tells the ASHA and — if a local doctor is linked — the local doctor too."""
    await c.can("review:submit")
    async with c.session() as s:
        scr = await s.get(Screening, sid)
        if scr is None:
            raise HTTPException(404, "case not visible to you")
        p = await s.get(Patient, scr.patient_id)
        dec = await s.get(Decision, scr.decision_id) if scr.decision_id else None
        # an AI flag sent to review without auto-referral (rule R1b, NEEDS_REVIEW) still counts as "AI positive"
        ai_positive = scr.risk_level == "HIGH" or bool(dec and (dec.inputs or {}).get("lesion_suspicious"))
        agreed = None if body.verdict == "cannot_assess" else (ai_positive == (body.verdict in POSITIVE))
        if agreed is False and not body.override_reason:
            raise HTTPException(422, "please give a reason when you disagree with the AI (it improves the model)")
        latest = (await s.execute(select(ImageResult.model_version, ImageResult.head_version)
                                  .join(ScreeningImage, ScreeningImage.id == ImageResult.image_id)
                                  .where(ScreeningImage.screening_id == sid)
                                  .order_by(ImageResult.created_at.desc()))).first()
        task = (await s.execute(select(ReviewTask).where(ReviewTask.screening_id == sid, ReviewTask.status == "open")
                                .order_by(ReviewTask.priority))).scalars().first()
        rv = Review(task_id=task.id if task else None, screening_id=sid, specialist_id=uuid.UUID(c.p.user_id),
                    verdict=body.verdict, diagnosis_code=body.diagnosis_code, diagnosis_text=body.diagnosis_text,
                    ai_risk_level=scr.risk_level, ai_agreed=agreed, override_reason=body.override_reason,
                    notes=body.notes, site_labels=body.site_labels,
                    model_version=(latest[0] if latest[1] == "base" else latest[1]) if latest else None)
        s.add(rv)
        await s.flush()
        REVIEWS.labels(body.verdict, str(agreed)).inc()
        # labels (only with AI-training consent); per-site if given, else derived from the verdict
        consent_ok = bool((await s.execute(select(func.count()).select_from(Consent).where(
            Consent.patient_id == p.id, Consent.purpose == "ai_training", Consent.granted.is_(True),
            Consent.withdrawn_at.is_(None)))).scalar())
        labels_made, disputes = 0, 0
        if body.verdict != "cannot_assess":
            imgs = (await s.execute(select(ScreeningImage, ImageResult.prob).outerjoin(
                ImageResult, ImageResult.image_id == ScreeningImage.id).where(
                ScreeningImage.screening_id == sid, ScreeningImage.site != "front_open"))).all()
            thr = ((await s.get(Decision, scr.decision_id)).inputs.get("lesion_threshold") or 0.5) \
                if scr.decision_id else 0.5
            done_imgs = set()
            for img, prob in imgs:
                if img.id in done_imgs:
                    continue
                done_imgs.add(img.id)
                if img.site in body.site_labels:
                    lab = body.site_labels[img.site]
                elif body.verdict in POSITIVE:
                    lab = "refer" if (prob or 0) >= thr else None   # unknown which site: only clearly flagged ones
                else:
                    lab = "no_refer"
                if lab is None:
                    continue
                other = (await s.execute(select(Label).where(Label.image_id == img.id, Label.status == "active")
                                         )).scalars().first()
                status = "active"
                if other and other.label != lab:
                    other.status, status = "disputed", "disputed"
                    disputes += 1
                s.add(Label(image_id=img.id, review_id=rv.id, label=lab, source="specialist", status=status,
                            consent_ai_training=consent_ok))
                labels_made += 1
                if consent_ok and status == "active" and prob is not None:
                    res = (await s.execute(select(ImageResult).where(ImageResult.image_id == img.id)
                                           .order_by(ImageResult.created_at.desc()))).scalars().first()
                    if res is not None and res.embedding is not None:
                        import numpy as np

                        e = np.asarray(res.embedding, np.float32)
                        s.add(ReferenceCase(ref_key=f"case:{img.id}:{rv.id}", origin="confirmed_case", label=lab,
                                            source="specialist_confirmed", image_id=img.id,
                                            diagnosis_code=body.diagnosis_code, backbone_version=res.model_version,
                                            embedding=(e / (np.linalg.norm(e) + 1e-8)).tolist(),
                                            embedding_raw=e.tolist()))
        if disputes:
            s.add(ReviewTask(screening_id=sid, patient_id=p.id, facility_id=task.facility_id if task else p.facility_id,
                             kind="disputed_label", priority=15))
        if task:
            task.status, task.completed_at = "done", datetime.now(timezone.utc)
        ref = (await s.execute(select(Referral).where(Referral.patient_id == p.id,
                                                      Referral.status.in_(["pending", "booked", "visited"]))
                               )).scalars().first()
        verdict_text = {"confirm_refer": "suspicious — see specialist", "needs_biopsy": "biopsy needed",
                        "not_suspicious": "not suspicious", "cannot_assess": "needs better photos / in-person exam"
                        }[body.verdict]
        if ref:
            ref.outcome = {**(ref.outcome or {}), "specialist_verdict": body.verdict,
                           "diagnosis_code": body.diagnosis_code, "reviewed_by": c.p.username}
            if body.verdict == "not_suspicious":
                ref.status, ref.completed_at = "completed", datetime.now(timezone.utc)
        elif body.verdict in POSITIVE:
            # no referral yet (AI-only flag held for review, cannot-assess, audit sample): the worker creates it
            # with system privileges, texts the patient and pushes FHIR — same path as an automatic referral
            await emit(s, "referral.after_review", {"screening_id": str(sid), "verdict": body.verdict,
                                                    "review_id": str(rv.id)}, dedupe_key=f"ref-after-review:{sid}")
        s.add(TimelineEvent(patient_id=p.id, occurred_at=datetime.now(timezone.utc), kind="review",
                            source="specialist", summary=f"Specialist review: {verdict_text}",
                            data={"verdict": body.verdict, "diagnosis_code": body.diagnosis_code,
                                  "review_id": str(rv.id)}, created_by=c.p.username))

        def _notify(ss):
            if scr.worker_id:
                notify_staff(ss, scr.worker_id, "staff_review_done", related={"screening_id": str(sid)},
                             patient=p.display_id, verdict=verdict_text,
                             action="Please inform the patient and help them attend." if body.verdict in POSITIVE
                             else "Continue routine follow-up.")
            pa = ss.execute(select(ProviderAccess).where(ProviderAccess.patient_id == p.id,
                                                         ProviderAccess.verified_at.isnot(None))
                            .order_by(ProviderAccess.verified_at.desc())).scalars().first()
            if pa:      # close the loop with the local doctor who treated the patient
                queue_sms(ss, pa.provider_phone, "provider_outcome", "en", patient_id=p.id,
                          patient_ref=p.display_id, verdict=verdict_text)

        await s.run_sync(_notify)
        await c.audit(s, "review.submitted", "review", rv.id, p.id,
                      {"verdict": body.verdict, "ai_agreed": agreed, "labels": labels_made, "disputes": disputes,
                       "consent_ai_training": consent_ok})
        return {"review_id": str(rv.id), "ai_agreed": agreed, "labels_created": labels_made,
                "label_disputes": disputes, "used_for_training": consent_ok,
                "referral_status": ref.status if ref else None}


@router.get("/review/stats")
async def review_stats(c: Ctx = Depends(ctx)):
    """Your agreement with the AI — helps specialists learn when to rely on it."""
    await c.can("review:queue")
    async with c.session() as s:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        mine = (await s.execute(select(Review.ai_agreed, Review.verdict).where(
            Review.specialist_id == uuid.UUID(c.p.user_id), Review.created_at >= since))).all()
        vals = [a for a, _ in mine if a is not None]
        return {"last_30_days": len(mine), "ai_agreement": (sum(vals) / len(vals)) if vals else None,
                "by_verdict": {v: sum(1 for _, x in mine if x == v) for v in {x for _, x in mine}}}


# ───────────────────────── follow-ups ─────────────────────────
@router.get("/followups")
async def followups(due_within_days: int = 30, c: Ctx = Depends(ctx)):
    await c.can("followup:read")
    async with c.session() as s:
        rows = (await s.execute(select(FollowUp, Patient).join(Patient, Patient.id == FollowUp.patient_id).where(
            FollowUp.status.in_(["scheduled", "notified"]),
            FollowUp.due_on <= date.today() + timedelta(days=due_within_days)).order_by(FollowUp.due_on))).all()
        return [{"id": str(f.id), "due_on": f.due_on, "reason": f.reason, "status": f.status,
                 "patient": {"id": str(p.id), "display_id": p.display_id, "name": p.full_name},
                 "screening_id": str(f.screening_id)} for f, p in rows]


@router.post("/followups/{fid}/complete")
async def followup_done(fid: uuid.UUID, body: FollowUpDoneIn, c: Ctx = Depends(ctx)):
    await c.can("followup:read")
    async with c.session() as s:
        f = await s.get(FollowUp, fid)
        if f is None:
            raise HTTPException(404, "follow-up not found")
        f.status, f.done_screening_id = "done", body.screening_id
        await c.audit(s, "followup.done", "followup", fid, f.patient_id)
        return {"id": str(fid), "status": "done"}
