"""Screening pipeline (runs in the worker; idempotent; safe to retry).

received ──► verify uploads (sha256) ──► server quality re-check ──► AI inference (+ heat maps)
        ──► facts (habits, mouth opening, AI, timeline) ──► decision (active rule set) ──► actions
Actions: referral + patient SMS, specialist review task, check-in, follow-up, audit sample, staff notice.

Safety rules enforced here:
* AI unavailable -> NEEDS_REVIEW (rule set fail-safe), retried with exponential backoff.
* An open referral is never cancelled by automation — only a specialist can downgrade a case.
"""
from __future__ import annotations

import hashlib
import io
from datetime import date, datetime, timedelta, timezone

import numpy as np
from PIL import Image, ImageOps
from sqlalchemy import func, select, text

from .. import audit, storage
from ..config import get_settings
from ..domain.clinical import MEASUREMENT_SITE, compute_opening, image_quality, score_habits
from ..domain.decision import SEVERITY, build_facts, evaluate
from ..models import (CheckIn, Decision, FollowUp, ImageResult, Medication, Patient, Referral, ReviewTask,
                      Screening, ScreeningImage, Staff, TimelineEvent)
from ..observability import DECISIONS, log
from ..outbox import emit_sync
from ..resilience import backoff_delay
from ..security.tokens import issue_token
from . import inference_client
from .notify import notify_staff, queue_sms
from .rules import active_rule_set_sync

TASK_PRIORITY = {"escalation": 5, "referral_review": 10, "cannot_assess": 20, "needs_review": 30,
                 "audit_sample": 50, "disputed_label": 15}
MAX_AI_ATTEMPTS = 6


