"""OPA client. Fails CLOSED: if the policy engine cannot be reached, the request is refused (503)."""
from __future__ import annotations

import httpx
from fastapi import HTTPException

from ..config import get_settings
from ..observability import AUTHZ_DENIED, log
from ..resilience import CircuitOpenError, breaker
from .auth import Principal

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=get_settings().opa_timeout_s)
    return _client


async def decide(p: Principal, action: str, resource: dict | None = None) -> dict:
    s = get_settings()
    payload = {"input": {"subject": {"role": p.role, "user_id": p.user_id, "facility_id": p.facility_id or "",
                                     "patient_scope": p.patient_scope or ""},
                         "action": action, "resource": {k: (str(v) if v is not None else None)
                                                        for k, v in (resource or {}).items()}}}

    async def _call():
        last = None
        for _ in range(2):                 # one quick retry: a busy laptop can make a single call time out
            try:
                r = await _http().post(f"{s.opa_url}/v1/data/{s.opa_policy_path}", json=payload)
                r.raise_for_status()
                return r.json().get("result") or {"allow": False, "reasons": ["policy returned no decision"]}
            except httpx.TransportError as e:
                last = e
        raise last

    try:
        return await breaker("opa", fail_max=5, reset_s=10).acall(_call)
    except (CircuitOpenError, httpx.HTTPError) as e:
        log.error("policy_engine_unavailable", error=str(e))
        raise HTTPException(503, "authorisation service unavailable — request refused for safety") from e


async def authorize(p: Principal, action: str, resource: dict | None = None) -> None:
    d = await decide(p, action, resource)
    if not d.get("allow"):
        AUTHZ_DENIED.labels(action).inc()
        raise HTTPException(403, {"error": "forbidden", "action": action, "reasons": d.get("reasons", [])})
