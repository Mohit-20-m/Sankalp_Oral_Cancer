"""Demo data so dashboards are not empty on first start. Idempotent (skips if demo patients exist).

* ~120 background screenings over the last 120 days across 10 villages — decided by the REAL rule engine on
  synthetic AI scores (no photos; flagged device.demo = true, trigger "seed") — for the district dashboard.
* Two story patients with no screening yet, ready for the live demo:
    - Shekhar (Kabaka, areca 15 y + tobacco) — the main ASHA → AI → referral → specialist journey;
    - Lalitha (Puttur) — a local doctor gave Mucopain gel 10 days ago; pain is gone but the patch is still there
      (the masked-symptom rule, R4).
"""
from __future__ import annotations

import random
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from ..domain.clinical import score_habits
from ..domain.decision import build_facts, evaluate
from ..models import (Consent, ConsentText, Decision, FollowUp, Medication, Patient, Referral, RuleSet, Screening,
                      TimelineEvent, Village)
from .demo_world import fid, uid

FIRST = ["Ramesh", "Suresh", "Ganesh", "Prakash", "Shankar", "Mohan", "Vasanth", "Harish", "Kiran", "Ravi",
         "Lakshmi", "Saraswathi", "Gowri", "Parvathi", "Kamala", "Vimala", "Sharada", "Leela", "Jayanthi", "Rukmini"]
LAST = ["Poojary", "Shetty", "Gowda", "Naik", "Bangera", "Salian", "Kotian", "Acharya", "Bhandary", "Moolya"]
VILLAGE_FACILITY = {"Puttur": "PHC-PUTTUR", "Kabaka": "PHC-PUTTUR", "Uppinangady": "PHC-PUTTUR",
                    "Vitla": "PHC-BANTWAL", "Belthangady": "PHC-BELTHANGADY", "Ujire": "PHC-BELTHANGADY",
                    "Sullia": "PHC-SULLIA", "Bellare": "PHC-SULLIA", "Bantwal": "PHC-BANTWAL",
                    "Kalladka": "PHC-BANTWAL"}
# hotspot: areca-growing villages get more heavy users (makes the DBSCAN hotspot visible)
VILLAGE_RISK = {"Kabaka": 0.75, "Uppinangady": 0.65, "Vitla": 0.6, "Bellare": 0.55}
SITES = ["left_buccal", "right_buccal", "tongue_dorsum", "tongue_ventral", "gums", "palate"]


def _display_id(rng: random.Random) -> str:
    return "DK-" + "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


def _consents(s, patient_id, lang: str, captured_by, ai_training: bool = True):
    for purpose in ("screening", "sharing", "ai_training"):
        txt = s.execute(select(ConsentText).where(ConsentText.purpose == purpose, ConsentText.language == lang)
                        .order_by(ConsentText.version.desc())).scalars().first()
        s.add(Consent(patient_id=patient_id, purpose=purpose, granted=ai_training if purpose == "ai_training" else True,
                      consent_text_id=txt.id, method="thumbprint", captured_by=captured_by))


