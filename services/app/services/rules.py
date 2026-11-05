"""Access to the active rule set (cached briefly; changes go through maker-checker)."""
from __future__ import annotations

import copy
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from ..domain.decision import DEFAULT_RULE_SET, rule_set_sha
from ..models import RuleSet


@dataclass(frozen=True)
class ActiveRules:
    version: int
    sha256: str
    definition: dict


_cache: dict = {"at": 0.0, "rs": None}


def _snapshot(rs: RuleSet) -> ActiveRules:
    return ActiveRules(rs.version, rs.sha256, copy.deepcopy(rs.definition))


def _default() -> RuleSet:
    return RuleSet(version=1, status="active", definition=DEFAULT_RULE_SET, sha256=rule_set_sha(DEFAULT_RULE_SET),
                   rationale="Default rule set (bootstrap)", activated_at=datetime.now(timezone.utc))


def active_rule_set_sync(session) -> ActiveRules:
    if _cache["rs"] is not None and time.time() - _cache["at"] < 30:
        return _cache["rs"]
    rs = session.execute(select(RuleSet).where(RuleSet.status == "active")
                         .order_by(RuleSet.version.desc())).scalars().first()
    if rs is None:
        rs = _default()
        session.add(rs)
        session.flush()
    snap = _snapshot(rs)
    _cache.update(at=time.time(), rs=snap)
    return snap


async def active_rule_set(session) -> ActiveRules:
    rs = (await session.execute(select(RuleSet).where(RuleSet.status == "active")
                                .order_by(RuleSet.version.desc()))).scalars().first()
    if rs is None:
        rs = _default()
        session.add(rs)
        await session.flush()
    return _snapshot(rs)


def invalidate() -> None:
    _cache.update(at=0.0, rs=None)
