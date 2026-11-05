"""Request/response schemas (Pydantic v2)."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Site = Literal["left_buccal", "right_buccal", "tongue_dorsum", "tongue_ventral", "gums", "palate", "front_open"]


class PatientIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    sex: Literal["male", "female", "other"]
    birth_year: int | None = Field(default=None, ge=1900, le=2030)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{10,15}$")
    language: Literal["kn", "tcy", "en"] = "kn"
    village_id: uuid.UUID | None = None
    abha_id: str | None = Field(default=None, max_length=20)


class PatientPatch(BaseModel):
    full_name: str | None = None
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{10,15}$")
    language: Literal["kn", "tcy", "en"] | None = None
    village_id: uuid.UUID | None = None
    abha_id: str | None = None


class ConsentIn(BaseModel):
    purpose: Literal["screening", "sharing", "ai_training"]
    granted: bool
    consent_text_id: uuid.UUID
    method: Literal["signature", "thumbprint", "verbal_witnessed", "otp"]
    witness_staff_id: uuid.UUID | None = None
    evidence_sha256: str | None = None


class WithdrawIn(BaseModel):
    reason: str | None = None


class Habits(BaseModel):
    areca: bool = False
    areca_years: int | None = Field(default=None, ge=0, le=90)
    tobacco: bool = False
    tobacco_type: Literal["smokeless", "smoked", "both", "none"] | None = None
    tobacco_years: int | None = Field(default=None, ge=0, le=90)
    alcohol: bool = False
    alcohol_frequency: Literal["daily", "weekly", "occasional", "none"] | None = None


class Symptoms(BaseModel):
    burning: bool = False
    difficulty_opening: bool = False
    patch_noticed: bool = False
    patch_duration_days: int | None = Field(default=None, ge=0, le=3650)
    pain: bool = False
    pain_relieved_by_medication: bool = False
    ulcer_not_healing: bool = False


class MouthOpening(BaseModel):
    method: Literal["iris", "card", "manual"] = "iris"
    readings: list[dict] = Field(default_factory=list, max_length=10)
    head_pose: dict | None = None
    source: Literal["auto", "manual"] | None = None     # auto = on-device face landmarks, manual = tapped by hand


class ImageManifest(BaseModel):
    client_uuid: uuid.UUID
    site: Site
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(gt=0)
    content_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"
    quality: dict = Field(default_factory=dict)          # the phone's own quality-gate metrics


class ScreeningIn(BaseModel):
    client_uuid: uuid.UUID
    patient_id: uuid.UUID
    captured_at: datetime
    habits: Habits
    symptoms: Symptoms
    mouth_opening: MouthOpening | None = None
    images: list[ImageManifest] = Field(min_length=1, max_length=12)
    device: dict = Field(default_factory=dict)
    app_version: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    on_device_result: dict | None = None


class MultipartDone(BaseModel):
    upload_id: str
    parts: list[dict]


class ReferralStatusIn(BaseModel):
    status: Literal["booked", "visited", "completed", "cancelled"]
    booked_for: datetime | None = None
    outcome: dict | None = None


class ScanIn(BaseModel):
    token: str


class ReviewIn(BaseModel):
    verdict: Literal["confirm_refer", "not_suspicious", "needs_biopsy", "cannot_assess"]
    diagnosis_code: str | None = Field(default=None, max_length=30)
    diagnosis_text: str | None = None
    override_reason: Literal["lesion_missed_by_ai", "false_alarm", "poor_image", "clinical_history",
                             "other"] | None = None
    notes: str | None = None
    site_labels: dict[str, Literal["refer", "no_refer"]] = Field(default_factory=dict)


class TimelineIn(BaseModel):
    kind: Literal["symptom_report", "provider_visit", "note"]
    occurred_at: datetime | None = None
    summary: str = Field(min_length=1, max_length=2000)
    data: dict = Field(default_factory=dict)


class MedicationIn(BaseModel):
    name_entered: str | None = None
    prescribed_by: str | None = None
    started_on: date | None = None


class ProviderRequestIn(BaseModel):
    card_token: str
    provider_name: str = Field(min_length=2, max_length=160)
    provider_phone: str = Field(pattern=r"^\+?[0-9]{10,15}$")
    provider_reg_no: str | None = None


class ProviderVerifyIn(BaseModel):
    request_id: uuid.UUID
    otp: str = Field(pattern=r"^[0-9]{6}$")


class RuleProposalIn(BaseModel):
    definition: dict
    rationale: str = Field(min_length=10)


class RuleDecisionIn(BaseModel):
    comment: str | None = None


class RetrainIn(BaseModel):
    exclude_noncommercial: bool = False


class DatasetPatch(BaseModel):
    licence: str | None = None
    commercial_use: bool | None = None
    known_issues: str | None = None
    source_url: str | None = None


class IncidentIn(BaseModel):
    kind: Literal["missed_case", "model_issue", "data_issue", "other"]
    severity: Literal["low", "medium", "high"] = "medium"
    description: str = Field(min_length=5)
    screening_id: uuid.UUID | None = None
    patient_id: uuid.UUID | None = None


class FollowUpDoneIn(BaseModel):
    screening_id: uuid.UUID | None = None


class DevTokenIn(BaseModel):
    username: str
    role: str
    facility_code: str | None = None
