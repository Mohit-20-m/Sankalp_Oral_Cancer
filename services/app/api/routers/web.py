"""Backend-for-frontend endpoints for the web app (/api/v1/web/...).

They return exactly the shapes the React screens use, computed in SQL (one round trip instead of many), and
add the phone → desktop photo hand-off. Every endpoint goes through the same OPA permission check and the same
PostgreSQL row-level security as the rest of the API.
"""
from __future__ import annotations

import base64
import json
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from ... import storage
from ...config import get_settings
from ...db import request_session
from ...resilience import all_breakers
from ..deps import Ctx, ctx, log_patient_access, presign_or_none

router = APIRouter(prefix="/web", tags=["web app"])

FRONT_STATUS = {"pending": "issued", "booked": "booked", "visited": "visited", "completed": "completed",
                "cancelled": "completed"}


def _age(birth_year):
    return (date.today().year - birth_year) if birth_year else None


def _ref_status(status: str | None, due_by) -> str | None:
    if status is None:
        return None
    if status in ("pending", "booked") and due_by and due_by < date.today():
        return "overdue"
    return FRONT_STATUS.get(status, status)


def ref_code(rid) -> str:
    return "RF-" + str(rid).replace("-", "")[:8].upper()


# ───────────────────────── patients ─────────────────────────
_PATIENT_SQL = """
SELECT p.id, p.display_id, p.full_name, p.sex, p.birth_year, p.phone, p.language, p.created_at,
       v.name AS village, v.taluk, ls.id AS sid, ls.captured_at, ls.risk_level,
       rf.status AS ref_status, rf.due_by, rf.facility AS ref_facility,
       EXISTS (SELECT 1 FROM reviews rv WHERE rv.screening_id = ls.id) AS reviewed
FROM patients p
LEFT JOIN villages v ON v.id = p.village_id
LEFT JOIN LATERAL (SELECT id, captured_at, risk_level FROM screenings s WHERE s.patient_id = p.id
                   ORDER BY captured_at DESC LIMIT 1) ls ON true
LEFT JOIN LATERAL (SELECT r.status, r.due_by, f.name AS facility FROM referrals r
                   LEFT JOIN facilities f ON f.id = r.facility_id WHERE r.patient_id = p.id
                   ORDER BY r.created_at DESC LIMIT 1) rf ON true
WHERE p.deleted_at IS NULL {where}
ORDER BY coalesce(ls.captured_at, p.created_at) DESC
LIMIT :lim
"""


def _patient(r) -> dict:
    return {"id": str(r.id), "displayId": r.display_id, "name": r.full_name, "age": _age(r.birth_year),
            "sex": r.sex, "phone": r.phone or "", "village": r.village or "—", "taluk": r.taluk or "—",
            "preferredLanguage": r.language, "registeredAt": r.created_at,
            "lastScreeningAt": r.captured_at, "lastRisk": r.risk_level, "reviewed": bool(r.reviewed),
            "referralStatus": _ref_status(r.ref_status, r.due_by), "referralFacility": r.ref_facility}


@router.get("/patients")
async def patients(q: str | None = None, limit: int = 60, c: Ctx = Depends(ctx)):
    await c.can("patient:read")
    where, params = "", {"lim": min(limit, 200)}
    if q and q.strip():
        where = ("AND (p.full_name ILIKE :q OR p.display_id ILIKE :q OR p.phone ILIKE :q OR v.name ILIKE :q "
                 "OR CAST(p.id AS text) = :exact)")
        params.update(q=f"%{q.strip()}%", exact=q.strip())
    async with c.session() as s:
        rows = (await s.execute(text(_PATIENT_SQL.format(where=where)), params)).all()
        return [_patient(r) for r in rows]


