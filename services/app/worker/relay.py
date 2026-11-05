"""Outbox relay: PostgreSQL outbox -> Celery. Run as its own process (`python -m app.worker.relay`).

* SELECT ... FOR UPDATE SKIP LOCKED  -> several relays can run safely in parallel
* publish failures are retried with exponential backoff (available_at pushed forward)
* a broker outage just lets events accumulate in PostgreSQL; they flow again when Redis is back
"""
from __future__ import annotations

import signal
import time
from datetime import datetime, timedelta, timezone

from prometheus_client import start_http_server
from sqlalchemy import select

from ..db import system_session
from ..models import OutboxEvent
from ..observability import OUTBOX_LAG, log, setup_logging
from ..resilience import backoff_delay

TOPIC_TASKS = {
    "screening.process": "os.process_screening",
    "patient.reevaluate": "os.reevaluate_patient",
    "referral.after_review": "os.referral_after_review",
    "screening.retake_timeout": "os.retake_timeout",
    "message.send": "os.send_message",
    "medication.ocr": "os.ocr_medication",
    "model.retrain": "os.retrain_head",
    "model.index": "os.index_model",
    "fhir.push": "os.fhir_push",
}
_running = True


def _stop(*_):
    global _running
    _running = False


def relay_once(celery_app, batch: int = 100) -> int:
    now = datetime.now(timezone.utc)
    sent = 0
    with system_session("outbox-relay") as s:
        rows = s.execute(select(OutboxEvent).where(OutboxEvent.published_at.is_(None),
                                                   OutboxEvent.available_at <= now)
                         .order_by(OutboxEvent.id).limit(batch).with_for_update(skip_locked=True)).scalars().all()
        for ev in rows:
            task = TOPIC_TASKS.get(ev.topic)
            if task is None:
                ev.last_error, ev.published_at = f"unknown topic {ev.topic}", now
                continue
            try:
                celery_app.send_task(task, kwargs=ev.payload, queue="oralscreen")
                ev.published_at = now
                sent += 1
            except Exception as e:  # noqa: BLE001
                ev.attempts += 1
                ev.last_error = str(e)[:500]
                ev.available_at = now + timedelta(seconds=backoff_delay(ev.attempts, base=1, cap=120))
                log.warning("outbox_publish_failed", topic=ev.topic, attempts=ev.attempts, error=str(e)[:200])
                break          # broker probably down: stop this round, keep order
    return sent


def main() -> None:
    from .celery_app import celery_app

    setup_logging("oralscreen-outbox-relay")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        start_http_server(9101)
    except OSError:
        pass
    log.info("outbox_relay_started")
    idle = 0.2
    while _running:
        try:
            n = relay_once(celery_app)
            idle = 0.2 if n else min(idle * 1.5, 2.0)
        except Exception as e:  # noqa: BLE001 — DB blip: wait and continue
            log.warning("outbox_relay_error", error=str(e)[:200])
            idle = 3.0
        time.sleep(idle)
    log.info("outbox_relay_stopped")


if __name__ == "__main__":
    main()
