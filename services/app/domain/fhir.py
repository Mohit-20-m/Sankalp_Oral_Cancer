"""HL7 FHIR R4 (R4B models) resources for interoperability with ABDM / hospital systems.
Every resource is validated by fhir.resources before it leaves the API."""
from __future__ import annotations

from datetime import datetime, timezone

from fhir.resources.R4B.auditevent import AuditEvent
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.capabilitystatement import CapabilityStatement
from fhir.resources.R4B.consent import Consent
from fhir.resources.R4B.diagnosticreport import DiagnosticReport
from fhir.resources.R4B.encounter import Encounter
from fhir.resources.R4B.medicationstatement import MedicationStatement
from fhir.resources.R4B.observation import Observation
from fhir.resources.R4B.patient import Patient
from fhir.resources.R4B.servicerequest import ServiceRequest

from ..config import get_settings

ABHA_SYSTEM = "https://healthid.ndhm.gov.in"
LOCAL_ID_SYSTEM = "https://oralscreen.local/patient-id"
CS = "https://oralscreen.local/fhir/CodeSystem"
LOINC = "http://loinc.org"
SNOMED = "http://snomed.info/sct"


def _ts(v: datetime | None) -> str | None:
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()


def _ref(kind: str, rid) -> dict:
    return {"reference": f"{kind}/{rid}"}


def patient(p) -> dict:
    ids = [{"system": LOCAL_ID_SYSTEM, "value": p.display_id}]
    if p.abha_id:
        ids.append({"system": ABHA_SYSTEM, "value": p.abha_id})
    res = {"resourceType": "Patient", "id": str(p.id), "identifier": ids, "active": p.deleted_at is None,
           "name": [{"text": p.full_name}], "gender": {"male": "male", "female": "female"}.get(p.sex, "other"),
           "communication": [{"language": {"coding": [{"system": "urn:ietf:bcp:47", "code": p.language}]}}]}
    if p.birth_year:
        res["birthDate"] = str(p.birth_year)
    if p.phone:
        res["telecom"] = [{"system": "phone", "value": p.phone, "use": "mobile"}]
    return Patient.model_validate(res).model_dump(mode="json", exclude_none=True)


def observations(s) -> list[dict]:
    out = []
    base = {"resourceType": "Observation", "status": "final", "subject": _ref("Patient", s.patient_id),
            "effectiveDateTime": _ts(s.captured_at),
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                      "code": "exam"}]}]}
    if s.mouth_opening_mm is not None:
        out.append({**base, "id": f"{s.id}-mouth-opening",
                    "code": {"coding": [{"system": CS, "code": "interincisal-opening",
                                         "display": "Maximal interincisal mouth opening"}],
                             "text": "Mouth opening"},
                    "valueQuantity": {"value": s.mouth_opening_mm, "unit": "mm", "system": "http://unitsofmeasure.org",
                                      "code": "mm"}})
    if s.habit_score is not None:
        out.append({**base, "id": f"{s.id}-habit-risk",
                    "code": {"coding": [{"system": CS, "code": "oral-habit-risk-score",
                                         "display": "Areca/tobacco/alcohol habit risk score"}]},
                    "valueInteger": s.habit_score,
                    "interpretation": [{"text": s.habit_level or ""}]})
    if s.lesion_score is not None:
        out.append({**base, "id": f"{s.id}-lesion-ai",
                    "code": {"coding": [{"system": CS, "code": "ai-lesion-refer-probability",
                                         "display": "AI probability that photos need specialist review"}]},
                    "valueQuantity": {"value": round(s.lesion_score, 4), "unit": "probability"},
                    "note": [{"text": "Decision-support output only; not a diagnosis."}]})
    return [Observation.model_validate(o).model_dump(mode="json", exclude_none=True) for o in out]


def diagnostic_report(s, decision) -> dict:
    res = {"resourceType": "DiagnosticReport", "id": str(s.id), "status": "final" if s.risk_level else "preliminary",
           "code": {"coding": [{"system": CS, "code": "oral-screening", "display": "Oral pre-cancer screening"}]},
           "subject": _ref("Patient", s.patient_id), "effectiveDateTime": _ts(s.captured_at),
           "result": [_ref("Observation", o["id"]) for o in observations(s)],
           "conclusion": (f"Screening risk level: {s.risk_level}. "
                          + "; ".join(r["text"] for r in (decision.outputs.get("reasons", []) if decision else []))
                          + " — Screening aid only, not a diagnosis.") if s.risk_level else None}
    return DiagnosticReport.model_validate(res).model_dump(mode="json", exclude_none=True)