@router.get("/patients/{pid}")
async def patient(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("patient:read", {"patient_id": pid})
    async with c.session() as s:
        rows = (await s.execute(text(_PATIENT_SQL.format(where="AND p.id = :pid")), {"pid": pid, "lim": 1})).all()
        if not rows:
            raise HTTPException(404, "patient not found (or not visible to you)")
        await log_patient_access(s, c, pid, "patient")
        return _patient(rows[0])


@router.get("/patients/{pid}/history")
async def history(pid: uuid.UUID, c: Ctx = Depends(ctx)):
    await c.can("screening:read", {"patient_id": pid})
    async with c.session() as s:
        rows = (await s.execute(text("""
            SELECT s.id, s.captured_at, s.risk_level, s.mouth_opening_mm, s.lesion_score,
                   rv.verdict, rv.notes AS review_notes, rv.diagnosis_text, rv.created_at AS reviewed_at,
                   st.full_name AS reviewer
            FROM screenings s
            LEFT JOIN LATERAL (SELECT verdict, specialist_id, notes, diagnosis_text, created_at FROM reviews r WHERE r.screening_id = s.id
                               ORDER BY created_at DESC LIMIT 1) rv ON true
            LEFT JOIN staff st ON st.id = rv.specialist_id
            WHERE s.patient_id = :pid ORDER BY s.captured_at DESC"""), {"pid": pid})).all()
        out = []
        for r in rows:
            bits = []
            if r.lesion_score is not None:
                bits.append(f"highest photo score {r.lesion_score:.2f}")
            if r.mouth_opening_mm is not None:
                bits.append(f"mouth opening {r.mouth_opening_mm:.0f} mm")
            if r.verdict:
                bits.append("specialist: " + r.verdict.replace("_", " "))
            out.append({"id": str(r.id), "patientId": str(pid), "date": r.captured_at,
                        "risk": r.risk_level or "NEEDS_REVIEW", "reviewed": r.verdict is not None,
                        "reviewer": r.reviewer, "summary": "; ".join(bits) or "Screening recorded",
                        "reviewVerdict": r.verdict, "reviewNote": r.review_notes or r.diagnosis_text,
                        "reviewedAt": r.reviewed_at})
        return out


# ───────────────────────── referrals ─────────────────────────
_REF_SQL = """
SELECT r.id, r.status, r.due_by, r.booked_for, r.created_at, r.patient_id, p.full_name, f.name AS facility, s.risk_level,
       EXISTS (SELECT 1 FROM messages m WHERE m.template = 'referral_patient'
               AND m.related->>'referral_id' = CAST(r.id AS text)) AS sms
FROM referrals r JOIN patients p ON p.id = r.patient_id JOIN facilities f ON f.id = r.facility_id
LEFT JOIN screenings s ON s.id = r.screening_id
WHERE true {where} ORDER BY r.created_at DESC LIMIT 200
"""


def _ref(r) -> dict:
    return {"id": str(r.id), "code": ref_code(r.id), "patientId": str(r.patient_id), "patientName": r.full_name,
            "facility": r.facility, "visitBy": r.due_by, "status": _ref_status(r.status, r.due_by),
            "issuedAt": r.created_at, "risk": r.risk_level or "HIGH", "smsSent": bool(r.sms),
            "bookedFor": r.booked_for, "apiStatus": r.status}


@router.get("/referrals")
async def referrals(c: Ctx = Depends(ctx)):
    await c.can("referral:read")
    async with c.session() as s:
        return [_ref(r) for r in (await s.execute(text(_REF_SQL.format(where="")))).all()]


@router.get("/referrals/lookup")
async def referral_lookup(code: str, c: Ctx = Depends(ctx)):
    """Accepts the short code printed on the slip (RF-XXXXXXXX), or the scanned QR text/token."""
    await c.can("referral:read")
    code = code.strip()
    async with c.session() as s:
        if "." in code:                              # a scanned QR: signed token, possibly inside a URL
            from ...security.tokens import verify_token

            claims = verify_token(code.rsplit("/", 1)[-1], "referral")
            where, params = "AND r.id = :rid", {"rid": claims["sub"]}
        else:
            hexpart = code.upper().removeprefix("RF-").replace("-", "").lower()
            if len(hexpart) < 6:
                raise HTTPException(400, "enter the full referral code, e.g. RF-1A2B3C4D")
            where, params = "AND replace(CAST(r.id AS text), '-', '') LIKE :p", {"p": f"{hexpart}%"}
        rows = (await s.execute(text(_REF_SQL.format(where=where)), params)).all()
        if not rows:
            raise HTTPException(404, "no referral with this code is visible to you")
        await log_patient_access(s, c, rows[0].patient_id, "referral_lookup")
        return _ref(rows[0])


# ───────────────────────── specialist stats ─────────────────────────
VERDICT_LABEL = {"confirm_refer": "Confirm referral", "not_suspicious": "Not suspicious",
                 "needs_biopsy": "Needs biopsy", "cannot_assess": "Cannot assess"}


@router.get("/specialist/stats")
async def specialist_stats(c: Ctx = Depends(ctx)):
    await c.can("review:queue")
    me = uuid.UUID(c.p.user_id)
    async with c.session() as s:
        rows = (await s.execute(text("""
            SELECT r.created_at, r.verdict, r.ai_agreed, t.created_at AS task_at
            FROM reviews r LEFT JOIN review_tasks t ON t.id = r.task_id
            WHERE r.specialist_id = :me ORDER BY r.created_at"""), {"me": me})).all()
    now = datetime.now(timezone.utc)
    agreed = [r.ai_agreed for r in rows if r.ai_agreed is not None]
    waits = sorted((r.created_at - r.task_at).total_seconds() / 60 for r in rows if r.task_at)
    days = [(now - timedelta(days=i)).date() for i in range(6, -1, -1)]
    by_day = [{"day": d.strftime("%a"), "reviewed": sum(1 for r in rows if r.created_at.date() == d),
               "agreed": sum(1 for r in rows if r.created_at.date() == d and r.ai_agreed)} for d in days]
    return {"reviewed": len(rows), "agreementRate": (sum(agreed) / len(agreed)) if agreed else 0,
            "medianMinutes": round(waits[len(waits) // 2], 1) if waits else 0,
            "thisWeek": sum(1 for r in rows if r.created_at >= now - timedelta(days=7)),
            "byDay": by_day,
            "byDecision": [{"name": VERDICT_LABEL.get(v, v), "value": sum(1 for r in rows if r.verdict == v)}
                           for v in VERDICT_LABEL]}


# ───────────────────────── district dashboard ─────────────────────────
@router.get("/district")
async def district(taluk: str = "all", days: int = 90, c: Ctx = Depends(ctx)):
    """Aggregates only. Any count below k (default 5) is returned as null (shown as "<5")."""
    await c.can("analytics:read")
    k = get_settings().k_anonymity_min_cell
    since = datetime.now(timezone.utc) - timedelta(days=days)
    tw = "" if taluk == "all" else "AND v.taluk = :taluk"
    params = {"since": since, "taluk": taluk}
    sup = lambda n: None if n is None or n < k else int(n)  # noqa: E731
    async with request_session(c.p.user_id, "system") as s:
        base = f"""FROM screenings sc JOIN patients p ON p.id = sc.patient_id
                   LEFT JOIN villages v ON v.id = p.village_id WHERE sc.captured_at >= :since {tw}"""
        t = (await s.execute(text(f"""SELECT count(DISTINCT sc.patient_id) AS screened,
                    count(DISTINCT sc.patient_id) FILTER (WHERE sc.risk_level = 'HIGH') AS high {base}"""),
                             params)).one()
        rbase = f"""FROM referrals r JOIN patients p ON p.id = r.patient_id
                    LEFT JOIN villages v ON v.id = p.village_id WHERE r.created_at >= :since {tw}"""
        rr = (await s.execute(text(f"""SELECT count(*) AS referred,
                    count(*) FILTER (WHERE r.status IN ('visited','completed')) AS visited,
                    count(*) FILTER (WHERE r.status = 'completed') AS completed,
                    count(*) FILTER (WHERE r.status IN ('pending','booked') AND r.due_by < current_date) AS overdue
                    {rbase}"""), params)).one()
        flagged = (await s.execute(text(f"""SELECT count(DISTINCT sc.patient_id) {base}
                    AND sc.risk_level IN ('HIGH','MEDIUM')"""), params)).scalar()
        monthly = (await s.execute(text(f"""SELECT to_char(date_trunc('month', sc.captured_at), 'Mon') AS m,
                    date_trunc('month', sc.captured_at) AS mm, count(*) AS n,
                    count(*) FILTER (WHERE sc.risk_level = 'LOW') AS low,
                    count(*) FILTER (WHERE sc.risk_level = 'MEDIUM') AS med,
                    count(*) FILTER (WHERE sc.risk_level = 'HIGH') AS high {base} GROUP BY 1, 2 ORDER BY 2"""),
                                   params)).all()
        vil = (await s.execute(text(f"""SELECT v.name, v.taluk, v.population,
                    count(DISTINCT sc.patient_id) AS screened,
                    count(DISTINCT sc.patient_id) FILTER (WHERE sc.risk_level = 'HIGH') AS high
                    FROM villages v LEFT JOIN patients p ON p.village_id = v.id
                    LEFT JOIN screenings sc ON sc.patient_id = p.id AND sc.captured_at >= :since
                    WHERE true {tw} GROUP BY v.id ORDER BY v.taluk, v.name"""), params)).all()
        taluks = [r[0] for r in (await s.execute(text("SELECT DISTINCT taluk FROM villages ORDER BY 1"))).all()]
    return {
        "totals": {"screened": sup(t.screened) or 0, "highRisk": sup(t.high) or 0, "referred": sup(rr.referred) or 0,
                   "visited": sup(rr.visited) or 0, "overdue": sup(rr.overdue) or 0},
        "volume": [{"month": m.m, "screened": m.n} for m in monthly],
        "riskTrend": [{"month": m.m, "LOW": round(100 * m.low / m.n, 1) if m.n else 0,
                       "MEDIUM": round(100 * m.med / m.n, 1) if m.n else 0,
                       "HIGH": round(100 * m.high / m.n, 1) if m.n else 0} for m in monthly],
        "funnel": [{"stage": "Screened", "value": sup(t.screened) or 0},
                   {"stage": "Flagged", "value": sup(flagged) or 0},
                   {"stage": "Referred", "value": sup(rr.referred) or 0},
                   {"stage": "Visited", "value": sup(rr.visited) or 0},
                   {"stage": "Completed", "value": sup(rr.completed) or 0}],
        "villages": [{"name": v.name, "taluk": v.taluk, "screened": sup(v.screened), "highRisk": sup(v.high),
                      "coverage": (round(v.screened / v.population, 3) if v.population and sup(v.screened) else None)}
                     for v in vil],
        "taluks": taluks,
        "privacy": f"aggregates only; counts below {k} hidden",
    }


# ───────────────────────── admin ─────────────────────────
@router.get("/admin/health")
async def health(c: Ctx = Depends(ctx)):
    await c.can("admin:ops")
    cfg = get_settings()
    checks = [("api", "API gateway", None), ("postgres", "PostgreSQL (data, RLS, audit chain)", None),
              ("opa", "OPA policy engine", f"{cfg.opa_url}/health"),
              ("inference", "AI inference (ONNX Runtime)", f"{cfg.inference_url}/ready"),
              ("keycloak", "Keycloak identity",
               f"{cfg.keycloak_internal_url}/realms/{cfg.keycloak_realm}" if cfg.auth_mode == "keycloak" else None),
              ("vault", "Vault secrets", f"{cfg.vault_addr}/v1/sys/health"),
              ("redis", "Job queue (Redis)", None), ("storage", "Object storage (photos)", None)]
    out = []
    async with httpx.AsyncClient(timeout=4) as h:
        for sid, name, url in checks:
            t0, state = time.perf_counter(), "operational"
            try:
                if sid == "postgres":
                    async with request_session(c.p.user_id, "system") as s:
                        await s.execute(text("SELECT 1"))
                elif sid == "redis":
                    import redis.asyncio as aredis

                    r = aredis.from_url(cfg.redis_url, socket_timeout=2)
                    await r.ping()
                    await r.aclose()
                elif sid == "storage":
                    storage.client().head_bucket(Bucket=cfg.bucket_images)
                elif url:
                    resp = await h.get(url)
                    state = "operational" if resp.status_code < 500 else "degraded"
                elif sid == "keycloak":
                    state = "degraded"
            except Exception:  # noqa: BLE001
                state = "down"
            out.append({"id": sid, "name": name, "state": state,
                        "latencyMs": round((time.perf_counter() - t0) * 1000), "uptime": 1.0 if state != "down" else 0,
                        "description": {"operational": "Responding normally", "degraded": "Responding slowly or partly",
                                        "down": "Not reachable — work is queued or refused safely"}[state]})
    open_circuits = [b for b in all_breakers() if b.get("state") != "closed"]
    for b in open_circuits:
        out.append({"id": f"circuit-{b.get('name')}", "name": f"Circuit breaker: {b.get('name')}",
                    "state": "degraded", "latencyMs": 0, "uptime": 0,
                    "description": f"{b.get('state')} — calls are short-circuited until it recovers"})
    return out


@router.get("/admin/audit")
async def audit(q: str | None = None, limit: int = 200, c: Ctx = Depends(ctx)):
    await c.can("audit:read")
    where, params = "", {"lim": min(limit, 1000)}
    if q and q.strip():
        where = ("WHERE (a.action ILIKE :q OR a.entity_type ILIKE :q OR coalesce(st.username, a.actor_id) ILIKE :q "
                 "OR CAST(a.id AS text) = :exact OR coalesce(a.entity_id,'') ILIKE :q)")
        params.update(q=f"%{q.strip()}%", exact=q.strip())
    async with c.session() as s:
        rows = (await s.execute(text(f"""
            SELECT a.id, a.ts, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.ip, a.hash,
                   a.prev_hash, coalesce(st.full_name, st.username, a.actor_id) AS actor
            FROM audit_log a LEFT JOIN staff st ON CAST(st.id AS text) = a.actor_id
            {where} ORDER BY a.id DESC LIMIT :lim"""), params)).all()
    return [{"id": str(r.id), "at": r.ts, "actor": r.actor, "role": r.actor_role, "action": r.action,
             "resource": f"{r.entity_type}{(' ' + r.entity_id[:8]) if r.entity_id else ''}", "ip": r.ip or "—",
             "hash": r.hash, "prevHash": r.prev_hash} for r in rows]


# ───────────────────────── provider (local doctor) summary ─────────────────────────
@router.get("/provider/summary")
async def provider_summary(c: Ctx = Depends(ctx)):
    if not c.p.is_provider:
        raise HTTPException(403, "provider token required")
    pid = uuid.UUID(c.p.patient_scope)
    await c.can("patient:read", {"patient_id": pid})
    async with c.session() as s:
        p = (await s.execute(text(_PATIENT_SQL.format(where="AND p.id = :pid")), {"pid": pid, "lim": 1})).one()
        await log_patient_access(s, c, pid, "provider_summary")
        ref = (await s.execute(text(_REF_SQL.format(where="AND r.patient_id = :pid")), {"pid": pid})).first()
        meds = (await s.execute(text("""SELECT coalesce(name_matched, name_entered) AS name, prescribed_by, started_on,
                    created_at, masks_symptoms FROM medications WHERE patient_id = :pid ORDER BY created_at DESC
                    LIMIT 20"""), {"pid": pid})).all()
        tl = (await s.execute(text("""SELECT occurred_at, kind, source, summary, created_by FROM timeline_events
                    WHERE patient_id = :pid ORDER BY occurred_at DESC LIMIT 40"""), {"pid": pid})).all()
    return {
        "patient": {"id": p.display_id, "name": p.full_name, "age": _age(p.birth_year), "sex": p.sex,
                    "village": p.village or "—"},
        "risk": p.risk_level or "NEEDS_REVIEW", "reviewed": bool(p.reviewed),
        "referral": _ref(ref) if ref else None,
        "medicines": [{"name": m.name or "—", "dose": "as prescribed" + (" · can hide symptoms" if m.masks_symptoms
                                                                          else ""),
                       "since": m.started_on or m.created_at, "addedBy": m.prescribed_by or "—"} for m in meds],
        "history": [{"date": e.occurred_at, "event": e.summary} for e in tl if e.kind != "note"],
        "notes": [{"at": e.occurred_at, "by": e.created_by or e.source, "text": e.summary} for e in tl
                  if e.kind == "note"],
        "guidance": "Pain relief from gels or painkillers can hide a worsening patch. Any patch or sore lasting "
                    "more than 2 weeks needs specialist review.",
    }


# ───────────────────────── phone → desktop photo capture ─────────────────────────
CAPTURE_TTL = 15 * 60


def _redis():
    import redis.asyncio as aredis

    return aredis.from_url(get_settings().redis_url, socket_timeout=3)


async def _session(r, sid: str) -> dict:
    raw = await r.get(f"cap:{sid}")
    if not raw:
        raise HTTPException(410, "this capture session has expired — create a new QR code")
    return json.loads(raw)


async def _push(r, sid: str, event: dict) -> int:
    n = await r.rpush(f"cap:{sid}:ev", json.dumps(event, default=str))
    await r.expire(f"cap:{sid}:ev", CAPTURE_TTL)
    return n


@router.post("/capture-sessions", status_code=201)
async def capture_create(request: Request, c: Ctx = Depends(ctx)):
    """The desktop asks for a QR code. The phone page needs no login: the QR carries a one-session secret that
    only allows uploading photos into this session for 15 minutes."""
    await c.can("image:upload")
    cfg = get_settings()
    sid, secret = uuid.uuid4().hex[:16], secrets.token_urlsafe(18)
    expires = datetime.now(timezone.utc) + timedelta(seconds=CAPTURE_TTL)
    r = _redis()
    try:
        await r.set(f"cap:{sid}", json.dumps({"secret": secret, "owner": c.p.user_id,
                                              "expires": expires.isoformat()}), ex=CAPTURE_TTL)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, "phone capture needs the queue service (Redis) — use webcam or upload") from e
    finally:
        await r.aclose()
    base = (cfg.capture_base_url or cfg.public_base_url).rstrip("/")
    return {"id": sid, "url": f"{base}/capture/{sid}?t={secret}", "expiresAt": expires}


class CaptureConnect(BaseModel):
    device: str = Field(default="phone", max_length=120)


class CapturePhoto(BaseModel):
    site: str = Field(max_length=30)
    dataUrl: str = Field(max_length=14_000_000)
    quality: dict = Field(default_factory=dict)
    capturedAt: str | None = None
    source: str = "phone"


async def _check_secret(r, sid: str, t: str) -> dict:
    sess = await _session(r, sid)
    if not secrets.compare_digest(sess["secret"], t or ""):
        raise HTTPException(403, "invalid capture link")
    return sess


@router.post("/capture-sessions/{sid}/connect")
async def capture_connect(sid: str, body: CaptureConnect, t: str = ""):
    r = _redis()
    try:
        await _check_secret(r, sid, t)
        await _push(r, sid, {"type": "connected", "device": body.device})
        return {"ok": True}
    finally:
        await r.aclose()


@router.post("/capture-sessions/{sid}/photos", status_code=201)
async def capture_photo(sid: str, body: CapturePhoto, t: str = ""):
    if not body.dataUrl.startswith("data:image/"):
        raise HTTPException(400, "expected an image data URL")
    head, b64 = body.dataUrl.split(",", 1)
    data = base64.b64decode(b64)
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "photo too large")
    r = _redis()
    try:
        await _check_secret(r, sid, t)
        n = await r.llen(f"cap:{sid}:ev")
        key = f"capture/{sid}/{n:03d}-{body.site}.jpg"
        storage.put_bytes(get_settings().bucket_images, key, data, head[5:].split(";")[0] or "image/jpeg")
        await _push(r, sid, {"type": "photo", "key": key, "site": body.site, "quality": body.quality,
                             "capturedAt": body.capturedAt or datetime.now(timezone.utc).isoformat()})
        return {"ok": True}
    finally:
        await r.aclose()


@router.get("/capture-sessions/{sid}/events")
async def capture_events(sid: str, after: int = 0, c: Ctx = Depends(ctx)):
    """The desktop polls this every ~1.5 s; photos come back as data URLs ready for the screening form."""
    await c.can("image:upload")
    r = _redis()
    try:
        sess = await _session(r, sid)
        if sess["owner"] != c.p.user_id:
            raise HTTPException(403, "not your capture session")
        raw = await r.lrange(f"cap:{sid}:ev", after, after + 20)
    finally:
        await r.aclose()
    out = []
    for i, item in enumerate(raw):
        e = json.loads(item)
        if e["type"] == "photo":
            data = storage.get_bytes(get_settings().bucket_images, e["key"])
            e = {"type": "photo", "photo": {"site": e["site"], "quality": e["quality"], "capturedAt": e["capturedAt"],
                                            "source": "phone",
                                            "dataUrl": "data:image/jpeg;base64," + base64.b64encode(data).decode()}}
        out.append({"seq": after + i + 1, "event": e})
    return {"events": out, "expiresAt": sess["expires"]}


# ───────────────────────── home dashboards ─────────────────────────
@router.get("/home")
async def home(c: Ctx = Depends(ctx)):
    """The few numbers each role's home page shows — real counts, never placeholders."""
    await c.can("staff:me")
    role, me = c.p.role, c.p.user_id
    out: dict = {"role": role}
    async with c.session() as s:
        if role in ("asha", "nurse"):
            q = lambda sql, **kw: s.execute(text(sql), {"me": me, **kw})  # noqa: E731
            out.update({
                "screenedToday": (await q("""SELECT count(*) FROM screenings WHERE CAST(worker_id AS text) = :me
                                              AND captured_at >= date_trunc('day', now())""")).scalar(),
                "screenedAvg": (await q("""SELECT round(count(*) / 30.0, 1) FROM screenings
                                            WHERE CAST(worker_id AS text) = :me AND captured_at >= now() - interval '30 days'
                                            """)).scalar(),
                "followupsDue": (await q("""SELECT count(*) FROM followups WHERE status IN ('scheduled','notified')
                                             AND due_on <= current_date + 7""")).scalar(),
                "followupsOverdue": (await q("""SELECT count(*) FROM followups WHERE status IN ('scheduled','notified')
                                                 AND due_on < current_date""")).scalar(),
                "pendingUploads": (await q("""SELECT count(*) FROM screenings WHERE CAST(worker_id AS text) = :me
                                               AND status <> 'completed'""")).scalar(),
                "activeReferrals": (await q("SELECT count(*) FROM referrals WHERE status IN ('pending','booked')")).scalar(),
                "visitedThisWeek": (await q("""SELECT count(*) FROM referrals WHERE status IN ('visited','completed')
                                                AND coalesce(visited_at, completed_at, created_at) >= now() - interval '7 days'
                                                """)).scalar(),
            })
        elif role == "specialist":
            out["facilities"] = (await s.execute(text("""SELECT count(DISTINCT sc.facility_id) FROM review_tasks t
                                 JOIN screenings sc ON sc.id = t.screening_id WHERE t.status = 'open'"""))).scalar()
    if role in ("district_officer", "clinical_lead", "admin"):
        async with request_session(me, "system") as s:
            one = lambda sql: s.execute(text(sql))  # noqa: E731
            out.update({
                "screened90d": (await one("SELECT count(DISTINCT patient_id) FROM screenings "
                                          "WHERE captured_at >= now() - interval '90 days'")).scalar(),
                "overdueReferrals": (await one("SELECT count(*) FROM referrals WHERE status IN ('pending','booked') "
                                               "AND due_by < current_date")).scalar(),
                "worstTaluk": (await one("""SELECT v.taluk FROM referrals r JOIN patients p ON p.id = r.patient_id
                                             JOIN villages v ON v.id = p.village_id WHERE r.status IN ('pending','booked')
                                             GROUP BY 1 ORDER BY count(*) DESC LIMIT 1""")).scalar(),
                "candidateModels": (await one("SELECT count(*) FROM model_versions WHERE status IN ('candidate','shadow')"
                                              )).scalar(),
                "activeModel": (await one("SELECT version FROM model_versions WHERE status = 'active' "
                                          "ORDER BY promoted_at DESC NULLS LAST LIMIT 1")).scalar(),
                "pendingRules": (await one("SELECT count(*) FROM rule_sets WHERE status = 'pending_approval'")).scalar(),
                "openIncidents": (await one("SELECT count(*) FROM incidents WHERE status = 'open'")).scalar(),
                "failedJobs": (await one("SELECT count(*) FROM dead_letters WHERE NOT resolved")).scalar(),
                "failedMessages": (await one("SELECT count(*) FROM messages WHERE status = 'failed' "
                                             "AND created_at >= now() - interval '7 days'")).scalar(),
            })
    return {k: (float(v) if hasattr(v, "is_integer") and not isinstance(v, int) else v) for k, v in out.items()}
