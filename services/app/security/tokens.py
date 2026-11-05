"""Signed, expiring tokens for QR codes (referral slips, health cards) and Provider Connect.

QR tokens carry only opaque ids (never names or diagnoses): a scanned card alone reveals nothing.
Each token has a unique `jti` stored in the DB, so cards/referrals can be revoked individually.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import secrets
import time
import uuid

import jwt
from fastapi import HTTPException

from ..config import get_settings

_TYPES = {"referral": "OSREF", "card": "OSCARD", "provider": "OSPROV"}


def issue_token(kind: str, subject: str, ttl_seconds: int, extra: dict | None = None) -> tuple[str, str]:
    s = get_settings()
    jti = uuid.uuid4().hex
    now = int(time.time())
    claims = {"sub": subject, "jti": jti, "iat": now, "exp": now + ttl_seconds, "k": kind, **(extra or {})}
    token = jwt.encode(claims, s.signing_secret, algorithm="HS256", headers={"typ": _TYPES[kind]})
    return token, jti


def verify_token(token: str, expected_type: str) -> dict:
    s = get_settings()
    try:
        if jwt.get_unverified_header(token).get("typ") != _TYPES[expected_type]:
            raise HTTPException(401, "wrong token type")
        claims = jwt.decode(token, s.signing_secret, algorithms=["HS256"], leeway=10)
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(401, "token expired") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, "invalid token") from e
    if claims.get("k") != expected_type:
        raise HTTPException(401, "wrong token kind")
    return claims


def qr_png_base64(payload: str) -> str:
    import segno

    buf = io.BytesIO()
    segno.make(payload, error="m").save(buf, kind="png", scale=6, border=2)
    return base64.b64encode(buf.getvalue()).decode()


# ── OTPs (6 digits, stored only as a keyed hash) ──
def new_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(otp: str, salt: str) -> str:
    return hmac.new(get_settings().signing_secret.encode(), f"{salt}:{otp}".encode(), hashlib.sha256).hexdigest()


def check_otp(otp: str, salt: str, stored: str) -> bool:
    return hmac.compare_digest(hash_otp(otp, salt), stored)