def service_request(r) -> dict:
    res = {"resourceType": "ServiceRequest", "id": str(r.id),
           "status": {"pending": "active", "booked": "active", "visited": "active", "completed": "completed",
                      "cancelled": "revoked"}[r.status],
           "intent": "order", "priority": "urgent" if r.priority == "high" else "routine",
           "code": {"text": "Oral medicine specialist review"}, "subject": _ref("Patient", r.patient_id),
           "authoredOn": _ts(r.created_at), "performer": [_ref("Organization", r.facility_id)],
           "reasonCode": [{"text": r.reason}],
           "occurrencePeriod": {"end": r.due_by.isoformat()}}
    return ServiceRequest.model_validate(res).model_dump(mode="json", exclude_none=True)


def medication_statement(m) -> dict:
    res = {"resourceType": "MedicationStatement", "id": str(m.id), "status": "active" if m.status != "ocr_failed"
           else "unknown", "subject": _ref("Patient", m.patient_id),
           "medicationCodeableConcept": {"text": m.name_matched or m.name_entered or "unidentified medicine"},
           "dateAsserted": _ts(m.created_at)}
    if m.started_on:
        res["effectiveDateTime"] = m.started_on.isoformat()
    if m.prescribed_by:
        res["informationSource"] = {"display": m.prescribed_by}
    return MedicationStatement.model_validate(res).model_dump(mode="json", exclude_none=True)


def encounter(e) -> dict:
    res = {"resourceType": "Encounter", "id": str(e.id), "status": "finished",
           "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB",
                     "display": "ambulatory"},
           "subject": _ref("Patient", e.patient_id), "period": {"start": _ts(e.occurred_at)},
           "reasonCode": [{"text": e.summary}]}
    return Encounter.model_validate(res).model_dump(mode="json", exclude_none=True)


def consent(c) -> dict:
    res = {"resourceType": "Consent", "id": str(c.id),
           "status": "inactive" if c.withdrawn_at else ("active" if c.granted else "rejected"),
           "scope": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/consentscope",
                                 "code": "patient-privacy" if c.purpose != "screening" else "treatment"}]},
           "category": [{"text": c.purpose}], "patient": _ref("Patient", c.patient_id),
           "dateTime": _ts(c.captured_at),
           "policy": [{"authority": "https://www.meity.gov.in/data-protection-framework",
                       "uri": "urn:oralscreen:dpdp-2023"}],
           "provision": {"type": "permit" if c.granted and not c.withdrawn_at else "deny"}}
    return Consent.model_validate(res).model_dump(mode="json", exclude_none=True)


def audit_event(a) -> dict:
    res = {"resourceType": "AuditEvent", "id": str(a.id),
           "type": {"system": "http://dicom.nema.org/resources/ontology/DCM", "code": "110110",
                    "display": "Patient Record"},
           "action": "R" if a.action.startswith(("read", "view")) else "C" if "create" in a.action else "U",
           "recorded": _ts(a.ts), "outcome": "0",
           "agent": [{"who": {"display": f"{a.actor_role}:{a.actor_id}"}, "requestor": True}],
           "source": {"observer": {"display": "Arogya API"}},
           "entity": [{"what": {"display": f"{a.entity_type}/{a.entity_id}"},
                       "detail": [{"type": "hash", "valueString": a.hash}]}]}
    return AuditEvent.model_validate(res).model_dump(mode="json", exclude_none=True)


def bundle(entries: list[dict], kind: str = "searchset") -> dict:
    res = {"resourceType": "Bundle", "type": kind, "total": len(entries),
           "entry": [{"resource": e, "fullUrl": f"{get_settings().fhir_base_url}/{e['resourceType']}/{e['id']}"}
                     for e in entries]}
    return Bundle.model_validate(res).model_dump(mode="json", exclude_none=True)


def capability_statement() -> dict:
    types = ["Patient", "Observation", "DiagnosticReport", "ServiceRequest", "MedicationStatement", "Encounter",
             "Consent", "AuditEvent"]
    res = {"resourceType": "CapabilityStatement", "status": "active", "date": _ts(datetime.now(timezone.utc)),
           "kind": "instance", "fhirVersion": "4.3.0", "format": ["json"],
           "software": {"name": "Arogya FHIR facade"},
           "rest": [{"mode": "server", "resource": [{"type": t, "interaction": [{"code": "read"},
                                                                               {"code": "search-type"}]}
                                                    for t in types]}]}
    return CapabilityStatement.model_validate(res).model_dump(mode="json", exclude_none=True)
