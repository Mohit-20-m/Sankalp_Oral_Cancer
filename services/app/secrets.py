"""Secrets from HashiCorp Vault (KV v2). Falls back to environment values if Vault is unreachable,
so a Vault outage degrades gracefully instead of taking the platform down."""
from __future__ import annotations

from .config import Settings, get_settings
from .observability import log

_LOADED = False

# Vault key -> Settings attribute
_MAP = {
    "signing_secret": "signing_secret",
    "twilio_account_sid": "twilio_account_sid",
    "twilio_auth_token": "twilio_auth_token",
    "twilio_from_number": "twilio_from_number",
    "twilio_api_key_sid": "twilio_api_key_sid",
    "twilio_api_key_secret": "twilio_api_key_secret",
    "s3_secret_key": "s3_secret_key",
}


def load_secrets(settings: Settings | None = None, wait_s: float = 45.0) -> dict:
    """Overlay Vault secrets onto settings. Returns a small status dict for /ready.
    Waits up to `wait_s` for Vault at start-up, because every API/worker instance must sign with the SAME key."""
    global _LOADED
    import time

    s = settings or get_settings()
    status = {"source": "env", "keys": []}
    deadline = time.time() + wait_s
    while True:
        try:
            return _load(s, status)
        except Exception as e:  # noqa: BLE001
            if time.time() >= deadline:
                log.warning("vault_unavailable_using_env", error=str(e))
                break
            time.sleep(2)
    if s.env == "prod" and s.signing_secret.startswith("dev-only"):
        raise RuntimeError("Refusing to start in prod with the development signing secret")
    return status


def _load(s: Settings, status: dict) -> dict:
    global _LOADED
    import hvac

    client = hvac.Client(url=s.vault_addr, token=s.vault_token, timeout=3)
    if not client.is_authenticated():
        raise RuntimeError("vault token not authenticated")
    try:
        client.auth.token.renew_self()          # periodic service token: renewing keeps it alive
    except Exception:  # noqa: BLE001 — root/dev tokens are not renewable
        pass
    if True:
        data = client.secrets.kv.v2.read_secret_version(path=s.vault_kv_path, raise_on_deleted_version=True)
        values = data["data"]["data"]
        for k, attr in _MAP.items():
            if values.get(k):
                object.__setattr__(s, attr, values[k])
                status["keys"].append(k)
        status["source"] = "vault"
        _LOADED = True
    return status
