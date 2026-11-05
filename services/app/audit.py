"""Tamper-evident audit trail.

Writes go through the SQL function audit_append() (the app role has no INSERT/UPDATE/DELETE on the
table). Each row stores sha256(prev_hash | ts | actor | role | action | entity | id | patient | details),
so editing or deleting any row breaks the chain from that point — verify_chain() reports where.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import text

_APPEND = text("SELECT audit_append(:actor_id, :role, :action, :etype, :eid, :pid, CAST(:details AS jsonb), :rid, :ip)")


def _params(actor_id, role, action, entity_type, entity_id, patient_id, details, request_id, ip):
    return {"actor_id": str(actor_id), "role": role, "action": action, "etype": entity_type,
            "eid": str(entity_id) if entity_id is not None else None,
            "pid": str(patient_id) if patient_id is not None else None,
            "details": json.dumps(details or {}, default=str), "rid": request_id, "ip": ip}


async def record(session, actor_id: Any, role: str, action: str, entity_type: str, entity_id: Any = None,
                 patient_id: Any = None, details: dict | None = None, request_id: str | None = None,
                 ip: str | None = None) -> int:
    res = await session.execute(_APPEND, _params(actor_id, role, action, entity_type, entity_id, patient_id,
                                                 details, request_id, ip))
    return res.scalar_one()


def record_sync(session, actor_id: Any, role: str, action: str, entity_type: str, entity_id: Any = None,
                patient_id: Any = None, details: dict | None = None, request_id: str | None = None) -> int:
    res = session.execute(_APPEND, _params(actor_id, role, action, entity_type, entity_id, patient_id, details,
                                           request_id, None))
    return res.scalar_one()


_VERIFY_SQL = text("""
    SELECT id, prev_hash, hash,
           audit_hash_input(prev_hash, ts, actor_id, actor_role, action, entity_type, entity_id, patient_id, details)
             AS hash_input
    FROM audit_log WHERE id > :after ORDER BY id LIMIT :lim
""")


def _check_rows(rows, expected_prev: str, problems: list, last_id: int) -> tuple[str, int, int]:
    n = 0
    for r in rows:
        n += 1
        # id gaps are normal (a rolled-back request still uses up a sequence number); a really deleted row is
        # caught by the prev_hash check below, because the chain links each row to the previous row's hash
        if r.prev_hash != expected_prev:
            problems.append({"id": r.id, "problem": "prev_hash does not match previous row (row removed or edited)"})
        recomputed = hashlib.sha256(r.hash_input.encode()).hexdigest()
        if recomputed != r.hash:
            problems.append({"id": r.id, "problem": "row contents changed after it was written"})
        expected_prev, last_id = r.hash, r.id
    return expected_prev, last_id, n


async def verify_chain(session, batch: int = 5000) -> dict:
    """Recompute every hash in Python and compare. Returns {ok, checked, problems[], head_hash}."""
    problems: list[dict] = []
    prev, last_id, total = "0" * 64, 0, 0
    while True:
        rows = (await session.execute(_VERIFY_SQL, {"after": last_id, "lim": batch})).all()
        if not rows:
            break
        prev, last_id, n = _check_rows(rows, prev, problems, last_id)
        total += n
        if len(problems) > 100:
            break
    return {"ok": not problems, "checked": total, "head_id": last_id, "head_hash": prev, "problems": problems[:100]}


def verify_chain_sync(session, batch: int = 5000) -> dict:
    problems: list[dict] = []
    prev, last_id, total = "0" * 64, 0, 0
    while True:
        rows = session.execute(_VERIFY_SQL, {"after": last_id, "lim": batch}).all()
        if not rows:
            break
        prev, last_id, n = _check_rows(rows, prev, problems, last_id)
        total += n
    return {"ok": not problems, "checked": total, "head_id": last_id, "head_hash": prev, "problems": problems[:100]}
