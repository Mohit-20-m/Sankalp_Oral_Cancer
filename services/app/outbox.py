"""Transactional outbox.

Business writes and the "work to do" event are committed in the SAME transaction. A separate relay
process publishes pending events to Celery. If Redis or the workers are down, nothing is lost:
events wait in PostgreSQL and are delivered when the queue is back.

Topics -> Celery task names are mapped in worker.relay.TOPIC_TASKS.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert

from .models import OutboxEvent


def _stmt(topic: str, payload: dict, dedupe_key: str | None, delay_s: float):
    values = {"topic": topic, "payload": payload, "dedupe_key": dedupe_key,
              "available_at": datetime.now(timezone.utc) + timedelta(seconds=delay_s)}
    stmt = insert(OutboxEvent).values(**values)
    if dedupe_key:
        stmt = stmt.on_conflict_do_nothing(index_elements=["dedupe_key"])
    return stmt


async def emit(session, topic: str, payload: dict, dedupe_key: str | None = None, delay_s: float = 0) -> None:
    await session.execute(_stmt(topic, payload, dedupe_key, delay_s))


def emit_sync(session, topic: str, payload: dict, dedupe_key: str | None = None, delay_s: float = 0) -> None:
    session.execute(_stmt(topic, payload, dedupe_key, delay_s))
