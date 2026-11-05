"""Database engines and sessions.

Every API request runs in ONE transaction with the caller's identity set as
transaction-local settings (app.user_id / app.role / app.facility_id / app.patient_scope).
PostgreSQL row-level security policies read these settings, so even a buggy query
cannot return another facility's patients.  Background workers run as role 'system'.
"""
from __future__ import annotations

from contextlib import asynccontextmanager, contextmanager
from typing import AsyncIterator, Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_async_engine = None
_async_factory = None
_sync_engine = None
_sync_factory = None


def async_engine():
    global _async_engine, _async_factory
    if _async_engine is None:
        s = get_settings()
        _async_engine = create_async_engine(s.app_dsn_async, pool_size=s.db_pool_size, max_overflow=s.db_max_overflow,
                                            pool_pre_ping=True, pool_recycle=1800)
        _async_factory = async_sessionmaker(_async_engine, expire_on_commit=False)
    return _async_engine


def sync_engine():
    global _sync_engine, _sync_factory
    if _sync_engine is None:
        s = get_settings()
        _sync_engine = create_engine(s.app_dsn_sync, pool_size=s.db_pool_size, max_overflow=s.db_max_overflow,
                                     pool_pre_ping=True, pool_recycle=1800)
        _sync_factory = sessionmaker(_sync_engine, expire_on_commit=False)
    return _sync_engine


_SET_CTX = text("SELECT set_config('app.user_id', :uid, true), set_config('app.role', :role, true), "
                "set_config('app.facility_id', :fid, true), set_config('app.patient_scope', :pscope, true)")


def _ctx_params(user_id: str, role: str, facility_id: str | None, patient_scope: str | None) -> dict:
    return {"uid": user_id or "", "role": role or "", "fid": facility_id or "", "pscope": patient_scope or ""}


@asynccontextmanager
async def request_session(user_id: str, role: str, facility_id: str | None = None,
                          patient_scope: str | None = None) -> AsyncIterator[AsyncSession]:
    async_engine()
    async with _async_factory() as session:          # type: ignore[misc]
        async with session.begin():
            await session.execute(_SET_CTX, _ctx_params(user_id, role, facility_id, patient_scope))
            yield session


@contextmanager
def system_session(actor: str = "system") -> Iterator[Session]:
    """Worker / bootstrap session — role 'system' sees all rows (still the non-superuser app role)."""
    sync_engine()
    with _sync_factory() as session:                  # type: ignore[misc]
        with session.begin():
            session.execute(_SET_CTX, _ctx_params(actor, "system", None, None))
            yield session


async def dispose() -> None:
    if _async_engine is not None:
        await _async_engine.dispose()