def seed_demo(s) -> dict:
    if s.execute(select(Patient).where(Patient.display_id == "DK-SHEKAR")).scalars().first():
        return {"demo": "already seeded"}
    rng = random.Random(2026)
    rs = s.execute(select(RuleSet).where(RuleSet.status == "active")).scalars().first()
    rules = rs.definition
    villages = {v.name: v for v in s.execute(select(Village)).scalars()}
    now = datetime.now(timezone.utc)
    kavya = uuid.UUID(uid("kavya.asha"))
    omc = uuid.UUID(fid("OMC-MANGALURU"))
    counts: dict[str, int] = {}

    for i in range(120):
        vname = rng.choice(list(villages))
        v = villages[vname]
        fac = uuid.UUID(fid(VILLAGE_FACILITY[vname]))
        sex = rng.choice(["male", "male", "female"])
        first = rng.choice(FIRST[:10] if sex == "male" else FIRST[10:])
        p = Patient(display_id=_display_id(rng), full_name=f"{first} {rng.choice(LAST)}", sex=sex,
                    birth_year=rng.randint(1950, 1995), phone=None, language=rng.choice(["kn", "tcy", "kn"]),
                    village_id=v.id, facility_id=fac, created_by=kavya)
        s.add(p)
        s.flush()
        _consents(s, p.id, p.language, kavya, ai_training=rng.random() < 0.8)
        heavy = rng.random() < VILLAGE_RISK.get(vname, 0.35)
        habits = {"areca": heavy or rng.random() < 0.5, "tobacco": heavy and rng.random() < 0.7,
                  "alcohol": rng.random() < (0.4 if heavy else 0.15),
                  "areca_years": rng.randint(11, 30) if heavy else rng.randint(0, 10), "tobacco_years": 0}
        symptoms = {"burning": heavy and rng.random() < 0.25, "difficulty_opening": heavy and rng.random() < 0.2,
                    "patch_noticed": heavy and rng.random() < 0.2}
        opening = round(rng.gauss(33 if heavy and rng.random() < 0.2 else 45, 4), 1)
        base = 0.40 if heavy else 0.10
        site_probs = {st: round(min(0.99, max(0.01, rng.gauss(base, 0.13))), 3) for st in SITES}
        ai = {"available": True, "max_prob": max(site_probs.values()), "threshold": 0.62, "site_probs": site_probs,
              "unusable_sites": [st for st in SITES if rng.random() < 0.04], "ood_sites": []}
        score, lvl, factors = score_habits(habits, symptoms, rules["habit_scoring"])
        facts = build_facts(rule_set=rules, habit_level=lvl, habit_factors=factors, symptoms=symptoms,
                            opening_mm=opening, ai=ai, timeline={})
        out = evaluate(rules, facts)
        at = now - timedelta(days=rng.randint(1, 120), hours=rng.randint(0, 9))
        jitter = (rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01))
        scr = Screening(client_uuid=uuid.uuid4(), patient_id=p.id, facility_id=fac, worker_id=kavya, captured_at=at,
                        received_at=at, status="completed", habits=habits, symptoms=symptoms, habit_score=score,
                        habit_level=lvl, mouth_opening={"method": "manual", "readings": [{"mm": opening}]},
                        mouth_opening_mm=opening, device={"demo": True}, app_version="seed",
                        lat=v.lat + jitter[0], lon=v.lon + jitter[1], expected_images=0, ai_status="done",
                        lesion_score=ai["max_prob"], cannot_assess=out["risk_level"] == "CANNOT_ASSESS",
                        risk_level=out["risk_level"])
        s.add(scr)
        s.flush()
        d = Decision(screening_id=scr.id, rule_set_version=rs.version, rule_set_sha256=rs.sha256,
                     model_version="seed", head_version="seed", inputs={**facts, "demo": True}, outputs=out,
                     risk_level=out["risk_level"], trigger="seed", created_at=at)
        s.add(d)
        s.flush()
        scr.decision_id = d.id
        counts[out["risk_level"]] = counts.get(out["risk_level"], 0) + 1
        s.add(TimelineEvent(patient_id=p.id, occurred_at=at, kind="screening", source="asha",
                            summary=f"Screening (demo): {out['risk_level']}", data={"screening_id": str(scr.id)},
                            created_by="seed"))
        if out["risk_level"] == "HIGH":
            age = (now - at).days
            status = "completed" if age > 30 and rng.random() < 0.7 else "pending"
            ref = Referral(screening_id=scr.id, patient_id=p.id, facility_id=omc, from_facility_id=fac,
                           reason=out["reasons"][0]["text"], due_by=(at + timedelta(days=14)).date(),
                           token_jti=secrets.token_hex(16), status=status, created_at=at,
                           completed_at=at + timedelta(days=rng.randint(5, 25)) if status == "completed" else None,
                           outcome={"verdict": rng.choice(["confirm_refer", "needs_biopsy", "not_suspicious"]),
                                    "demo": True} if status == "completed" else None)
            s.add(ref)
        fu_days = int(rules["followup_days"][out["risk_level"]])
        s.add(FollowUp(patient_id=p.id, screening_id=scr.id, due_on=(at + timedelta(days=fu_days)).date(),
                       reason=f"{out['risk_level']} re-check"))

    # ── story patients (no screening yet: the live demo creates it through the API) ──
    shekhar = Patient(display_id="DK-SHEKAR", full_name="Shekhar Poojary", sex="male", birth_year=1974,
                      phone="+919000000001", language="tcy", village_id=villages["Kabaka"].id,
                      facility_id=uuid.UUID(fid("PHC-PUTTUR")), created_by=kavya)
    lalitha = Patient(display_id="DK-LALITH", full_name="Lalitha Shetty", sex="female", birth_year=1968,
                      phone="+919000000002", language="kn", village_id=villages["Puttur"].id,
                      facility_id=uuid.UUID(fid("PHC-PUTTUR")), created_by=kavya)
    s.add_all([shekhar, lalitha])
    s.flush()
    _consents(s, shekhar.id, "tcy", kavya)
    _consents(s, lalitha.id, "kn", kavya)
    ten_days = now - timedelta(days=10)
    ev = TimelineEvent(patient_id=lalitha.id, occurred_at=ten_days, kind="provider_visit", source="provider",
                       summary="Local clinic visit: mouth ulcer, given Mucopain gel; pain relieved",
                       data={"pain_relieved": True, "patch_noticed": True, "provider": "Local clinic (demo)"},
                       created_by="seed")
    s.add(ev)
    s.add(TimelineEvent(patient_id=lalitha.id, occurred_at=now - timedelta(days=18), kind="symptom_report",
                        source="asha", summary="White patch on left cheek noticed",
                        data={"patch_noticed": True}, created_by="seed"))
    s.flush()
    s.add(Medication(patient_id=lalitha.id, timeline_event_id=ev.id, name_entered="Mucopain gel",
                     name_matched="Mucopain", category="topical_anaesthetic", masks_symptoms=True, match_score=100,
                     prescribed_by="Local clinic (demo)", started_on=ten_days.date(), status="recorded",
                     created_at=ten_days))
    return {"demo": "seeded", "background_screenings": counts, "story_patients": ["DK-SHEKAR", "DK-LALITH"],
            "seeded_on": str(date.today())}
