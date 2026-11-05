"""Database schema (SQLAlchemy 2.0).

Conventions
* UUID primary keys (generated in Python; DB default gen_random_uuid() as backstop)
* All timestamps are timestamptz (UTC)
* PostGIS `geom` columns are GENERATED from lat/lon in migration 0002 (not mapped here)
* Row-level security policies, the audit hash-chain function and its triggers live in 0002 too
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _uuid_pk():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                         server_default=text("gen_random_uuid()"))


def _now():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ───────────────────────────── places & people ─────────────────────────────
class Village(Base):
    __tablename__ = "villages"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(120))
    taluk: Mapped[str] = mapped_column(String(80))
    district: Mapped[str] = mapped_column(String(80))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    population: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("name", "taluk", name="uq_village_name_taluk"),)


class Facility(Base):
    __tablename__ = "facilities"
    id: Mapped[uuid.UUID] = _uuid_pk()
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(30))            # phc | chc | dental_college | district_hospital
    district: Mapped[str] = mapped_column(String(80))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    phone: Mapped[str | None] = mapped_column(String(32))
    accepts_referrals: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class Staff(Base):
    """Profile of a Keycloak user (id = token 'sub'). Created just-in-time on first request."""
    __tablename__ = "staff"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(30))
    facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id"))
    phone: Mapped[str | None] = mapped_column(String(32))
    language: Mapped[str] = mapped_column(String(8), default="kn", server_default=text("'kn'"))
    created_at: Mapped[datetime] = _now()
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[uuid.UUID] = _uuid_pk()
    display_id: Mapped[str] = mapped_column(String(20), unique=True)      # short human id, e.g. DK-7F3K2Q
    full_name: Mapped[str] = mapped_column(String(160))
    sex: Mapped[str] = mapped_column(String(10))                          # male | female | other
    birth_year: Mapped[int | None] = mapped_column(Integer)
    phone: Mapped[str | None] = mapped_column(String(32))
    language: Mapped[str] = mapped_column(String(8), default="kn", server_default=text("'kn'"))        # kn | tcy (Tulu) | en
    village_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("villages.id"))
    facility_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("facilities.id"))   # home PHC
    abha_id: Mapped[str | None] = mapped_column(String(20))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_patients_facility", "facility_id"), Index("ix_patients_village", "village_id"))


# ───────────────────────────── consent (DPDP Act 2023) ─────────────────────
class ConsentText(Base):
    __tablename__ = "consent_texts"
    id: Mapped[uuid.UUID] = _uuid_pk()
    purpose: Mapped[str] = mapped_column(String(30))          # screening | sharing | ai_training
    version: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(8))
    text: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = _now()
    __table_args__ = (UniqueConstraint("purpose", "version", "language", name="uq_consent_text"),)


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(30))
    granted: Mapped[bool] = mapped_column(Boolean)
    consent_text_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("consent_texts.id"))
    method: Mapped[str] = mapped_column(String(30))           # signature | thumbprint | verbal_witnessed | otp
    witness_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    captured_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    evidence_sha256: Mapped[str | None] = mapped_column(String(64))
    captured_at: Mapped[datetime] = _now()
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_reason: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_consents_patient_purpose", "patient_id", "purpose"),)


# ───────────────────────────── screening ───────────────────────────────────
class Screening(Base):
    __tablename__ = "screenings"
    id: Mapped[uuid.UUID] = _uuid_pk()
    client_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)   # idempotency from the phone
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    facility_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("facilities.id"))
    worker_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = _now()
    status: Mapped[str] = mapped_column(String(20), default="received", server_default=text("'received'"))   # received | processing | completed
    habits: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    symptoms: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    habit_score: Mapped[int | None] = mapped_column(Integer)
    habit_level: Mapped[str | None] = mapped_column(String(10))
    mouth_opening: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))       # raw readings, iris/tap pixels, method
    mouth_opening_mm: Mapped[float | None] = mapped_column(Float)          # calibrated median
    device: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    app_version: Mapped[str | None] = mapped_column(String(30))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    expected_images: Mapped[int] = mapped_column(Integer, default=6, server_default=text("6"))
    on_device_result: Mapped[dict | None] = mapped_column(JSONB)          # what the phone showed offline
    ai_status: Mapped[str] = mapped_column(String(20), default="pending", server_default=text("'pending'")) # pending | done | partial | unavailable
    lesion_score: Mapped[float | None] = mapped_column(Float)
    cannot_assess: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    risk_level: Mapped[str | None] = mapped_column(String(20))            # HIGH | MEDIUM | LOW | CANNOT_ASSESS | NEEDS_REVIEW
    decision_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    __table_args__ = (Index("ix_screenings_patient", "patient_id"), Index("ix_screenings_facility", "facility_id"),
                      Index("ix_screenings_risk", "risk_level"))


class ScreeningImage(Base):
    __tablename__ = "screening_images"
    id: Mapped[uuid.UUID] = _uuid_pk()
    client_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    site: Mapped[str] = mapped_column(String(30))    # left_buccal | right_buccal | tongue_dorsum | tongue_ventral | gums | palate | front_open
    object_key: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str] = mapped_column(String(40), default="image/jpeg", server_default=text("'image/jpeg'"))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    upload_status: Mapped[str] = mapped_column(String(20), default="pending", server_default=text("'pending'"))   # pending | uploaded | verified | corrupt
    quality: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))                   # phone + server quality metrics
    created_at: Mapped[datetime] = _now()
    __table_args__ = (Index("ix_images_screening", "screening_id"),)


class ImageResult(Base):
    __tablename__ = "image_results"
    id: Mapped[uuid.UUID] = _uuid_pk()
    image_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screening_images.id", ondelete="CASCADE"))
    model_version: Mapped[str] = mapped_column(String(60))
    head_version: Mapped[str] = mapped_column(String(60))
    prob: Mapped[float] = mapped_column(Float)
    logit: Mapped[float | None] = mapped_column(Float)
    ood_distance: Mapped[float | None] = mapped_column(Float)
    out_of_distribution: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    lesion_area_pct: Mapped[float | None] = mapped_column(Float)    # % of image where heat map > 0.5 (proxy)
    cam_key: Mapped[str | None] = mapped_column(String(300))
    embedding = mapped_column(Vector(), nullable=True)
    shadow: Mapped[dict | None] = mapped_column(JSONB)              # challenger head output in shadow mode
    latency_ms: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = _now()
    __table_args__ = (UniqueConstraint("image_id", "model_version", "head_version", name="uq_result_image_model"),)


class RuleSet(Base):
    __tablename__ = "rule_sets"
    id: Mapped[uuid.UUID] = _uuid_pk()
    version: Mapped[int] = mapped_column(Integer, unique=True)
    status: Mapped[str] = mapped_column(String(20))       # draft | pending_approval | active | retired | rejected
    definition: Mapped[dict] = mapped_column(JSONB)
    sha256: Mapped[str] = mapped_column(String(64))
    rationale: Mapped[str | None] = mapped_column(Text)
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    proposed_at: Mapped[datetime] = _now()
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_comment: Mapped[str | None] = mapped_column(Text)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Decision(Base):
    """Full provenance of every risk decision — enough to replay it exactly."""
    __tablename__ = "decisions"
    id: Mapped[uuid.UUID] = _uuid_pk()
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    rule_set_version: Mapped[int] = mapped_column(Integer)
    rule_set_sha256: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str | None] = mapped_column(String(60))
    head_version: Mapped[str | None] = mapped_column(String(60))
    contract_sha256: Mapped[str | None] = mapped_column(String(64))
    inputs: Mapped[dict] = mapped_column(JSONB)
    outputs: Mapped[dict] = mapped_column(JSONB)
    risk_level: Mapped[str] = mapped_column(String(20))
    trigger: Mapped[str] = mapped_column(String(30))       # initial | ai_result | timeline_update | review | replay
    created_at: Mapped[datetime] = _now()
    __table_args__ = (Index("ix_decisions_screening", "screening_id"),)


# ───────────────────────────── referral & care continuity ──────────────────
class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[uuid.UUID] = _uuid_pk()
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    facility_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("facilities.id"))      # receiving specialist facility
    from_facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id"))
    priority: Mapped[str] = mapped_column(String(10), default="high", server_default=text("'high'"))
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default=text("'pending'"))  # pending | booked | visited | completed | cancelled
    reason: Mapped[str] = mapped_column(Text)
    due_by: Mapped[date] = mapped_column(Date)
    token_jti: Mapped[str] = mapped_column(String(64), unique=True)
    booked_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()
    __table_args__ = (Index("ix_referrals_facility_status", "facility_id", "status"),
                      Index("ix_referrals_patient", "patient_id"))


class HealthCard(Base):
    __tablename__ = "health_cards"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    token_jti: Mapped[str] = mapped_column(String(64), unique=True)
    issued_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    issued_at: Mapped[datetime] = _now()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProviderAccess(Base):
    """Provider Connect: a local doctor gets time-limited access to ONE patient after patient OTP consent."""
    __tablename__ = "provider_access"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    card_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("health_cards.id"))
    provider_name: Mapped[str] = mapped_column(String(160))
    provider_phone: Mapped[str] = mapped_column(String(32))
    provider_reg_no: Mapped[str | None] = mapped_column(String(60))
    otp_hash: Mapped[str] = mapped_column(String(128))
    otp_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(30))   # screening|symptom_report|provider_visit|medication|referral|review|checkin|followup|outcome|note|escalation
    source: Mapped[str] = mapped_column(String(20)) # asha|nurse|provider|specialist|patient_sms|ivr|system
    summary: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    created_by: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = _now()
    __table_args__ = (Index("ix_timeline_patient_time", "patient_id", "occurred_at"),)


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    timeline_event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("timeline_events.id"))
    photo_key: Mapped[str | None] = mapped_column(String(300))
    name_entered: Mapped[str | None] = mapped_column(String(160))
    ocr_text: Mapped[str | None] = mapped_column(Text)
    name_matched: Mapped[str | None] = mapped_column(String(160))
    category: Mapped[str | None] = mapped_column(String(60))       # e.g. topical_anaesthetic, steroid, antifungal
    masks_symptoms: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    match_score: Mapped[float | None] = mapped_column(Float)
    prescribed_by: Mapped[str | None] = mapped_column(String(160))
    started_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="recorded", server_default=text("'recorded'"))  # recorded | pending_ocr | ocr_done | ocr_failed
    created_at: Mapped[datetime] = _now()


class CheckIn(Base):
    __tablename__ = "checkins"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    screening_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("screenings.id"))
    channel: Mapped[str] = mapped_column(String(10))       # sms | ivr
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response: Mapped[str | None] = mapped_column(String(20))   # symptoms_back | no_symptoms | no_answer
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(20), default="scheduled", server_default=text("'scheduled'"))  # scheduled | sent | answered | expired | failed


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[uuid.UUID] = _uuid_pk()
    channel: Mapped[str] = mapped_column(String(10))       # sms | voice | in_app
    to_number: Mapped[str | None] = mapped_column(String(32))
    to_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    template: Mapped[str] = mapped_column(String(60))
    language: Mapped[str] = mapped_column(String(8), default="en", server_default=text("'en'"))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="queued", server_default=text("'queued'"))   # queued|sent|delivered|failed|sandbox|read
    provider: Mapped[str] = mapped_column(String(20), default="sandbox", server_default=text("'sandbox'"))
    provider_sid: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    related: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = _now()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_messages_staff", "to_staff_id", "status"),)


class FollowUp(Base):
    __tablename__ = "followups"
    id: Mapped[uuid.UUID] = _uuid_pk()
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    due_on: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="scheduled", server_default=text("'scheduled'"))   # scheduled | notified | done | missed
    done_screening_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()


# ───────────────────────────── specialist review & labels ──────────────────
class ReviewTask(Base):
    __tablename__ = "review_tasks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    facility_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("facilities.id"))
    kind: Mapped[str] = mapped_column(String(30))     # referral_review | cannot_assess | audit_sample | escalation | disputed_label
    priority: Mapped[int] = mapped_column(Integer)    # lower = more urgent
    status: Mapped[str] = mapped_column(String(20), default="open", server_default=text("'open'"))   # open | done | cancelled
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_tasks_queue", "facility_id", "status", "priority"),)


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("review_tasks.id"))
    screening_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"))
    specialist_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    verdict: Mapped[str] = mapped_column(String(30))  # confirm_refer | not_suspicious | needs_biopsy | cannot_assess
    diagnosis_code: Mapped[str | None] = mapped_column(String(30))   # e.g. OPMD-LEUK, OSMF, OSCC, BENIGN
    diagnosis_text: Mapped[str | None] = mapped_column(Text)
    ai_risk_level: Mapped[str | None] = mapped_column(String(20))
    ai_agreed: Mapped[bool | None] = mapped_column(Boolean)
    override_reason: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(Text)
    site_labels: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))   # {site: refer|no_refer}
    model_version: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = _now()


class Label(Base):
    __tablename__ = "labels"
    id: Mapped[uuid.UUID] = _uuid_pk()
    image_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("screening_images.id", ondelete="CASCADE"))
    review_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reviews.id"))
    label: Mapped[str] = mapped_column(String(10))          # refer | no_refer
    source: Mapped[str] = mapped_column(String(20))         # specialist | biopsy
    status: Mapped[str] = mapped_column(String(20), default="active", server_default=text("'active'"))   # active | disputed | excluded
    consent_ai_training: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = _now()
    __table_args__ = (UniqueConstraint("image_id", "review_id", name="uq_label_image_review"),)


# ───────────────────────────── models & MLOps ──────────────────────────────
class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[uuid.UUID] = _uuid_pk()
    version: Mapped[str] = mapped_column(String(60), unique=True)   # e.g. 1.0.0  or 1.0.0+head.3
    kind: Mapped[str] = mapped_column(String(10))                  # full | head
    backbone_version: Mapped[str] = mapped_column(String(60))
    parent_version: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20))  # candidate|shadow|active|retired|rolled_back|rejected
    is_placeholder: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    files: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))       # {name: {key, sha256, bytes}}
    head: Mapped[dict | None] = mapped_column(JSONB)               # weights, bias, thresholds (for head versions)
    contract: Mapped[dict | None] = mapped_column(JSONB)
    card: Mapped[dict | None] = mapped_column(JSONB)
    benchmark: Mapped[dict | None] = mapped_column(JSONB)          # metrics on the fixed benchmark
    training_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)


class TrainingRun(Base):
    __tablename__ = "training_runs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    trigger: Mapped[str] = mapped_column(String(20))          # manual | auto_labels | scheduled
    requested_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(String(20), default="queued", server_default=text("'queued'"))   # queued|running|succeeded|failed
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dataset_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    params: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    champion_version: Mapped[str | None] = mapped_column(String(60))
    candidate_version: Mapped[str | None] = mapped_column(String(60))
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


class DatasetSnapshot(Base):
    """Content-addressed training-set snapshot = data lineage."""
    __tablename__ = "dataset_snapshots"
    id: Mapped[uuid.UUID] = _uuid_pk()
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    object_key: Mapped[str] = mapped_column(String(300))
    n_samples: Mapped[int] = mapped_column(Integer)
    label_counts: Mapped[dict] = mapped_column(JSONB)
    sources: Mapped[dict] = mapped_column(JSONB)
    excluded_noncommercial: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    dvc_rev: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = _now()


class LineageEdge(Base):
    """Which sample (reference case or label) went into which snapshot."""
    __tablename__ = "lineage_edges"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_snapshots.id", ondelete="CASCADE"))
    sample_kind: Mapped[str] = mapped_column(String(20))    # reference | label
    sample_id: Mapped[str] = mapped_column(String(200))
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    __table_args__ = (Index("ix_lineage_patient", "patient_id"), Index("ix_lineage_snapshot", "snapshot_id"))


class Dataset(Base):
    """Datasheet: provenance + licence of each data source."""
    __tablename__ = "datasets"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(160), unique=True)
    source_url: Mapped[str | None] = mapped_column(String(400))
    licence: Mapped[str] = mapped_column(String(80))
    commercial_use: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    description: Mapped[str | None] = mapped_column(Text)
    n_images: Mapped[int | None] = mapped_column(Integer)
    labels: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    known_issues: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = _now()


class ReferenceCase(Base):
    """Embeddings of confirmed cases for 'similar cases' (pgvector) and head retraining."""
    __tablename__ = "reference_cases"
    id: Mapped[uuid.UUID] = _uuid_pk()
    ref_key: Mapped[str] = mapped_column(String(120), unique=True)
    origin: Mapped[str] = mapped_column(String(20))           # phase1_reference | confirmed_case
    label: Mapped[str] = mapped_column(String(10))
    source: Mapped[str | None] = mapped_column(String(160))
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("datasets.id"))
    image_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    diagnosis_code: Mapped[str | None] = mapped_column(String(30))
    thumbnail_key: Mapped[str | None] = mapped_column(String(300))
    backbone_version: Mapped[str] = mapped_column(String(60))
    embedding = mapped_column(Vector(), nullable=False)           # L2-normalised (similarity)
    embedding_raw = mapped_column(Vector(), nullable=True)        # raw (head training)
    created_at: Mapped[datetime] = _now()


class BenchmarkItem(Base):
    __tablename__ = "benchmark_items"
    id: Mapped[uuid.UUID] = _uuid_pk()
    image_key: Mapped[str] = mapped_column(String(300), unique=True)
    y: Mapped[int] = mapped_column(Integer)
    source: Mapped[str | None] = mapped_column(String(160))
    backbone_version: Mapped[str] = mapped_column(String(60))
    embedding_raw = mapped_column(Vector(), nullable=False)


class DriftReport(Base):
    __tablename__ = "drift_reports"
    id: Mapped[uuid.UUID] = _uuid_pk()
    model_version: Mapped[str] = mapped_column(String(60))
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    n_current: Mapped[int] = mapped_column(Integer)
    metrics: Mapped[dict] = mapped_column(JSONB)
    alert: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    report_key: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = _now()


class FairnessReport(Base):
    __tablename__ = "fairness_reports"
    id: Mapped[uuid.UUID] = _uuid_pk()
    model_version: Mapped[str] = mapped_column(String(60))
    n_reviews: Mapped[int] = mapped_column(Integer)
    metrics: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[str] = mapped_column(String(30))       # missed_case | model_issue | data_issue | auto_rollback | access_anomaly
    severity: Mapped[str] = mapped_column(String(10), default="medium", server_default=text("'medium'"))
    description: Mapped[str] = mapped_column(Text)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    screening_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model_version: Mapped[str | None] = mapped_column(String(60))
    reported_by: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="open", server_default=text("'open'"))
    resolution: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


# ───────────────────────────── reliability & audit ─────────────────────────
class OutboxEvent(Base):
    __tablename__ = "outbox"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    topic: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSONB)
    dedupe_key: Mapped[str | None] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = _now()
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_outbox_pending", "published_at", "available_at"),)


class DeadLetter(Base):
    __tablename__ = "dead_letters"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_name: Mapped[str] = mapped_column(String(120))
    payload: Mapped[dict] = mapped_column(JSONB)
    error: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer)
    failed_at: Mapped[datetime] = _now()
    retried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(300))
    request_sha256: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class AuditLog(Base):
    """Append-only, hash-chained. Rows are written ONLY via the SQL function audit_append()."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_id: Mapped[str] = mapped_column(String(64))
    actor_role: Mapped[str] = mapped_column(String(30))
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    patient_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    request_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    __table_args__ = (Index("ix_audit_patient", "patient_id"), Index("ix_audit_actor", "actor_id"),
                      Index("ix_audit_entity", "entity_type", "entity_id"))


class AuditSnapshot(Base):
    __tablename__ = "audit_snapshots"
    id: Mapped[uuid.UUID] = _uuid_pk()
    day: Mapped[date] = mapped_column(Date, unique=True)
    first_id: Mapped[int | None] = mapped_column(BigInteger)
    last_id: Mapped[int | None] = mapped_column(BigInteger)
    head_hash: Mapped[str | None] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(300))
    retain_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class SystemSetting(Base):
    """Small key/value store for runtime switches (e.g. shadow model, active head)."""
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())
