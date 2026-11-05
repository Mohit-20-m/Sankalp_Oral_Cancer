"""Authentication.

* keycloak mode (default): RS256 access tokens issued by Keycloak; keys fetched from JWKS and cached.
* local mode (tests / offline dev): RS256 tokens signed by a key generated at start-up.
* provider tokens: short-lived HS256 tokens for Provider Connect (one patient, one local doctor).
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import get_settings

ROLE_PRIORITY = ["clinical_lead", "admin", "specialist", "district_officer", "nurse", "asha"]
STAFF_ROLES = set(ROLE_PRIORITY)


@dataclass
class Principal:
    user_id: str
    username: str
    role: str
    roles: list[str] = field(default_factory=list)
    facility_id: str | None = None
    full_name: str | None = None
    patient_scope: str | None = None      # provider tokens only
    token_kind: str = "staff"             # staff | provider

    @property
    def is_provider(self) -> bool:
        return self.token_kind == "provider"


# ───────────────────────── key management ─────────────────────────
class _JWKSCache:
    def __init__(self):
        self.keys: dict[str, object] = {}
        self.fetched_at = 0.0

    def get(self, kid: str):
        if kid not in self.keys or time.time() - self.fetched_at > 600:
            self.refresh()
        if kid not in self.keys:
            raise HTTPException(401, "unknown signing key")
        return self.keys[kid]

    def refresh(self):
        s = get_settings()
        url = f"{s.keycloak_internal_url}/realms/{s.keycloak_realm}/protocol/openid-connect/certs"
        try:
            jwks = httpx.get(url, timeout=3).json()
        except Exception as e:  # noqa: BLE001
            if self.keys:          # keep serving with cached keys if Keycloak blips
                return
            raise HTTPException(503, f"identity provider unavailable: {e}") from e
        self.keys = {k["kid"]: jwt.algorithms.RSAAlgorithm.from_jwk(k) for k in jwks.get("keys", [])
                     if k.get("use", "sig") == "sig" and k.get("kty") == "RSA"}
        self.fetched_at = time.time()


_jwks = _JWKSCache()
_local_key = None


def local_keypair():
    """RSA key for local mode (generated once per process; tests mint tokens with it)."""
    global _local_key
    if _local_key is None:
        from cryptography.hazmat.primitives.asymmetric import rsa

        _local_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return _local_key


def staff_uuid(username: str) -> str:
    """Deterministic staff id — the same value the Keycloak realm file and the seed data use."""
    from ..bootstrap.demo_world import uid

    return uid(username)


def mint_local_token(username: str, role: str, facility_id: str | None, user_id: str | None = None,
                     full_name: str | None = None, ttl: int = 3600) -> str:
    s = get_settings()
    now = int(time.time())
    claims = {"iss": s.local_jwt_issuer, "sub": user_id or staff_uuid(username),
              "preferred_username": username, "name": full_name or username, "iat": now, "exp": now + ttl,
              "realm_access": {"roles": [role]}, "facility_id": facility_id or ""}
    return jwt.encode(claims, local_keypair(), algorithm="RS256", headers={"kid": "local"})


# ───────────────────────── verification ─────────────────────────
def _principal_from_claims(claims: dict) -> Principal:
    roles = [r for r in (claims.get("realm_access") or {}).get("roles", []) if r in STAFF_ROLES]
    if not roles:
        raise HTTPException(403, "no Sankalp role assigned to this account")
    role = next(r for r in ROLE_PRIORITY if r in roles)
    fac = claims.get("facility_id") or None
    if isinstance(fac, list):
        fac = fac[0] if fac else None
    return Principal(user_id=claims["sub"], username=claims.get("preferred_username", claims["sub"]), role=role,
                     roles=roles, facility_id=fac, full_name=claims.get("name"))


def verify_staff_token(token: str) -> Principal:
    s = get_settings()
    try:
        header = jwt.get_unverified_header(token)
        if s.auth_mode == "local" or header.get("kid") == "local":
            if s.auth_mode != "local":
                raise HTTPException(401, "local tokens are disabled")
            claims = jwt.decode(token, local_keypair().public_key(), algorithms=["RS256"], issuer=s.local_jwt_issuer,
                                options={"verify_aud": False})
        else:
            key = _jwks.get(header.get("kid", ""))
            opts = {"verify_aud": bool(s.keycloak_audience)}
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=s.keycloak_issuer,
                                audience=s.keycloak_audience or None, options=opts, leeway=30)
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(401, "token expired") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    return _principal_from_claims(claims)


def verify_provider_token(token: str) -> Principal:
    from .tokens import verify_token

    claims = verify_token(token, expected_type="provider")
    return Principal(user_id=f"provider:{claims['pid']}", username=claims.get("name", "provider"), role="provider",
                     roles=["provider"], facility_id=None, full_name=claims.get("name"),
                     patient_scope=claims["sub"], token_kind="provider")


_bearer = HTTPBearer(auto_error=False)


async def current_principal(request: Request,
                            creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    if creds is None or not creds.credentials:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    token = creds.credentials
    if token.count(".") == 2 and jwt.get_unverified_header(token).get("typ") == "OSPROV":
        p = verify_provider_token(token)
    else:
        p = verify_staff_token(token)
    request.state.principal = p
    return p
