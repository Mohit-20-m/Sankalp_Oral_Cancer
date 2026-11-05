"""Circuit breakers + retry helpers.

A breaker opens after `fail_max` consecutive failures; calls then fail fast for `reset_s`
seconds instead of piling up timeouts. After that one trial call is allowed (half-open).
"""
from __future__ import annotations

import random
import threading
import time
from typing import Callable, TypeVar

from .observability import CIRCUIT_OPEN, log

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, name: str, fail_max: int = 5, reset_s: float = 30.0):
        self.name, self.fail_max, self.reset_s = name, fail_max, reset_s
        self.failures = 0
        self.opened_at: float | None = None
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "closed"
        return "half_open" if time.time() - self.opened_at >= self.reset_s else "open"

    def before(self) -> None:
        if self.state == "open":
            raise CircuitOpenError(f"circuit '{self.name}' is open")

    def success(self) -> None:
        with self._lock:
            if self.opened_at is not None:
                log.info("circuit_closed", name=self.name)
            self.failures, self.opened_at = 0, None
            CIRCUIT_OPEN.labels(self.name).set(0)

    def failure(self, err: Exception) -> None:
        with self._lock:
            self.failures += 1
            if self.failures >= self.fail_max or self.state == "half_open":
                if self.opened_at is None or self.state == "half_open":
                    log.warning("circuit_opened", name=self.name, error=str(err))
                self.opened_at = time.time()
                CIRCUIT_OPEN.labels(self.name).set(1)

    def call(self, fn: Callable[..., T], *a, **kw) -> T:
        self.before()
        try:
            out = fn(*a, **kw)
        except Exception as e:  # noqa: BLE001
            self.failure(e)
            raise
        self.success()
        return out

    async def acall(self, fn, *a, **kw):
        self.before()
        try:
            out = await fn(*a, **kw)
        except Exception as e:  # noqa: BLE001
            self.failure(e)
            raise
        self.success()
        return out

    def snapshot(self) -> dict:
        return {"name": self.name, "state": self.state, "failures": self.failures}


_breakers: dict[str, CircuitBreaker] = {}


def breaker(name: str, fail_max: int = 5, reset_s: float = 30.0) -> CircuitBreaker:
    if name not in _breakers:
        _breakers[name] = CircuitBreaker(name, fail_max, reset_s)
    return _breakers[name]


def all_breakers() -> list[dict]:
    return [b.snapshot() for b in _breakers.values()]


def backoff_delay(attempt: int, base: float = 2.0, cap: float = 300.0) -> float:
    """Exponential backoff with full jitter: random(0, min(cap, base * 2^attempt))."""
    return random.uniform(0, min(cap, base * (2 ** attempt)))
