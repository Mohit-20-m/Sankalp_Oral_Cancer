"""Decision engine: the clinical rules behave as specified, and safety invariants cannot be removed."""
import copy

import pytest
from pydantic import ValidationError

from app.domain.clinical import score_habits
from app.domain.decision import DEFAULT_RULE_SET as R, RuleSetDef, build_facts, evaluate, rule_set_sha

AI_CLEAN = {"available": True, "max_prob": 0.1, "threshold": 0.5,
            "site_probs": {s: 0.1 for s in ("left_buccal", "right_buccal", "gums")}, "unusable_sites": []}


def decide(habits=None, symptoms=None, opening=45.0, ai=AI_CLEAN, timeline=None):
    habits, symptoms = habits or {}, symptoms or {}
    _, lvl, factors = score_habits(habits, symptoms, R["habit_scoring"])
    facts = build_facts(rule_set=R, habit_level=lvl, habit_factors=factors, symptoms=symptoms, opening_mm=opening,
                        ai=ai, timeline=timeline or {})
    return evaluate(R, facts)


def test_clean_non_user_is_low():
    assert decide()["risk_level"] == "LOW"


AI_FLAG = {**AI_CLEAN, "max_prob": 0.9, "site_probs": {"left_buccal": 0.9, "gums": 0.1}}


def test_ai_lesion_with_warning_sign_is_high():
    out = decide(ai=AI_FLAG, habits={"areca": True, "tobacco": True, "areca_years": 15})
    assert out["risk_level"] == "HIGH" and out["reasons"][0]["rule"] == "R1"
    assert "left buccal" in out["reasons"][0]["text"] and "high-risk habits" in out["reasons"][0]["text"]
    assert "create_referral" in out["actions"]


@pytest.mark.parametrize("symptoms,timeline,opening", [
    ({"patch_noticed": True}, None, 45.0),
    ({"ulcer_not_healing": True}, None, 45.0),
    ({}, {"previous_high": True}, 45.0),
    ({}, None, 30.0),
])
def test_ai_lesion_supported_by_each_sign_is_high(symptoms, timeline, opening):
    out = decide(ai=AI_FLAG, symptoms=symptoms, timeline=timeline, opening=opening)
    assert out["risk_level"] == "HIGH" and any(r["rule"] == "R1" for r in out["reasons"])


def test_ai_only_flag_goes_to_specialist_not_auto_referral():
    out = decide(ai=AI_FLAG)
    assert out["risk_level"] == "NEEDS_REVIEW" and out["reasons"][0]["rule"] == "R1b"
    assert "left buccal" in out["reasons"][0]["text"]
    assert "create_referral" not in out["actions"]


def test_burning_alone_does_not_confirm_ai_flag():
    assert decide(ai=AI_FLAG, symptoms={"burning": True})["risk_level"] == "NEEDS_REVIEW"


def test_ai_flag_with_too_many_missing_photos_is_cannot_assess_not_high():
    ai = {**AI_FLAG, "unusable_sites": ["right_buccal", "palate", "tongue_dorsum"]}
    out = decide(ai=ai, habits={"areca": True, "tobacco": True, "areca_years": 15})
    assert out["risk_level"] == "CANNOT_ASSESS"
    assert not any(r["rule"] in ("R1", "R1b") for r in out["reasons"])


def test_clinical_high_still_wins_over_cannot_assess():
    ai = {**AI_CLEAN, "unusable_sites": ["left_buccal", "right_buccal", "gums"]}
    assert decide(ai=ai, symptoms={"patch_duration_days": 20})["risk_level"] == "HIGH"


def _pick(images, probs, bad=(), ood=(), thr=0.78):
    from app.services.pipeline import pick_sites
    return pick_sites(images, probs, set(bad), set(ood), thr)


def test_clean_retake_replaces_flagged_original():
    # newest first: retake "r" (clean) then original "o" (flagged)
    p = _pick([("left_buccal", "r"), ("left_buccal", "o")], {"r": 0.1, "o": 0.96})
    assert p["site_probs"] == {"left_buccal": 0.1} and not p["unreliable_flag_sites"] and not p["unusable_sites"]


