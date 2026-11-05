"""Structured logging, OpenTelemetry tracing/metrics/logs, Prometheus metrics and Sentry."""
from __future__ import annotations

import logging
import sys

import structlog
from prometheus_client import Counter, Gauge, Histogram

from .config import get_settings

# ── business / reliability metrics (scraped at /metrics, forwarded to Grafana) ──
SCREENINGS = Counter("os_screenings_total", "Screenings received", ["risk_level"])
DECISIONS = Counter("os_decisions_total", "Risk decisions made", ["risk_level", "trigger"])
INFERENCE_LATENCY = Histogram("os_inference_seconds", "Inference call latency", buckets=(.05, .1, .25, .5, 1, 2, 5, 10))
INFERENCE_FAILURES = Counter("os_inference_failures_total", "Inference calls that failed")
OUTBOX_LAG = Gauge("os_outbox_pending", "Unpublished outbox events")
DEAD_LETTERS = Gauge("os_dead_letters_open", "Unresolved dead letters")
MESSAGES = Counter("os_messages_total", "Outgoing messages", ["channel", "status"])
REVIEWS = Counter("os_reviews_total", "Specialist reviews", ["verdict", "ai_agreed"])
AUTHZ_DENIED = Counter("os_authz_denied_total", "Requests denied by policy", ["action"])
CIRCUIT_OPEN = Gauge("os_circuit_open", "1 when a circuit breaker is open", ["name"])


def setup_logging(service: str) -> None:
    s = get_settings()
    logging.basicConfig(stream=sys.stdout, level=s.log_level, format="%(message)s")
    structlog.configure(
        processors=[structlog.contextvars.merge_contextvars, structlog.processors.add_log_level,
                    structlog.processors.TimeStamper(fmt="iso", utc=True),
                    structlog.processors.dict_tracebacks, structlog.processors.JSONRenderer()],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(s.log_level)),
        logger_factory=structlog.PrintLoggerFactory(), cache_logger_on_first_use=True)
    structlog.contextvars.bind_contextvars(service=service)
    for noisy in ("botocore", "urllib3", "httpx", "onnxruntime"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


log = structlog.get_logger()


def setup_tracing(service: str, fastapi_app=None, sqlalchemy_engine=None, celery: bool = False) -> None:
    """OTLP/HTTP export to the LGTM container. Silently degrades if the collector is not running."""
    s = get_settings()
    if s.sentry_dsn:
        try:
            import sentry_sdk

            sentry_sdk.init(dsn=s.sentry_dsn, environment=s.env, traces_sample_rate=0.1, send_default_pii=False)
        except Exception as e:  # noqa: BLE001
            log.warning("sentry_init_failed", error=str(e))
    if not s.otel_enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": service, "deployment.environment": s.env}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{s.otel_endpoint}/v1/traces",
                                                                        timeout=2)))
        trace.set_tracer_provider(provider)
        if fastapi_app is not None:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(fastapi_app, excluded_urls="health,ready,metrics")
        if sqlalchemy_engine is not None:
            from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

            SQLAlchemyInstrumentor().instrument(engine=sqlalchemy_engine)
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        if celery:
            from opentelemetry.instrumentation.celery import CeleryInstrumentor

            CeleryInstrumentor().instrument()
    except Exception as e:  # noqa: BLE001
        log.warning("otel_init_failed", error=str(e))
