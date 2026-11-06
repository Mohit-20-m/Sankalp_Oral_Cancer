"""Transparent, versioned decision engine.

A rule set is DATA (stored in rule_sets, approved by maker-checker). The engine
1. computes named facts from the screening (+ AI results + timeline),
2. evaluates every rule (simple JSON conditions),
3. returns the most severe matching level, ALL reasons, and the actions to take.

Fail-safe: if AI results are missing the outcome is NEEDS_REVIEW — never LOW.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field, field_validator

SEVERITY = {"LOW": 0, "MEDIUM": 1, "NEEDS_REVIEW": 2, "CANNOT_ASSESS": 3, "HIGH": 4}

# names usable in rule_set["lesion"]["supporting_signs"] -> human-readable text for reasons
SUPPORTING_SIGNS = {"habit_high": "high-risk habits", "patch_noticed": "patch noticed by patient",
                    "ulcer_not_healing": "ulcer not healing", "opening_restricted": "restricted mouth opening",
                    "burning": "burning sensation", "previous_high": "previous high-risk screening"}

DEFAULT_RULE_SET: dict = {
    "name": "Arogya default triage rules",
    "habit_scoring": {
        "weights": {"tobacco": 3, "alcohol": 2, "areca": 2, "years_over_10": 1, "burning": 2,
                    "difficulty_opening": 1},
        "levels": {"high": 5, "moderate": 3},
    },
    "mouth_opening": {"restricted_mm": 35.0, "borderline_mm": 40.0, "iris_mm": 11.7, "card_mm": 85.6,
                      "max_head_angle_deg": 12, "calibration": {"slope": 1.0, "intercept": 0.0}},
    "lesion": {"threshold": None, "threshold_source": "model_screening", "min_sites_for_cannot_assess": 3,
               # An AI flag becomes HIGH (auto-referral) only together with one of these signs; otherwise a
               # specialist looks at the photos first (R1b). See SUPPORTING_SIGNS in build_facts for the names.
               "supporting_signs": ["habit_high", "patch_noticed", "ulcer_not_healing", "opening_restricted",
                                    "previous_high"]},
    "persistence_days": 14,
    "followup_days": {"HIGH": 90, "MEDIUM": 120, "LOW": 365, "CANNOT_ASSESS": 30, "NEEDS_REVIEW": 7},
    "referral_due_days": 14,
    "rules": [
        # AI rules are suppressed when too many photos are unusable: R6 (CANNOT_ASSESS) decides instead.
        {"id": "R1", "level": "HIGH",
         "reason": "Suspicious patch detected by AI ({lesion_sites}) with other warning signs ({supporting_signs})",
         "when": {"all": [{"fact": "lesion_suspicious", "eq": True}, {"fact": "too_many_unusable", "eq": False},
                          {"fact": "has_supporting_signs", "eq": True}]}},
        {"id": "R1b", "level": "NEEDS_REVIEW",
         "reason": "AI flagged {lesion_sites} but there are no other warning signs — a specialist will check "
                   "the photos before any referral",
         "when": {"all": [{"fact": "lesion_suspicious", "eq": True}, {"fact": "too_many_unusable", "eq": False},
                          {"fact": "has_supporting_signs", "eq": False}]}},
        # high score on a photo that failed the quality check or looks unlike the training photos: not trusted for an
        # automatic referral -> retake, then a doctor checks (a LOW score on such a photo simply counts as low)
        {"id": "R1c", "level": "NEEDS_REVIEW",
         "reason": "AI score is high on an unclear photo ({unreliable_sites}) — it will be retaken or checked by a doctor",
         "when": {"all": [{"fact": "unreliable_flag", "eq": True}, {"fact": "too_many_unusable", "eq": False}]}},
        {"id": "R2", "level": "HIGH", "reason": "Restricted mouth opening ({opening_mm} mm) with burning — OSMF signs",
         "when": {"all": [{"fact": "opening_restricted", "eq": True}, {"fact": "burning", "eq": True}]}},
        {"id": "R3", "level": "HIGH",
         "reason": "Patch or sore present for {patch_days} days (≥ {persistence_days}) — must be checked",
         "when": {"all": [{"fact": "patch_days", "gte_fact": "persistence_days"}]}},
        {"id": "R4", "level": "HIGH",
         "reason": "Pain relieved by {masking_medication} but findings persist — relief can hide disease",
         "when": {"all": [{"fact": "masked_symptom", "eq": True}]}},
        {"id": "R5", "level": "HIGH", "reason": "Symptoms returned after previous high-risk screening",
         "when": {"all": [{"fact": "symptoms_returned", "eq": True}, {"fact": "previous_high", "eq": True}]}},
        {"id": "R6", "level": "CANNOT_ASSESS", "reason": "Photos could not be assessed reliably ({unusable_sites} sites)",
         "when": {"all": [{"fact": "ai_available", "eq": True}, {"fact": "too_many_unusable", "eq": True}]}},
        {"id": "R7", "level": "NEEDS_REVIEW", "reason": "AI result not available yet — never treated as low risk",
         "when": {"all": [{"fact": "ai_available", "eq": False}]}},
        {"id": "R8", "level": "MEDIUM", "reason": "High-risk habits ({habit_factors})",
         "when": {"all": [{"fact": "habit_level", "eq": "high"}]}},
        {"id": "R9", "level": "MEDIUM", "reason": "Borderline mouth opening ({opening_mm} mm)",
         "when": {"all": [{"fact": "opening_borderline", "eq": True}]}},
        {"id": "R10", "level": "MEDIUM", "reason": "Restricted mouth opening ({opening_mm} mm)",
         "when": {"all": [{"fact": "opening_restricted", "eq": True}]}},
    ],
    "actions": {
        "HIGH": ["create_referral", "specialist_review", "schedule_checkin", "schedule_followup", "notify_patient"],
        "CANNOT_ASSESS": ["specialist_review", "schedule_followup"],
        "NEEDS_REVIEW": ["retry_ai", "schedule_followup"],
        "MEDIUM": ["schedule_followup", "habit_counselling"],
        "LOW": ["schedule_followup", "habit_counselling"],
    },
}


# ───────────────────────── validation of proposed rule sets ─────────────────────────
class Condition(BaseModel):
    fact: str
    eq: Any = None
    ne: Any = None
    gte: float | None = None
    lte: float | None = None
    gt: float | None = None
    lt: float | None = None
    gte_fact: str | None = None
    is_in: list | None = Field(default=None, alias="in")


class Rule(BaseModel):
    id: str
    level: str
    reason: str
    when: dict

    @field_validator("level")
    @classmethod
    def _lvl(cls, v):
        if v not in SEVERITY:
            raise ValueError(f"level must be one of {list(SEVERITY)}")
        return v

    @field_validator("when")
    @classmethod
    def _when(cls, v):
        if not (set(v) <= {"all", "any"}) or not v:
            raise ValueError("'when' must contain 'all' and/or 'any'")
        for group in v.values():
            for c in group:
                Condition.model_validate(c)
        return v


class RuleSetDef(BaseModel):
    name: str
    habit_scoring: dict
    mouth_opening: dict
    lesion: dict
    persistence_days: int = 14
    followup_days: dict
    referral_due_days: int = 14
    rules: list[Rule]
    actions: dict

    @field_validator("lesion")
    @classmethod
    def _known_signs(cls, v):
        unknown = set(v.get("supporting_signs") or []) - set(SUPPORTING_SIGNS)
        if unknown:
            raise ValueError(f"unknown supporting_signs {sorted(unknown)}; allowed: {sorted(SUPPORTING_SIGNS)}")
        return v

    @field_validator("rules")
    @classmethod
    def _must_keep_failsafe(cls, rules):
        # Safety invariant: a rule set may not remove the "AI missing => NEEDS_REVIEW" fail-safe.
        ok = any(r.level in ("NEEDS_REVIEW", "HIGH", "CANNOT_ASSESS")
                 and any(c.get("fact") == "ai_available" and c.get("eq") is False
                         for c in r.when.get("all", []) + r.when.get("any", [])) for r in rules)
        if not ok:
            raise ValueError("rule set must keep the fail-safe: ai_available == false must not become LOW")
        return rules


def rule_set_sha(defn: dict) -> str:
    return hashlib.sha256(json.dumps(defn, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# ───────────────────────── evaluation ─────────────────────────
def _cond_ok(c: dict, facts: dict) -> bool:
    v = facts.get(c["fact"])
    if "eq" in c and v != c["eq"]:
        return False
    if "ne" in c and v == c["ne"]:
        return False
    for op, fn in (("gte", lambda a, b: a >= b), ("lte", lambda a, b: a <= b), ("gt", lambda a, b: a > b),
                   ("lt", lambda a, b: a < b)):
        if op in c:
            if v is None or not fn(v, c[op]):
                return False
    if "gte_fact" in c:
        other = facts.get(c["gte_fact"])
        if v is None or other is None or v < other:
            return False
    if "in" in c and v not in c["in"]:
        return False
    return True


def _match(when: dict, facts: dict) -> bool:
    ok_all = all(_cond_ok(c, facts) for c in when.get("all", []))
    ok_any = True if "any" not in when else any(_cond_ok(c, facts) for c in when["any"])
    return ok_all and ok_any


class _SafeDict(dict):
    def __missing__(self, k):
        return "?"


def evaluate(rule_set: dict, facts: dict) -> dict:
    matched = [r for r in rule_set["rules"] if _match(r["when"], facts)]
    level = max((r["level"] for r in matched), key=lambda lv: SEVERITY[lv], default="LOW")
    reasons = [{"rule": r["id"], "level": r["level"], "text": r["reason"].format_map(_SafeDict(facts))}
               for r in sorted(matched, key=lambda r: -SEVERITY[r["level"]])]
    if not reasons:
        reasons = [{"rule": "DEFAULT", "level": "LOW", "text": "No warning signs found"}]
    return {"risk_level": level, "reasons": reasons, "actions": rule_set["actions"].get(level, []),
            "followup_days": rule_set["followup_days"].get(level, 365),
            "referral_due_days": rule_set.get("referral_due_days", 14),
            "disclaimer": "Screening aid only — not a diagnosis. A specialist confirms every high-risk result."}


def build_facts(*, rule_set: dict, habit_level: str, habit_factors: list[str], symptoms: dict,
                opening_mm: float | None, ai: dict | None, timeline: dict) -> dict:
    """ai = {"available": bool, "max_prob": float, "threshold": float, "site_probs": {site: p},
             "unusable_sites": [...], "ood_sites": [...]}
    timeline = {"patch_days": int|None, "masking_medication": str|None, "pain_relieved": bool,
                "symptoms_returned": bool, "previous_high": bool}"""
    mo = rule_set["mouth_opening"]
    ai = ai or {"available": False}
    thr = rule_set["lesion"].get("threshold") or ai.get("threshold") or 0.5
    site_probs = ai.get("site_probs") or {}
    suspicious_sites = [s for s, p in site_probs.items() if p is not None and p >= thr]
    lesion_suspicious = bool(ai.get("available")) and bool(suspicious_sites)
    restricted = opening_mm is not None and opening_mm < mo["restricted_mm"]
    borderline = opening_mm is not None and mo["restricted_mm"] <= opening_mm < mo["borderline_mm"]
    # "unusable" = no score at all (photo missing / could not be read). Unclear or unusual photos still have a score:
    # a low one counts as low, a high one is an "unreliable flag" (rule R1c), see pipeline.pick_sites.
    unusable = sorted(set(ai.get("unusable_sites") or []))
    unreliable = sorted((ai.get("unreliable_flag_sites") or {}).keys())
    finding_persists = lesion_suspicious or restricted or bool(symptoms.get("patch_noticed"))
    masked = bool(timeline.get("pain_relieved") and timeline.get("masking_medication") and finding_persists)
    patch_days = timeline.get("patch_days")
    if patch_days is None and symptoms.get("patch_duration_days") is not None:
        patch_days = int(symptoms["patch_duration_days"])
    # warning signs that, together with an AI flag, justify an automatic referral (names listed in the rule set)
    signs = {"habit_high": habit_level == "high", "patch_noticed": bool(symptoms.get("patch_noticed")),
             "ulcer_not_healing": bool(symptoms.get("ulcer_not_healing")), "opening_restricted": restricted,
             "burning": bool(symptoms.get("burning")), "previous_high": bool(timeline.get("previous_high"))}
    wanted = rule_set["lesion"].get("supporting_signs", list(SUPPORTING_SIGNS))
    present = [n for n in wanted if signs.get(n)]
    return {
        "ai_available": bool(ai.get("available")),
        "lesion_score": ai.get("max_prob"),
        "lesion_threshold": thr,
        "lesion_suspicious": lesion_suspicious,
        "lesion_sites": ", ".join(s.replace("_", " ") for s in suspicious_sites) or "none",
        "lesion_site_count": len(suspicious_sites),
        "suspicious_sites": suspicious_sites,
        "unreliable_flag": bool(ai.get("available")) and bool(unreliable),
        "unreliable_site_list": unreliable,
        "unreliable_sites": ", ".join(s.replace("_", " ") for s in unreliable) or "none",
        "has_supporting_signs": bool(present),
        "supporting_signs": ", ".join(SUPPORTING_SIGNS.get(n, n) for n in present) or "none",
        "unusable_sites": len(unusable),
        "too_many_unusable": len(unusable) >= rule_set["lesion"].get("min_sites_for_cannot_assess", 3),
        "opening_mm": opening_mm,
        "opening_restricted": restricted,
        "opening_borderline": borderline,
        "burning": bool(symptoms.get("burning")),
        "habit_level": habit_level,
        "habit_factors": ", ".join(habit_factors) or "none",
        "patch_days": patch_days,
        "persistence_days": rule_set.get("persistence_days", 14),
        "masked_symptom": masked,
        "masking_medication": timeline.get("masking_medication") or "medication",
        "symptoms_returned": bool(timeline.get("symptoms_returned")),
        "previous_high": bool(timeline.get("previous_high")),
    }
