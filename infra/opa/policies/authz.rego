# OralScreen authorisation policy (Open Policy Agent).
#
# Layer 1 of 2: WHAT a role may do (this file).
# Layer 2 of 2: WHICH ROWS it may touch — enforced by PostgreSQL row-level security.
#
# Input:  {"subject": {"role", "user_id", "facility_id", "patient_scope"},
#          "action":  "screening:create",
#          "resource": {...attributes used by attribute-based rules...}}
# Output: data.oralscreen.authz.decision = {"allow": bool, "reasons": [..]}
package oralscreen.authz

import rego.v1

default allow := false

permissions := {
	"asha": {
		"staff:me", "patient:create", "patient:read", "patient:update", "consent:record", "consent:withdraw",
		"screening:create", "screening:read", "image:upload", "referral:read", "card:issue",
		"timeline:read", "timeline:write", "medication:record", "followup:read", "model:read",
		"incident:report", "notification:read",
	},
	"nurse": {
		"staff:me", "patient:create", "patient:read", "patient:update", "consent:record", "consent:withdraw",
		"screening:create", "screening:read", "image:upload", "referral:read", "referral:update",
		"card:issue", "timeline:read", "timeline:write", "medication:record", "followup:read",
		"model:read", "incident:report", "fhir:read", "notification:read",
	},
	"specialist": {
		"staff:me", "patient:read", "screening:read", "referral:read", "referral:update", "timeline:read",
		"timeline:write", "review:queue", "review:submit", "rules:read", "rules:propose", "model:read",
		"incident:report", "fhir:read", "notification:read",
	},
	"clinical_lead": {
		"staff:me", "patient:read", "patient:update", "screening:read", "referral:read", "referral:update",
		"timeline:read", "review:queue", "review:submit", "review:resolve", "followup:read",
		"analytics:read", "rules:read", "rules:propose", "rules:approve", "model:read", "model:retrain",
		"model:promote", "model:rollback", "model:shadow", "governance:read", "governance:write",
		"incident:report", "incident:manage", "audit:read", "audit:verify", "fhir:read",
		"consent:withdraw", "notification:read",
	},
	"district_officer": {
		"staff:me", "analytics:read", "rules:read", "model:read", "governance:read", "incident:report",
		"notification:read",
	},
	"admin": {
		"staff:me", "analytics:read", "rules:read", "model:read", "model:retrain", "governance:read",
		"governance:write", "incident:report", "incident:manage", "audit:read", "audit:verify",
		"admin:ops", "notification:read",
	},
	"provider": {"patient:read", "timeline:read", "timeline:write", "medication:record", "referral:read"},
}

role_allows if input.action in permissions[input.subject.role]

# A local doctor (Provider Connect) may only act on the single patient their OTP-approved token covers.
provider_scope_ok if input.subject.role != "provider"

provider_scope_ok if {
	input.subject.role == "provider"
	input.resource.patient_id == input.subject.patient_scope
}

# Maker-checker: the person approving a rule change must not be the person who proposed it.
maker_checker_ok if not input.action in {"rules:approve"}

maker_checker_ok if {
	input.action == "rules:approve"
	input.resource.proposed_by != input.subject.user_id
}

# Staff with a facility-bound role must have a facility in their token.
facility_ok if not input.subject.role in {"asha", "nurse", "specialist"}

facility_ok if {
	input.subject.role in {"asha", "nurse", "specialist"}
	input.subject.facility_id != ""
}

allow if {
	role_allows
	provider_scope_ok
	maker_checker_ok
	facility_ok
}

reasons contains "role not permitted for this action" if not role_allows

reasons contains "provider token is limited to one patient" if not provider_scope_ok

reasons contains "maker-checker: you cannot approve your own proposal" if not maker_checker_ok

reasons contains "account is not linked to a facility" if not facility_ok

decision := {"allow": allow, "reasons": reasons}
