"""Signed QR / provider tokens, OTP hashing, local JWTs."""
import pytest
from fastapi import HTTPException

from app.security.auth import mint_local_token, staff_uuid, verify_staff_token
from app.security.tokens import check_otp, hash_otp, issue_token, new_otp, verify_token


def test_token_roundtrip_and_type_binding():
    tok, jti = issue_token("card", "patient-1", 60)
    claims = verify_token(tok, "card")
    assert claims["sub"] == "patient-1" and claims["jti"] == jti
    with pytest.raises(HTTPException):
        verify_token(tok, "referral")          # a card can never be used as a referral slip


def test_tampered_and_expired_tokens_rejected():
    tok, _ = issue_token("referral", "r-1", 60)
    with pytest.raises(HTTPException):
        verify_token(tok[:-2] + ("A" if tok[-2] != "A" else "B") + tok[-1], "referral")
    old, _ = issue_token("referral", "r-1", -10)
    with pytest.raises(HTTPException):
        verify_token(old, "referral")


def test_otp_hash():
    otp, salt = new_otp(), "s4lt"
    assert len(otp) == 6 and otp.isdigit()
    h = hash_otp(otp, salt)
    assert check_otp(otp, salt, h) and not check_otp("000000" if otp != "000000" else "111111", salt, h)


def test_local_staff_token():
    p = verify_staff_token(mint_local_token("kavya.asha", "asha", "fac-1"))
    assert p.role == "asha" and p.facility_id == "fac-1" and p.user_id == staff_uuid("kavya.asha")
