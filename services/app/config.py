"""Central configuration (12-factor: everything comes from environment variables / Vault)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OS_", env_file=None, extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    service_name: str = "oralscreen-api"
    public_base_url: str = "https://localhost"

    # --- database (app role is subject to row-level security; owner runs migrations) ---
    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "oralscreen"
    db_app_user: str = "oralscreen_app"
    db_app_password: str = "app"
    db_owner_user: str = "oralscreen_owner"
    db_owner_password: str = "owner"
    db_pool_size: int = 5
    db_max_overflow: int = 5

    # --- redis / celery ---
    redis_url: str = "redis://redis:6379/0"

    # --- object storage (MinIO / S3) ---
    s3_endpoint: str = "http://minio:9000"
    s3_public_endpoint: str = "http://localhost:9000"     # used in presigned URLs handed to clients
    s3_access_key: str = "oralscreen"
    s3_secret_key: str = "oralscreen-secret"
    s3_region: str = "us-east-1"
    bucket_images: str = "os-images"
    bucket_derived: str = "os-derived"        # heat maps, thumbnails, reports
    bucket_models: str = "os-models"
    bucket_audit: str = "os-audit"            # Object Lock (WORM) bucket
    audit_retention_days: int = 30

    # --- identity ---
    auth_mode: Literal["keycloak", "local"] = "keycloak"
    keycloak_internal_url: str = "http://keycloak:8080/auth"
    keycloak_realm: str = "oralscreen"
    keycloak_issuer: str = "https://localhost/auth/realms/oralscreen"
    keycloak_audience: str = ""               # optional audience check
    local_jwt_issuer: str = "oralscreen-local"

    # --- authorisation ---
    opa_url: str = "http://opa:8181"
    opa_policy_path: str = "oralscreen/authz/decision"
    opa_timeout_s: float = 3.0

    # --- secrets ---
    vault_addr: str = "http://vault:8200"
    vault_token: str = "root"
    vault_kv_path: str = "oralscreen"
    signing_secret: str = "dev-only-signing-secret-change-me"   # replaced from Vault at start-up

    # --- inference ---
    inference_url: str = "http://inference:8090"
    inference_timeout_s: float = 30.0
    models_dir: str = "/models"
    # AI-only flag (rule R1b): ask the ASHA to retake the flagged photo(s) once before a specialist is involved.
    # If no retake arrives within the window, the case goes to the specialist queue as usual.
    retake_before_review: bool = True
    retake_timeout_hours: float = 24.0

    # --- messaging ---
    messaging_mode: Literal["twilio", "sandbox"] = "sandbox"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_api_key_sid: str = ""              # optional: API key (SK...) + secret instead of the auth token
    twilio_api_key_secret: str = ""
    # Twilio TRIAL accounts reject custom SMS text (error 572006) and only send Twilio's predefined templates.
    # For demos: send the closest predefined template instead; the full Arogya text is still stored and shown in admin.
    twilio_trial_templates: bool = False
    twilio_from_number: str = ""
    twilio_validate_signatures: bool = True
    public_webhook_base: str = ""             # e.g. https://<ngrok-id>.ngrok-free.app (needed for IVR)

    # --- clinical defaults (the active rule set in the DB overrides these) ---
    audit_sample_rate: float = 0.07
    persistence_days: int = 14
    checkin_after_days: int = 14
    otp_ttl_minutes: int = 10
    provider_access_hours: int = 24
    k_anonymity_min_cell: int = 5

    # --- MLOps ---
    retrain_min_new_labels: int = 50
    mlflow_tracking_uri: str = "http://mlflow:5000"
    auto_rollback_min_reviews: int = 20
    auto_rollback_margin: float = 0.15
    dvc_enabled: bool = False

    # --- observability ---
    otel_enabled: bool = True
    otel_endpoint: str = "http://lgtm:4318"
    sentry_dsn: str = ""
    log_level: str = "INFO"

    # --- FHIR ---
    fhir_base_url: str = "https://localhost/api/v1/fhir"
    hapi_url: str = ""
    capture_base_url: str = ""               # base URL a phone on the same Wi-Fi can reach (e.g. https://192.168.1.20)                        # set when the 'hapi' profile is running

    # --- API ---
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])
    max_upload_mb: int = 15

    @property
    def app_dsn_async(self) -> str:
        return (f"postgresql+asyncpg://{self.db_app_user}:{self.db_app_password}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}")

    @property
    def app_dsn_sync(self) -> str:
        return (f"postgresql+psycopg://{self.db_app_user}:{self.db_app_password}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}")

    @property
    def owner_dsn_sync(self) -> str:
        return (f"postgresql+psycopg://{self.db_owner_user}:{self.db_owner_password}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
