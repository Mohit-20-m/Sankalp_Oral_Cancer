"""Celery application: reliable settings + beat schedule (times in Asia/Kolkata)."""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from ..config import get_settings

s = get_settings()
celery_app = Celery("oralscreen", broker=s.redis_url, include=["app.worker.tasks"])
celery_app.conf.update(
    task_acks_late=True,                 # a task is acknowledged only after it finishes
    task_reject_on_worker_lost=True,     # if a worker dies mid-task, another worker re-runs it
    worker_prefetch_multiplier=1,
    task_ignore_result=True,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 3600},
    task_default_queue="oralscreen",
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_time_limit=900,
    task_soft_time_limit=840,
    beat_schedule={
        "dispatch-checkins": {"task": "os.dispatch_checkins", "schedule": 600.0},
        "ops-metrics": {"task": "os.ops_metrics", "schedule": 60.0},
        "auto-rollback-check": {"task": "os.auto_rollback_check", "schedule": 3600.0},
        "followup-reminders": {"task": "os.followup_reminders", "schedule": crontab(hour=8, minute=5)},
        "referral-overdue": {"task": "os.referral_overdue", "schedule": crontab(hour=8, minute=20)},
        "drift-report": {"task": "os.drift_report", "schedule": crontab(hour=1, minute=10)},
        "fairness-report": {"task": "os.fairness_report", "schedule": crontab(hour=2, minute=10, day_of_week=1)},
        "audit-snapshot": {"task": "os.audit_snapshot", "schedule": crontab(hour=0, minute=15)},
        "retrain-if-enough-labels": {"task": "os.retrain_if_enough_labels", "schedule": crontab(hour=3, minute=5)},
    },
)


from celery.signals import worker_init  # noqa: E402


@worker_init.connect
def _load_secrets_on_start(**_):
    """Workers sign referral tokens and send SMS, so they need the same Vault secrets as the API."""
    from ..observability import setup_logging, setup_tracing
    from ..secrets import load_secrets

    setup_logging("oralscreen-worker")
    load_secrets()
    setup_tracing("oralscreen-worker", celery=True)
