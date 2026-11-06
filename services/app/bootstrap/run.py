"""One-shot bootstrap (the `bootstrap` container). Safe to run repeatedly.

1. wait for PostgreSQL, MinIO, Vault;  2. migrate (owner role);  3. buckets (+ Object Lock audit bucket);
4. Vault secrets (signing key, Twilio);  5. model folder (placeholder if empty) + state file;
6. reference data (facilities, villages, staff profiles, consent texts, rule set);
7. queue model indexing + (optionally) the demo story.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sys
import time
import uuid
from pathlib import Path

from sqlalchemy import create_engine, select, text

from ..config import get_settings
from ..observability import log, setup_logging
from .demo_world import CONSENT_TEXTS, FACILITIES, STAFF, VILLAGES, fid, uid


def wait_for(name: str, fn, timeout: int = 180) -> None:
    t0 = time.time()
    while True:
        try:
            fn()
            log.info("dependency_ready", name=name)
            return
        except Exception as e:  # noqa: BLE001
            if time.time() - t0 > timeout:
                raise RuntimeError(f"{name} not ready after {timeout}s: {e}") from e
            time.sleep(2)


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().owner_dsn_sync)
    command.upgrade(cfg, "head")


def vault_secrets() -> None:
    import hvac

    s = get_settings()
    client = hvac.Client(url=s.vault_addr, token=s.vault_token, timeout=5)
    try:
        client.sys.enable_secrets_engine("kv", path="secret", options={"version": "2"})
    except Exception:  # noqa: BLE001 — dev mode already has secret/ mounted
        pass
    try:
        current = client.secrets.kv.v2.read_secret_version(path=s.vault_kv_path,
                                                           raise_on_deleted_version=True)["data"]["data"]
    except Exception:  # noqa: BLE001
        current = {}
    new = dict(current)
    new.setdefault("signing_secret", secrets.token_urlsafe(48))
    for k in ("twilio_account_sid", "twilio_auth_token", "twilio_from_number", "twilio_api_key_sid",
              "twilio_api_key_secret"):
        v = os.environ.get(f"OS_{k.upper()}", "")
        if v:
            new[k] = v
    if new != current:
        client.secrets.kv.v2.create_or_update_secret(path=s.vault_kv_path, secret=new)
    log.info("vault_secrets_ready", keys=sorted(new))


def _sha(p: Path) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def sync_phase1_models(root: Path) -> bool:
    """./models/current on the host (read-only mount at OS_MODEL_SEED_DIR) holds the trained model (scripts/fetch-model.sh). When it
    differs from what the models volume serves, copy it in atomically. Returns True if a new model arrived."""
    import shutil

    seed = Path(os.environ.get("OS_MODEL_SEED_DIR", "/seed-models")) / "current"
    if not (seed / "model_contract.json").exists():
        return False
    if _sha(seed / "model_contract.json") == _sha(root / "current" / "model_contract.json") and \
            _sha(seed / "backbone.onnx") == _sha(root / "current" / "backbone.onnx"):
        return False
    tmp = root / ".incoming"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(seed, tmp)
    old = root / ".previous"
    shutil.rmtree(old, ignore_errors=True)
    if (root / "current").exists():
        (root / "current").rename(old)
    tmp.rename(root / "current")
    log.info("phase1_model_installed", source=str(seed))
    return True


def ensure_models() -> bool:
    from ..services.mlops import write_state

    root = Path(get_settings().models_dir)
    (root / "heads").mkdir(parents=True, exist_ok=True)
    new_model = sync_phase1_models(root)
    if new_model:
        write_state(active_head="base", shadow_head=None)
    if not (root / "current" / "model_contract.json").exists():
        from ..ml.placeholder import generate

        log.warning("models/current is empty — generating the PLACEHOLDER model (run scripts/fetch-model.sh)")
        generate(root / "current")
    if not (root / "state.json").exists():
        write_state(active_head="base", shadow_head=None)
    return new_model


def seed_reference(s) -> None:
    from ..domain.decision import DEFAULT_RULE_SET, rule_set_sha
    from ..models import ConsentText, Facility, RuleSet, Staff, Village

    for code, name, kind, lat, lon, acc in FACILITIES:
        if s.get(Facility, uuid.UUID(fid(code))) is None:
            s.add(Facility(id=uuid.UUID(fid(code)), code=code, name=name, kind=kind, district="Dakshina Kannada",
                           lat=lat, lon=lon, accepts_referrals=acc, phone="+910000000000"))
    for name, taluk, lat, lon, pop in VILLAGES:
        if not s.execute(select(Village).where(Village.name == name, Village.taluk == taluk)).scalars().first():
            s.add(Village(name=name, taluk=taluk, district="Dakshina Kannada", lat=lat, lon=lon, population=pop))
    s.flush()
    for username, full, role, fcode in STAFF:
        if s.get(Staff, uuid.UUID(uid(username))) is None:
            s.add(Staff(id=uuid.UUID(uid(username)), username=username, full_name=full, role=role,
                        facility_id=uuid.UUID(fid(fcode)) if fcode else None))
    for purpose, langs in CONSENT_TEXTS.items():
        for lang, txt in langs.items():
            exists = s.execute(select(ConsentText).where(ConsentText.purpose == purpose, ConsentText.version == 1,
                                                         ConsentText.language == lang)).scalars().first()
            if not exists:
                s.add(ConsentText(purpose=purpose, version=1, language=lang, text=txt,
                                  sha256=hashlib.sha256(txt.encode()).hexdigest()))
    if not s.execute(select(RuleSet)).scalars().first():
        s.add(RuleSet(version=1, status="active", definition=DEFAULT_RULE_SET, sha256=rule_set_sha(DEFAULT_RULE_SET),
                      rationale="Default rule set: Udupi taluk risk factors, 35 mm OSMF cut-off, 14-day persistence "
                                "rule. Cut-offs to be confirmed by an oral medicine specialist."))


def main() -> int:
    setup_logging("oralscreen-bootstrap")
    s = get_settings()
    from .. import storage
    from ..db import system_session
    from ..outbox import emit_sync

    wait_for("postgres", lambda: create_engine(s.owner_dsn_sync).connect().execute(text("SELECT 1")))
    migrate()
    log.info("migrations_applied")
    wait_for("minio", storage.ensure_buckets)
    try:
        wait_for("vault", vault_secrets, timeout=60)
    except Exception as e:  # noqa: BLE001
        log.warning("vault_unavailable_continuing_with_env_secrets", error=str(e))
    new_model = ensure_models()
    with system_session("bootstrap") as sess:
        seed_reference(sess)
        emit_sync(sess, "model.index", {"force": new_model},
                  dedupe_key=f"index:boot:{'new' if new_model else 'same'}:{int(time.time() // 60)}")
    if os.environ.get("OS_SEED_DEMO", "true").lower() == "true":
        from .seed_demo import seed_demo

        with system_session("bootstrap") as sess:
            print(seed_demo(sess))
    log.info("bootstrap_complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
