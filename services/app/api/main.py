"""OralScreen API — FastAPI application factory."""
from __future__ import annotations

import time
import uuid

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from ..config import get_settings
from ..observability import log, setup_logging, setup_tracing
from ..secrets import load_secrets
from .routers import clinical, oversight, patients, screenings, system, web

DESCRIPTION = """
**Sankalp** - AI-assisted oral pre-cancer screening and care-continuity platform.

*Screening aid only — not a diagnosis. A specialist confirms every high-risk result.*

Security: Keycloak OIDC tokens · OPA policies (what a role may do) · PostgreSQL row-level security (which rows) ·
hash-chained audit log · DPDP-aligned consent.
"""

tags = [{"name": t} for t in ("system", "patients & care continuity", "screening",
                              "referrals, specialist review & follow-up", "analytics, models & governance", "audit",
                              "admin", "FHIR R4", "webhooks", "web app")]


def create_app() -> FastAPI:
    cfg = get_settings()
    setup_logging("oralscreen-api")
    app = FastAPI(title="Sankalp API", version="2.0.0", description=DESCRIPTION, openapi_tags=tags,
                  docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=cfg.cors_origins, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["X-Request-ID"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = rid
        structlog.contextvars.bind_contextvars(request_id=rid)
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as e:  # noqa: BLE001 — never leak stack traces to clients
            log.exception("unhandled_error", path=request.url.path, error=str(e))
            response = JSONResponse({"detail": "internal error", "request_id": rid}, status_code=500)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if request.url.path not in ("/api/health", "/api/ready", "/metrics"):
            log.info("request", method=request.method, path=request.url.path, status=response.status_code,
                     ms=round((time.perf_counter() - t0) * 1000, 1))
        structlog.contextvars.unbind_contextvars("request_id")
        return response

    app.include_router(system.health_router, prefix="/api")          # /api/health, /api/ready (probes)
    for r in (system.health_router, system.router, patients.router, screenings.router, clinical.router, oversight.router,
              system.fhir_router, web.router):
        app.include_router(r, prefix="/api/v1")
    Instrumentator(excluded_handlers=["/api/health", "/api/ready", "/metrics"]).instrument(app).expose(
        app, include_in_schema=False)

    @app.on_event("startup")
    async def _startup():
        status = load_secrets()
        log.info("api_started", env=cfg.env, auth_mode=cfg.auth_mode, messaging=cfg.messaging_mode,
                 secrets=status["source"])
        from ..db import async_engine

        setup_tracing("oralscreen-api", fastapi_app=app, sqlalchemy_engine=async_engine().sync_engine)

    @app.on_event("shutdown")
    async def _shutdown():
        from ..db import dispose

        await dispose()

    return app


app = create_app()