# ───────────────────────── heat-map rendering ─────────────────────────
def _jet(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    r = np.clip(1.5 - np.abs(4 * x - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * x - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * x - 1), 0, 1)
    return np.stack([r, g, b], -1)


def render_heatmap(image_bytes: bytes, cam: list[list[float]], letterbox: list[int], input_size: int,
                   max_side: int = 640) -> tuple[bytes, float]:
    """Map the model's heat-map grid back onto the ORIGINAL photo (undoing the letterbox)."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    im.thumbnail((max_side, max_side))
    w, h = im.size
    cam_arr = np.asarray(cam, np.float32)
    full = np.asarray(Image.fromarray((cam_arr * 255).astype(np.uint8)).resize((input_size, input_size),
                                                                              Image.BICUBIC), np.float32) / 255
    left, top, nw, nh = letterbox
    crop = full[top:top + nh, left:left + nw]
    heat = np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    area_pct = float((heat > 0.5).mean() * 100)
    base = np.asarray(im, np.float32) / 255
    alpha = (0.15 + 0.45 * heat)[..., None]
    over = (base * (1 - alpha) + _jet(heat) * alpha)
    return storage.png_bytes((np.clip(over, 0, 1) * 255).astype(np.uint8)), round(area_pct, 2)


# ───────────────────────── timeline facts ─────────────────────────
def timeline_facts(s, patient_id, screening: Screening) -> dict:
    now = datetime.now(timezone.utc)
    meds = s.execute(select(Medication).where(Medication.patient_id == patient_id,
                                              Medication.created_at >= now - timedelta(days=60),
                                              Medication.masks_symptoms.is_(True))
                     .order_by(Medication.created_at.desc())).scalars().first()
    first_patch = s.execute(select(func.min(TimelineEvent.occurred_at)).where(
        TimelineEvent.patient_id == patient_id,
        TimelineEvent.kind.in_(["symptom_report", "screening"]),
        TimelineEvent.data["patch_noticed"].astext == "true")).scalar()
    patch_days = None
    if screening.symptoms.get("patch_duration_days") is not None:
        patch_days = int(screening.symptoms["patch_duration_days"])
    if first_patch is not None:
        patch_days = max(patch_days or 0, (now - first_patch).days)
    last_ci = s.execute(select(CheckIn).where(CheckIn.patient_id == patient_id, CheckIn.response.isnot(None))
                        .order_by(CheckIn.responded_at.desc())).scalars().first()
    prev_high = s.execute(select(func.count()).select_from(Screening).where(
        Screening.patient_id == patient_id, Screening.id != screening.id, Screening.risk_level == "HIGH")).scalar()
    pain_relieved = bool(screening.symptoms.get("pain_relieved_by_medication")) or bool(
        s.execute(select(func.count()).select_from(TimelineEvent).where(
            TimelineEvent.patient_id == patient_id, TimelineEvent.kind == "symptom_report",
            TimelineEvent.data["pain_relieved"].astext == "true")).scalar())
    return {"patch_days": patch_days,
            "masking_medication": meds.name_matched or meds.name_entered if meds else None,
            "pain_relieved": pain_relieved,
            "symptoms_returned": bool(last_ci and last_ci.response == "symptoms_back"
                                      and last_ci.responded_at >= now - timedelta(days=30)),
            "previous_high": bool(prev_high)}


# ───────────────────────── AI step ─────────────────────────
def _verify_and_quality(s, img: ScreeningImage, rules: dict) -> bytes | None:
    cfg = get_settings()
    try:
        data = storage.get_bytes(cfg.bucket_images, img.object_key)
    except Exception as e:  # noqa: BLE001
        log.warning("image_missing", image=str(img.id), error=str(e))
        return None
    if hashlib.sha256(data).hexdigest() != img.sha256:
        img.upload_status = "corrupt"
        log.warning("image_checksum_mismatch", image=str(img.id))
        return None
    if img.upload_status != "verified":
        img.upload_status = "verified"
        img.size_bytes = len(data)
    if "server" not in (img.quality or {}):
        try:
            q = image_quality(data, rules.get("quality"))
        except Exception as e:  # noqa: BLE001
            q = {"ok": False, "issues": [f"undecodable: {e}"]}
        img.quality = {**(img.quality or {}), "server": q}
        img.width, img.height = q.get("width"), q.get("height")
    return data


def pick_sites(images: list[tuple[str, str]], probs: dict, bad: set, ood: set, thr: float) -> dict:
    """images: (site, image_id) NEWEST FIRST. Per site:
    * the newest RELIABLE photo (passed the quality check, looks like the training photos) decides;
    * otherwise the newest photo that has a score: a LOW score counts as low; a HIGH score on an unclear/unusual
      photo is an "unreliable flag" (not trusted for auto-referral -> retake / doctor, rule R1c);
    * no score at all (missing / unreadable) -> unusable.
    So a clean retake replaces a flagged photo, but an unclear retake never hides an earlier reliable flag."""
    by_site: dict[str, list[str]] = {}
    for site, iid in images:
        by_site.setdefault(site, []).append(iid)
    site_probs, unreliable, unusable, low_quality = {}, {}, [], []
    for site, ids in by_site.items():
        reliable = [i for i in ids if i in probs and i not in bad and i not in ood]
        scored = [i for i in ids if i in probs]
        if reliable:
            site_probs[site] = probs[reliable[0]]
        elif scored:
            low_quality.append(site)
            if probs[scored[0]] >= thr:
                unreliable[site] = probs[scored[0]]
            else:
                site_probs[site] = probs[scored[0]]
        else:
            unusable.append(site)
    return {"site_probs": site_probs, "unreliable_flag_sites": unreliable, "unusable_sites": sorted(unusable),
            "low_quality_sites": sorted(low_quality)}


def run_ai(s, scr: Screening, rules: dict) -> dict:
    cfg = get_settings()
    imgs = s.execute(select(ScreeningImage).where(ScreeningImage.screening_id == scr.id,
                                                  ScreeningImage.site != MEASUREMENT_SITE)
                     .order_by(ScreeningImage.created_at.desc())).scalars().all()
    blobs, by_id, bad = [], {}, set()
    for img in imgs:
        data = _verify_and_quality(s, img, rules)
        if data is None:
            bad.add(str(img.id))
            continue
        server_q = (img.quality or {}).get("server", {})
        if not server_q.get("ok", True):
            bad.add(str(img.id))
        blobs.append((str(img.id), data))
        by_id[str(img.id)] = (img, data)
    if not blobs:
        return {"available": False, "reason": "no verified images",
                "unusable_sites": sorted({i.site for i in imgs})}
    resp = inference_client.predict_batched(blobs)
    probs, ood = {}, set()
    for r in resp["results"]:
        img, data = by_id[r["id"]]
        if "error" in r:
            bad.add(str(img.id))
            continue
        png, area = render_heatmap(data, r["cam"], r["letterbox"], r["input_size"])
        cam_key = f"heatmaps/{scr.id}/{img.id}-{resp['active_version']}.png"
        storage.put_bytes(cfg.bucket_derived, cam_key, png, "image/png")
        existing = s.execute(select(ImageResult).where(ImageResult.image_id == img.id,
                                                       ImageResult.model_version == resp["model_version"],
                                                       ImageResult.head_version == resp["head_version"])
                             ).scalars().first()
        row = existing or ImageResult(image_id=img.id, model_version=resp["model_version"],
                                      head_version=resp["head_version"])
        row.prob, row.logit = r["prob"], r["logit"]
        row.ood_distance, row.out_of_distribution = r.get("ood_distance"), bool(r.get("out_of_distribution"))
        row.lesion_area_pct, row.cam_key, row.embedding = area, cam_key, r["embedding"]
        row.shadow, row.latency_ms = r.get("shadow"), resp.get("latency_ms")
        s.add(row)
        probs[str(img.id)] = r["prob"]
        if row.out_of_distribution:
            ood.add(str(img.id))
    # only photos that passed the quality gate AND look like the training data may drive the decision;
    # an out-of-distribution photo (hand, clothing, face...) gets an arbitrary probability from the model
    thr = rules["lesion"].get("threshold") or resp["thresholds"].get("screening", 0.5)
    picked = pick_sites([(i.site, str(i.id)) for i in imgs], probs, bad, ood, thr)
    site_probs = picked["site_probs"]
    return {"available": True, "max_prob": max(site_probs.values()) if site_probs else None,
            "threshold": resp["thresholds"].get("screening", 0.5), **picked,
            "ood_sites": sorted({i.site for i in imgs if str(i.id) in ood}),
            "model_version": resp["model_version"], "head_version": resp["head_version"],
            "active_version": resp["active_version"], "contract_sha256": resp["contract_sha256"],
            "placeholder": resp.get("placeholder", False)}


def stored_ai(s, scr: Screening) -> dict:
    """Re-use the latest stored AI results (for re-evaluation without re-running inference)."""
    rows = s.execute(select(ImageResult).join(ScreeningImage, ScreeningImage.id == ImageResult.image_id)
                     .where(ScreeningImage.screening_id == scr.id).order_by(ImageResult.created_at.desc())
                     ).scalars().all()
    if not rows:
        return {"available": False}
    latest_version = (rows[0].model_version, rows[0].head_version)
    probs, ood = {}, set()
    for r in rows:
        if (r.model_version, r.head_version) != latest_version or str(r.image_id) in probs:
            continue
        probs[str(r.image_id)] = r.prob
        if r.out_of_distribution:
            ood.add(str(r.image_id))
    prev = s.get(Decision, scr.decision_id) if scr.decision_id else None
    thr = (prev.inputs.get("lesion_threshold") if prev else None) or 0.5
    imgs = s.execute(select(ScreeningImage).where(ScreeningImage.screening_id == scr.id,
                                                  ScreeningImage.site != MEASUREMENT_SITE)
                     .order_by(ScreeningImage.created_at.desc())).scalars().all()
    bad = {str(i.id) for i in imgs if not (i.quality or {}).get("server", {}).get("ok", True)}
    rules = active_rule_set_sync(s).definition
    picked = pick_sites([(i.site, str(i.id)) for i in imgs], probs, bad, ood, rules["lesion"].get("threshold") or thr)
    site_probs = picked["site_probs"]
    return {"available": True, "max_prob": max(site_probs.values()) if site_probs else None, "threshold": thr,
            **picked, "ood_sites": sorted({i.site for i in imgs if str(i.id) in ood}),
            "model_version": latest_version[0],
            "head_version": latest_version[1], "contract_sha256": prev.contract_sha256 if prev else None}


# ───────────────────────── actions ─────────────────────────
def nearest_referral_facility(s, from_facility_id):
    row = s.execute(text("""
        SELECT f.id FROM facilities f, facilities src
        WHERE f.accepts_referrals AND src.id = :src
        ORDER BY f.geom <-> src.geom LIMIT 1"""), {"src": str(from_facility_id)}).first()
    if row:
        return row[0]
    row = s.execute(text("SELECT id FROM facilities WHERE accepts_referrals LIMIT 1")).first()
    return row[0] if row else from_facility_id


def _open_task(s, scr, kind) -> ReviewTask | None:
    return s.execute(select(ReviewTask).where(ReviewTask.screening_id == scr.id, ReviewTask.kind == kind,
                                              ReviewTask.status == "open")).scalars().first()


def ensure_review_task(s, scr: Screening, patient: Patient, kind: str, facility_id=None) -> ReviewTask:
    t = _open_task(s, scr, kind)
    if t:
        return t
    fac = facility_id or nearest_referral_facility(s, patient.facility_id)
    t = ReviewTask(screening_id=scr.id, patient_id=patient.id, facility_id=fac, kind=kind,
                   priority=TASK_PRIORITY[kind])
    s.add(t)
    s.flush()
    return t


def ensure_referral(s, scr: Screening, patient: Patient, reasons: list[dict], due_days: int) -> tuple[Referral, bool]:
    existing = s.execute(select(Referral).where(Referral.patient_id == patient.id,
                                                Referral.status.in_(["pending", "booked", "visited"]))
                         ).scalars().first()
    if existing:
        return existing, False
    fac = nearest_referral_facility(s, patient.facility_id)
    ref = Referral(screening_id=scr.id, patient_id=patient.id, facility_id=fac, from_facility_id=patient.facility_id,
                   priority="high", reason="; ".join(r["text"] for r in reasons if r["level"] == "HIGH")[:1000]
                   or "High-risk screening", due_by=date.today() + timedelta(days=due_days), token_jti="pending")
    s.add(ref)
    s.flush()
    _, jti = issue_token("referral", str(ref.id), ttl_seconds=60 * 60 * 24 * 120)
    ref.token_jti = jti
    s.add(TimelineEvent(patient_id=patient.id, occurred_at=datetime.now(timezone.utc), kind="referral",
                        source="system", summary=f"Referred for specialist review (due {ref.due_by})",
                        data={"referral_id": str(ref.id), "screening_id": str(scr.id)}))
    return ref, True


def refer_and_notify(s, scr: Screening, patient: Patient, reasons: list[dict], due_days: int) -> Referral:
    """Create (or reuse) the open referral, text the patient once, push the FHIR ServiceRequest."""
    from ..models import Facility

    ref, created = ensure_referral(s, scr, patient, reasons, due_days)
    if created and patient.phone:
        fac = s.get(Facility, ref.facility_id)
        queue_sms(s, patient.phone, "referral_patient", patient.language, patient_id=patient.id,
                  related={"referral_id": str(ref.id)}, facility=fac.name if fac else "the clinic",
                  due=ref.due_by.strftime("%d %b"))
    emit_sync(s, "fhir.push", {"kind": "ServiceRequest", "id": str(ref.id)}, dedupe_key=f"fhir:sr:{ref.id}")
    return ref


def referral_after_review(s, screening_id, verdict: str, review_id: str | None = None) -> dict:
    """A specialist confirmed a case that had no referral yet (e.g. an AI-only flag sent to review by R1b,
    a CANNOT_ASSESS case or a LOW audit sample). Runs in the worker with system privileges. Idempotent."""
    scr = s.get(Screening, screening_id)
    if scr is None:
        return {"status": "missing"}
    patient = s.get(Patient, scr.patient_id)
    rules = active_rule_set_sync(s).definition
    text = {"confirm_refer": "Specialist confirmed a suspicious finding",
            "needs_biopsy": "Specialist requested a biopsy"}.get(verdict, "Specialist review")
    ref = refer_and_notify(s, scr, patient, [{"level": "HIGH", "text": text}], rules.get("referral_due_days", 14))
    audit.record_sync(s, "system", "system", "referral.after_review", "referral", ref.id, patient.id,
                      {"screening_id": str(scr.id), "verdict": verdict, "review_id": review_id})
    return {"status": "ok", "referral_id": str(ref.id)}


def apply_actions(s, scr: Screening, patient: Patient, out: dict) -> dict:
    cfg = get_settings()
    done = {}
    level = out["risk_level"]
    actions = set(out["actions"])

    if "create_referral" in actions:
        ref = refer_and_notify(s, scr, patient, out["reasons"], out["referral_due_days"])
        done["referral_id"] = str(ref.id)
    if "specialist_review" in actions and not (level == "CANNOT_ASSESS" and out.get("retake")):
        kind = "cannot_assess" if level == "CANNOT_ASSESS" else "referral_review"
        if any(r["rule"] in ("R4", "R5") for r in out["reasons"]):
            kind = "escalation"
        done["review_task_id"] = str(ensure_review_task(s, scr, patient, kind).id)
    if "schedule_checkin" in actions:
        exists = s.execute(select(CheckIn).where(CheckIn.screening_id == scr.id)).scalars().first()
        if not exists and patient.phone:
            s.add(CheckIn(patient_id=patient.id, screening_id=scr.id, channel="sms",
                          scheduled_for=datetime.now(timezone.utc) + timedelta(days=cfg.checkin_after_days)))
    if "schedule_followup" in actions:
        due = date.today() + timedelta(days=int(out["followup_days"]))
        fu = s.execute(select(FollowUp).where(FollowUp.screening_id == scr.id)).scalars().first()
        if fu is None:
            s.add(FollowUp(patient_id=patient.id, screening_id=scr.id, due_on=due, reason=f"{level} re-check"))
        elif fu.status == "scheduled":
            fu.due_on, fu.reason = min(fu.due_on, due), f"{level} re-check"
    # random audit sample of LOW results (deterministic per screening, so retries don't re-roll)
    if level == "LOW":
        bucket = int(hashlib.sha256(str(scr.id).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        if bucket < cfg.audit_sample_rate:
            done["audit_sample_task_id"] = str(ensure_review_task(s, scr, patient, "audit_sample").id)
    if level == "NEEDS_REVIEW" and not out.get("retake"):    # while a retake is pending the specialist waits
        done["review_task_id"] = str(ensure_review_task(s, scr, patient, "needs_review").id)
    return done


# ───────────────────────── retake (AI-only flag) ─────────────────────────
def retake_offer(s, scr: Screening, out: dict, facts: dict) -> dict | None:
    """An AI-only flag (R1b, no other warning signs) first asks the ASHA to retake the flagged photo(s) — once per
    site, within a time window. A clean retake clears the flag; a flagged or unusable one goes to the specialist."""
    cfg = get_settings()
    rules = {r["rule"] for r in out["reasons"]}
    if not cfg.retake_before_review or out["risk_level"] not in ("NEEDS_REVIEW", "CANNOT_ASSESS"):
        return None
    wanted: list[str] = []
    if "R1b" in rules:                                  # AI-only flag on a clear photo
        wanted += facts.get("suspicious_sites") or []
    if "R1c" in rules:                                  # high score on an unclear photo
        wanted += facts.get("unreliable_site_list") or []
    if "R6" in rules:                                   # photos missing / unreadable
        wanted += (facts.get("ai") or {}).get("unusable_sites") or []
    imgs = s.execute(select(ScreeningImage).where(ScreeningImage.screening_id == scr.id)).scalars().all()
    retaken = {i.site for i in imgs if (i.quality or {}).get("retake")}
    sites = [x for x in dict.fromkeys(wanted) if x not in retaken and x != MEASUREMENT_SITE]
    if not sites:
        return None
    first = s.execute(text("SELECT min(created_at) FROM decisions WHERE screening_id = :sid AND outputs ? 'retake'"),
                      {"sid": str(scr.id)}).scalar()
    now = datetime.now(timezone.utc)
    deadline = (first or now) + timedelta(hours=cfg.retake_timeout_hours)
    if now >= deadline:
        return None                       # window passed: specialist review instead
    return {"sites": sites, "requested_at": (first or now).isoformat(), "deadline": deadline.isoformat()}


def retake_timeout(s, screening_id) -> dict:
    """No retake arrived in time: re-decide with the stored AI results; the offer has expired, so the case is
    queued for the specialist (NEEDS_REVIEW) as without the retake step."""
    scr = s.get(Screening, screening_id)
    if scr is None or scr.status != "retake_requested":
        return {"status": "not_waiting"}
    return process_screening(s, screening_id, trigger="retake_timeout", run_inference=False)


# ───────────────────────── main entry ─────────────────────────
def process_screening(s, screening_id, trigger: str = "ai_result", run_inference: bool = True,
                      attempt: int = 0) -> dict:
    scr = s.execute(select(Screening).where(Screening.id == screening_id).with_for_update()).scalars().first()
    if scr is None:
        return {"status": "missing"}
    patient = s.get(Patient, scr.patient_id)
    rs = active_rule_set_sync(s)
    rules = rs.definition

    # habits + mouth opening are recomputed with the ACTIVE rule set (version recorded in the decision)
    score, level_h, factors = score_habits(scr.habits or {}, scr.symptoms or {}, rules["habit_scoring"])
    scr.habit_score, scr.habit_level = score, level_h
    mm, mm_detail = compute_opening(scr.mouth_opening or {}, rules["mouth_opening"])
    scr.mouth_opening_mm = mm
    scr.mouth_opening = {**(scr.mouth_opening or {}), "computed": mm_detail}

    ai: dict
    if run_inference:
        try:
            ai = run_ai(s, scr, rules)
            scr.ai_status = "done" if ai.get("available") else "unavailable"
        except Exception as e:  # noqa: BLE001 — inference down: fail safe, retry later
            log.warning("inference_unavailable", screening=str(scr.id), attempt=attempt, error=str(e))
            ai = {"available": False, "reason": str(e)[:200]}
            scr.ai_status = "unavailable"
            if attempt + 1 < MAX_AI_ATTEMPTS:
                emit_sync(s, "screening.process",
                          {"screening_id": str(scr.id), "trigger": "ai_retry", "attempt": attempt + 1},
                          dedupe_key=f"retry:{scr.id}:{attempt + 1}", delay_s=backoff_delay(attempt + 3, cap=1800))
    else:
        ai = stored_ai(s, scr)

    tl = timeline_facts(s, patient.id, scr)
    facts = build_facts(rule_set=rules, habit_level=level_h, habit_factors=factors, symptoms=scr.symptoms or {},
                        opening_mm=mm, ai=ai, timeline=tl)
    out = evaluate(rules, facts)

    # never let automation downgrade a case that already has an open referral
    open_ref = s.execute(select(Referral).where(Referral.patient_id == patient.id,
                                                Referral.status.in_(["pending", "booked", "visited"]))
                         ).scalars().first()
    if open_ref and SEVERITY[out["risk_level"]] < SEVERITY["HIGH"]:
        out["reasons"].insert(0, {"rule": "SAFETY", "level": "HIGH",
                                  "text": "An open referral is pending — only a specialist can lower this risk"})
        out["risk_level"], out["actions"] = "HIGH", rules["actions"]["HIGH"]

    retake = retake_offer(s, scr, out, {**facts, "ai": ai}) if ai.get("available") else None
    if retake:
        out["retake"] = retake
        out["reasons"].insert(0, {"rule": "RETAKE", "level": "NEEDS_REVIEW",
                                  "text": "Please retake the photo of " + ", ".join(x.replace("_", " ")
                                                                                     for x in retake["sites"])
                                          + " — closer, in focus, without glare"})

    dec = Decision(screening_id=scr.id, rule_set_version=rs.version, rule_set_sha256=rs.sha256,
                   model_version=ai.get("model_version"), head_version=ai.get("head_version"),
                   contract_sha256=ai.get("contract_sha256"),
                   inputs={**facts, "ai": {k: v for k, v in ai.items() if k != "reason"},
                           "timeline": tl, "habit_score": score, "mouth_opening_detail": mm_detail},
                   outputs=out, risk_level=out["risk_level"], trigger=trigger)
    s.add(dec)
    s.flush()
    prev_level = scr.risk_level
    scr.decision_id, scr.risk_level = dec.id, out["risk_level"]
    scr.lesion_score = ai.get("max_prob")
    scr.cannot_assess = out["risk_level"] == "CANNOT_ASSESS"
    scr.status = ("retake_requested" if retake else "completed") if ai.get("available") else "processing"
    done = apply_actions(s, scr, patient, out)
    if retake:
        delay = (datetime.fromisoformat(retake["deadline"]) - datetime.now(timezone.utc)).total_seconds()
        emit_sync(s, "screening.retake_timeout", {"screening_id": str(scr.id)},
                  dedupe_key=f"retake-timeout:{scr.id}", delay_s=max(delay, 0) + 5)
    DECISIONS.labels(out["risk_level"], trigger).inc()

    if trigger == "initial" or prev_level != out["risk_level"]:
        if scr.worker_id:
            notify_staff(s, scr.worker_id, "staff_review_done", related={"screening_id": str(scr.id)},
                         patient=patient.display_id, verdict=f"screening result {out['risk_level']}",
                         action=out["reasons"][0]["text"])
    audit.record_sync(s, "system", "system", "decision.made", "screening", scr.id, patient.id,
                      {"risk_level": out["risk_level"], "previous": prev_level, "trigger": trigger,
                       "rule_set_version": rs.version, "model_version": ai.get("active_version"),
                       "decision_id": str(dec.id), **done})
    emit_sync(s, "fhir.push", {"kind": "DiagnosticReport", "id": str(scr.id)}, dedupe_key=f"fhir:dr:{dec.id}")
    log.info("screening_decided", screening=str(scr.id), risk=out["risk_level"], trigger=trigger,
             ai=ai.get("available"))
    return {"status": "ok", "risk_level": out["risk_level"], "decision_id": str(dec.id), **done}
