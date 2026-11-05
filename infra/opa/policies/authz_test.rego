package oralscreen.authz_test

import rego.v1

import data.oralscreen.authz

test_asha_can_create_screening if {
	authz.allow with input as {"subject": {"role": "asha", "user_id": "u1", "facility_id": "f1"}, "action": "screening:create", "resource": {}}
}

test_asha_cannot_review if {
	not authz.allow with input as {"subject": {"role": "asha", "user_id": "u1", "facility_id": "f1"}, "action": "review:submit", "resource": {}}
}

test_district_officer_no_patient_read if {
	not authz.allow with input as {"subject": {"role": "district_officer", "user_id": "u9", "facility_id": ""}, "action": "patient:read", "resource": {}}
}

test_maker_checker_blocks_self_approval if {
	not authz.allow with input as {"subject": {"role": "clinical_lead", "user_id": "lead1", "facility_id": ""}, "action": "rules:approve", "resource": {"proposed_by": "lead1"}}
}

test_maker_checker_allows_other if {
	authz.allow with input as {"subject": {"role": "clinical_lead", "user_id": "lead2", "facility_id": ""}, "action": "rules:approve", "resource": {"proposed_by": "lead1"}}
}

test_provider_scoped_to_one_patient if {
	authz.allow with input as {"subject": {"role": "provider", "user_id": "p", "patient_scope": "pat1"}, "action": "timeline:read", "resource": {"patient_id": "pat1"}}
	not authz.allow with input as {"subject": {"role": "provider", "user_id": "p", "patient_scope": "pat1"}, "action": "timeline:read", "resource": {"patient_id": "pat2"}}
}

test_specialist_needs_facility if {
	not authz.allow with input as {"subject": {"role": "specialist", "user_id": "s", "facility_id": ""}, "action": "review:queue", "resource": {}}
}