def test_unclear_retake_never_hides_reliable_flag():
    for bad, ood in ((["r"], []), ([], ["r"])):
        p = _pick([("left_buccal", "r"), ("left_buccal", "o")], {"r": 0.1, "o": 0.96}, bad, ood)
        assert p["site_probs"] == {"left_buccal": 0.96}


def test_low_score_on_unclear_photo_counts_as_low_high_score_is_unreliable():
    p = _pick([("palate", "p"), ("gums", "g"), ("tongue_ventral", "t"), ("left_buccal", "x")],
              {"p": 0.9, "g": 0.3, "t": 0.03}, bad=["g"], ood=["p"])
    assert p["site_probs"] == {"gums": 0.3, "tongue_ventral": 0.03}       # low on blurry gums -> low
    assert p["unreliable_flag_sites"] == {"palate": 0.9}                  # high on unusual photo -> not trusted
    assert p["unusable_sites"] == ["left_buccal"]                         # no score at all
    assert p["low_quality_sites"] == ["gums", "palate"]


def test_unclear_high_score_goes_to_review_never_auto_referral():
    ai = {**AI_CLEAN, "unreliable_flag_sites": {"palate": 0.9}}
    out = decide(ai=ai, habits={"areca": True, "tobacco": True, "areca_years": 15})
    assert out["risk_level"] == "NEEDS_REVIEW" and out["reasons"][0]["rule"] == "R1c"
    assert "create_referral" not in out["actions"]


def test_unclear_low_scores_give_low():
    ai = {**AI_CLEAN, "unusable_sites": [], "site_probs": {s: 0.1 for s in ("left_buccal", "right_buccal", "gums",
                                                                             "palate", "tongue_dorsum")}}
    assert decide(ai=ai)["risk_level"] == "LOW"


def test_suspicious_sites_fact_lists_flagged_sites():
    _, lvl, f = score_habits({}, {}, R["habit_scoring"])
    facts = build_facts(rule_set=R, habit_level=lvl, habit_factors=f, symptoms={}, opening_mm=45.0,
                        ai=AI_FLAG, timeline={})
    assert facts["suspicious_sites"] == ["left_buccal"]


def test_unknown_supporting_sign_rejected():
    bad = copy.deepcopy(R)
    bad["lesion"]["supporting_signs"] = ["habit_high", "typo_sign"]
    with pytest.raises(ValidationError):
        RuleSetDef.model_validate(bad)


def test_osmf_signs_restricted_opening_plus_burning():
    assert decide(symptoms={"burning": True}, opening=30.0)["risk_level"] == "HIGH"
    assert decide(symptoms={"burning": False}, opening=30.0)["risk_level"] != "LOW"


def test_two_week_rule():
    assert decide(symptoms={"patch_duration_days": 15})["risk_level"] == "HIGH"
    assert decide(symptoms={"patch_duration_days": 5})["risk_level"] == "LOW"


def test_masked_symptom_rule():
    out = decide(symptoms={"patch_noticed": True},
                 timeline={"pain_relieved": True, "masking_medication": "Mucopain"})
    assert out["risk_level"] == "HIGH" and any(r["rule"] == "R4" for r in out["reasons"])


def test_ai_unavailable_is_never_low():
    assert decide(ai={"available": False})["risk_level"] == "NEEDS_REVIEW"


def test_too_many_bad_photos_cannot_assess():
    ai = {**AI_CLEAN, "unusable_sites": ["left_buccal", "right_buccal", "gums"]}
    assert decide(ai=ai)["risk_level"] == "CANNOT_ASSESS"


def test_heavy_habits_medium():
    out = decide(habits={"areca": True, "tobacco": True, "areca_years": 15})
    assert out["risk_level"] == "MEDIUM"


def test_failsafe_cannot_be_removed():
    bad = copy.deepcopy(R)
    bad["rules"] = [r for r in bad["rules"] if r["id"] != "R7"]
    with pytest.raises(ValidationError):
        RuleSetDef.model_validate(bad)


def test_rule_set_hash_is_stable_and_sensitive():
    assert rule_set_sha(R) == rule_set_sha(copy.deepcopy(R))
    other = copy.deepcopy(R)
    other["persistence_days"] = 21
    assert rule_set_sha(other) != rule_set_sha(R)
