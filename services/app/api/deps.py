"""Shared API plumbing: authenticated + authorised + RLS-scoped DB session, idempotency, access logging."""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from .. import audit
from ..config import get_settings
from ..db import request_session
from ..models import AuditLog, IdempotencyKey, Incident, Staff
from ..security.auth import Principal, current_principal
from ..security.policy import authorize


@dataclass
class Ctx:
    p: Principal
    request_id: str
    ip: str | None

    async def can(self, action: str, resource: dict | None = None) -> None:
        await authorize(self.p, action, resource)

    def session(self):
        return request_session(self.p.user_id, self.p.role, self.p.facility_id, self.p.patient_scope)

    async def audit(self, s, action, entity_type, entity_id=None, patient_id=None, details=None):
        return await audit.record(s, self.p.user_id, self.p.role, action, entity_type, entity_id, patient_id,
                                  details, self.request_id, self.ip)


_seen_staff: set[str] = set()


async def _ensure_staff(p: Principal) -> None:
    if p.is_provider or p.user_id in _seen_staff:
        return
    async with request_session(p.user_id, "system") as s:
        stmt = insert(Staff).values(id=uuid.UUID(p.user_id), username=p.username, full_name=p.full_name, role=p.role,
                                    facility_id=uuid.UUID(p.facility_id) if p.facility_id else None,
                                    last_seen_at=datetime.now(timezone.utc))
        stmt = stmt.on_conflict_do_update(index_elements=["id"], set_={
            "role": p.role, "full_name": p.full_name, "last_seen_at": datetime.now(timezone.utc),
            "facility_id": uuid.UUID(p.facility_id) if p.facility_id else None})
        await s.execute(stmt)
    _seen_staff.add(p.user_id)


async def ctx(request: Request, p: Principal = Depends(current_principal)) -> Ctx:
    try:
        await _ensure_staff(p)
    except Exception:  # noqa: BLE001 — profile sync must never block a request
        pass
    return Ctx(p=p, request_id=getattr(request.state, "request_id", uuid.uuid4().hex),
               ip=request.client.host if request.client else None)


# ── idempotency (safe retries from flaky village networks) ──
def body_hash(body) -> str:
    return hashlib.sha256(json.dumps(jsonable_encoder(body), sort_keys=True, default=str).encode()).hexdigest()


async def idem_lookup(s, c: Ctx, key: str | None, method: str, path: str, body) -> dict | None:
    if not key:
        return None
    row = await s.get(IdempotencyKey, (key, c.p.user_id))
    if row is None:
        return None
    if row.request_sha256 != body_hash(body):
        raise HTTPException(409, "Idempotency-Key reused with a different request body")
    return row.response


async def idem_store(s, c: Ctx, key: str | None, method: str, path: str, body, response, status: int = 200):
    if not key:
        return
    stmt = insert(IdempotencyKey).values(key=key, actor_id=c.p.user_id, method=method, path=path,
                                         request_sha256=body_hash(body), status_code=status,
                                         response=jsonable_encoder(response))
    await s.execute(stmt.on_conflict_do_nothing())


# ── access transparency + simple anomaly detection ──
async def log_patient_access(s, c: Ctx, patient_id, what: str) -> None:
    await c.audit(s, "read.patient", what, patient_id, patient_id)
    limit = 60
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    n = (await s.execute(select(func.count(func.distinct(AuditLog.patient_id))).where(
        AuditLog.actor_id == c.p.user_id, AuditLog.action == "read.patient", AuditLog.ts >= since))).scalar()
    if n and n > limit and n % limit == 1:
        s.add(Incident(kind="access_anomaly", severity="medium", reported_by="system",
                       description=f"{c.p.username} viewed {n} different patient records in the last hour"))


def presign_or_none(bucket: str, key: str | None, ttl: int = 900) -> str | None:
    if not key:
        return None
    from .. import storage

    try:
        return storage.presign_get(bucket, key, ttl)
    except Exception:  # noqa: BLE001
        return None


def settings():
    return get_settings()
