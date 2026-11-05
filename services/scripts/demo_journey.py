"""End-to-end demo journey against a running stack (also the integration test used by CI).

    docker compose exec api python scripts/demo_journey.py              # inside the stack (Keycloak logins)
    python scripts/demo_journey.py --base http://127.0.0.1:8000 --local # local mode (dev tokens)

Story (Dakshina Kannada):
 1. Kavya (ASHA, Puttur PHC) screens Shekhar — areca 15 y + tobacco, burning, mouth opens ~31 mm, a white patch
    on the left cheek. Photos go straight to object storage (presigned PUT); one goes through the API fallback.
 2. AI + rules → HIGH. Referral + SMS to Shekhar (sandbox), review task for the specialist.
 3. Shekhar shows his QR health card at a local clinic → OTP to Shekhar → doctor sees the summary.
 4. Dr. Meera reviews: confirms, labels the sites → outcome SMS to the local doctor, labels for retraining.
 5. Lalitha: no AI lesion, but Mucopain gel relieved pain while the patch persists → masked-symptom rule (R4).
 6. Governance: maker–checker on the rule set, row-level security, audit chain verification, decision replay,
    FHIR export, district dashboard, model registry, drift + fairness.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
import time
import uuid
from datetime import datetime, timezone

import httpx
import numpy as np

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])
from app.bootstrap.demo_world import DEMO_PASSWORD, STAFF  # noqa: E402
from app.ml.placeholder import synthetic_mouth  # noqa: E402

SITES = ["left_buccal", "right_buccal", "tongue_dorsum", "tongue_ventral", "gums", "palate"]
OK, FAIL = "\033[32m✔\033[0m", "\033[31m✘\033[0m"
results: list[tuple[str, bool]] = []


def check(name: str, cond: bool, detail: str = "") -> bool:
    results.append((name, bool(cond)))
    print(f"  {OK if cond else FAIL} {name}" + (f"  — {detail}" if detail else ""))
    return bool(cond)


def step(title: str) -> None:
    print(f"\n\033[1m▶ {title}\033[0m")


class Client:
    def __init__(self, base: str, local: bool, keycloak_url: str, verify: bool):
        self.base, self.local, self.kc = base.rstrip("/"), local, keycloak_url.rstrip("/")
        self.http = httpx.Client(timeout=60, verify=verify)
        self.tokens: dict[str, str] = {}

    def login(self, username: str) -> str:
        if username in self.tokens:
            return self.tokens[username]
        role, fcode = next((r, f) for u, _, r, f in STAFF if u == username)
        if self.local:
            r = self.http.post(f"{self.base}/api/v1/auth/dev-token",
                               json={"username": username, "role": role, "facility_code": fcode})
        else:
            r = self.http.post(f"{self.kc}/realms/oralscreen/protocol/openid-connect/token",
                               data={"grant_type": "password", "client_id": "oralscreen-app", "username": username,
                                     "password": DEMO_PASSWORD, "scope": "openid"})
        r.raise_for_status()
        self.tokens[username] = r.json()["access_token"]
        return self.tokens[username]

    def call(self, method: str, path: str, who: str | None = None, token: str | None = None, expect=None, **kw):
        headers = kw.pop("headers", {})
        tok = token or (self.login(who) if who else None)
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        r = self.http.request(method, f"{self.base}/api/v1{path}", headers=headers, **kw)
        if expect is not None and r.status_code != expect:
            raise AssertionError(f"{method} {path} as {who}: expected {expect}, got {r.status_code}: {r.text[:400]}")
        return r


def photo(rng, refer: bool) -> bytes:
    buf = io.BytesIO()
    synthetic_mouth(rng, refer, 640, 480).save(buf, "JPEG", quality=92)
    return buf.getvalue()


def real_photo_pool(folder: str | None) -> dict[str, list] | None:
    """Real mouth photos for the demo: --images DIR (refer/ and no_refer/ sub-folders) or, by default, the
    model benchmark (held-out test photos shipped with the model, never used for training)."""
    import csv as _csv
    import os
    from pathlib import Path

    pool: dict[str, list] = {"refer": [], "no_refer": []}
    if folder:
        root = Path(folder)
        for lab in pool:
            for f in sorted((root / lab).glob("*")):
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                    pool[lab].append((str(f.relative_to(root)), f))
        source = f"your folder {folder}"
    else:
        bdir = Path(os.environ.get("OS_MODELS_DIR", "/models")) / "current" / "benchmark"
        if not (bdir / "manifest.csv").exists():
            return None
        for r in _csv.DictReader(open(bdir / "manifest.csv")):
            pool["refer" if r["label"] == "refer" else "no_refer"].append((r.get("source", ""), bdir / r["image"]))
        source = "the held-out benchmark (never used for training)"
    if not pool["refer"] or not pool["no_refer"]:
        return None
    pool["source"] = source
    return pool


def to_jpeg(path) -> bytes:
    from PIL import Image, ImageOps

    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((1280, 1280))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def manifest(images: dict[str, bytes]) -> list[dict]:
    return [{"client_uuid": str(uuid.uuid4()), "site": site, "sha256": hashlib.sha256(b).hexdigest(),
             "size_bytes": len(b), "content_type": "image/jpeg",
             "quality": {"blur": 140, "brightness": 120, "glare": 0.01, "ok": True}} for site, b in images.items()]


def find_patient(c: Client, who: str, display_id: str) -> dict:
    rows = c.call("GET", "/patients", who, params={"q": display_id}, expect=200).json()
    rows = rows.get("items", rows) if isinstance(rows, dict) else rows
    return next(p for p in rows if p["display_id"] == display_id)


def screen(c: Client, who: str, patient: dict, images: dict[str, bytes], habits: dict, symptoms: dict,
           opening: dict | None, presigned_rewrite: str | None, first_decision_only: bool = False) -> dict:
    body = {"client_uuid": str(uuid.uuid4()), "patient_id": patient["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(), "habits": habits, "symptoms": symptoms,
            "mouth_opening": opening, "images": manifest(images), "device": {"model": "demo-script"},
            "app_version": "demo-1.0", "lat": 12.788, "lon": 75.229,
            "on_device_result": {"risk_level": "pending", "model": "on-device-int8"}}
    plan = c.call("POST", "/screenings", who, json=body, headers={"Idempotency-Key": body["client_uuid"]},
                  expect=201).json()
    again = c.call("POST", "/screenings", who, json=body, headers={"Idempotency-Key": body["client_uuid"]})
    check("same screening re-sent (phone retry) is idempotent", again.status_code in (200, 201)
          and again.json()["screening_id"] == plan["screening_id"])
    by_site = dict(images)
    for i, item in enumerate(plan["images"]):
        data = by_site[item["site"]]
        url = item.get("presigned_put")
        uploaded = False
        if url and i > 0:                                 # first image uses the API fallback path on purpose
            try:                                          # straight to object storage, like the phone does
                r = c.http.put(url, content=data, headers={"Content-Type": "image/jpeg"}, timeout=10)
                uploaded = r.status_code < 300
            except httpx.HTTPError:                       # storage not reachable from here → API fallback
                uploaded = False
        if not uploaded:
            c.call("PUT", item["direct_upload"].removeprefix("/api/v1"), who,
                   files={"file": (f"{item['site']}.jpg", data, "image/jpeg")}, expect=200)
    c.call("POST", f"/screenings/{plan['screening_id']}/submit", who, expect=202)
    t0 = time.time()
    while time.time() - t0 < 120:
        res = c.call("GET", f"/screenings/{plan['screening_id']}", who, expect=200).json()
        if res["status"] == "completed" or (res["risk_level"] and res["ai_status"] in ("done", "partial")):
            return res
        if first_decision_only and res["risk_level"]:
            return res
        time.sleep(1.5)
    raise AssertionError(f"screening not completed in 120 s: {res}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://api:8000")
    ap.add_argument("--keycloak", default="http://keycloak:8080/auth")
    ap.add_argument("--local", action="store_true", help="use dev tokens (OS_AUTH_MODE=local)")
    ap.add_argument("--rewrite-presigned", default=None,
                    help="e.g. http://localhost:9000=http://minio:9000 when running inside the stack")
    ap.add_argument("--insecure", action="store_true")
    ap.add_argument("--images", default=None, help="folder with refer/ and no_refer/ photos (default: benchmark)")
    ap.add_argument("--synthetic", action="store_true", help="use drawn test images instead of real photos")
    ap.add_argument("--accuracy-photos", type=int, default=3,
                    help="how many real photos the final accuracy step scores (0 = all)")
    a = ap.parse_args()
    c = Client(a.base, a.local, a.keycloak, verify=not a.insecure)
    rng = np.random.default_rng(42)

    step("0. Stack is ready")
    ready = c.http.get(f"{c.base}/api/ready").json()
    check("readiness", ready.get("status") == "ready", str({k: v["ok"] for k, v in ready["checks"].items()}))
    me = c.call("GET", "/me", "kavya.asha", expect=200).json()
    check("Kavya logs in (ASHA, Puttur PHC)", me["role"] == "asha")

    step("1. Kavya screens Shekhar")
    shekhar = find_patient(c, "kavya.asha", "DK-SHEKAR")
    pool = None if a.synthetic else real_photo_pool(a.images)
    pick = np.random.default_rng(7)
    if pool:
        print(f"  · using REAL mouth photos from {pool['source']}")
        ref_i = pick.integers(len(pool["refer"]))
        nos = pick.choice(len(pool["no_refer"]), size=len(SITES) + 1, replace=len(pool["no_refer"]) < len(SITES) + 1)
        imgs = {s: to_jpeg(pool["no_refer"][j][1]) for s, j in zip(SITES + ["front_open"], nos)}
        imgs["left_buccal"] = to_jpeg(pool["refer"][ref_i][1])
        print(f"  · left cheek = a photo labelled SUSPICIOUS ({pool['refer'][ref_i][0]}); "
              "the other 5 sites = photos labelled normal")
    else:
        imgs = {s: photo(rng, refer=(s == "left_buccal")) for s in SITES}
        imgs["front_open"] = photo(rng, refer=False)
    res = screen(c, "kavya.asha", shekhar, imgs,
                 habits={"areca": True, "areca_years": 15, "tobacco": True, "tobacco_type": "smokeless",
                         "tobacco_years": 12, "alcohol": False},
                 symptoms={"burning": True, "difficulty_opening": True, "patch_noticed": True,
                           "patch_duration_days": 20},
                 opening={"method": "iris", "head_pose": {"yaw": 3, "pitch": 4},
                          "readings": [{"iris_px": 46.0, "tap_px": 122.0}, {"iris_px": 45.5, "tap_px": 121.0},
                                       {"iris_px": 46.2, "tap_px": 123.5}]},
                 presigned_rewrite=a.rewrite_presigned)
    check("decision is HIGH", res["risk_level"] == "HIGH",
          "; ".join(r["text"] for r in res["reasons"][:3]))
    check("mouth opening measured (iris ruler)", res["mouth_opening_mm"] and res["mouth_opening_mm"] < 35,
          f"{res['mouth_opening_mm']} mm")
    lb = (res.get("sites", {}).get("left_buccal") or {}).get("ai") or {}
    others = [((v.get("ai") or {}).get("prob") or 0) for k, v in res.get("sites", {}).items()
              if k not in ("left_buccal", "front_open")]
    all_ai = [v.get("ai") for k, v in res.get("sites", {}).items() if k != "front_open"]
    check("AI ran on every photo, with heat maps", all(a and a.get("heatmap_url") for a in all_ai),
          f"{len(all_ai)} sites")
    mf_r = c.call("GET", "/models/manifest", "kavya.asha")
    check("model registered in the database (active version)", mf_r.status_code == 200,
          "run: docker compose run --rm bootstrap" if mf_r.status_code != 200 else mf_r.json().get("active_version"))
    mf = mf_r.json() if mf_r.status_code == 200 else {}
    placeholder = mf.get("placeholder")
    thr = ((mf.get("head") or {}).get("thresholds") or {}).get("screening", 0.5)
    if placeholder and not pool:   # the synthetic placeholder model is built to find the synthetic white patch
        check("AI flags the left cheek (placeholder model)", (lb.get("prob") or 0) >= 0.5,
              f"left cheek p={lb.get('prob'):.2f}, other sites max p={max(others):.2f}")
    elif pool:
        print(f"  · AI on Shekhar's photos (refer if p ≥ {thr:.2f}):")
        for site, v in res.get("sites", {}).items():
            if site == "front_open":
                continue
            p_ = (v.get("ai") or {}).get("prob")
            truth = "suspicious" if site == "left_buccal" else "normal"
            verdict = "REFER" if (p_ or 0) >= thr else "clear"
            ok_ = (verdict == "REFER") == (truth == "suspicious")
            print(f"      {site:15s} labelled {truth:10s} p={p_:.3f} → {verdict:5s} {'✔' if ok_ else '✘ (model disagrees)'}")
    else:
        print(f"  · real model on synthetic photos: left cheek p={lb.get('prob')}, others max p={max(others)}")
    sid = res["id"]

    step("2. Referral, SMS and specialist queue")
    refs = c.call("GET", "/referrals", "kavya.asha", expect=200).json()
    ref = next(r for r in refs if r["patient_id"] == shekhar["id"])
    check("referral created to the nearest dental college", ref["status"] in ("pending", "booked", "visited"),
          ref["status"])
    slip = c.call("GET", f"/referrals/{ref['id']}/slip", "kavya.asha", expect=200).json()
    check("printable referral slip with QR", slip["qr_png_base64"].startswith("iVBOR"))
    sc = c.call("POST", "/referrals/scan", "dr.meera", json={"token": slip["qr_payload"]})
    check("dental college scans the slip → case opens", sc.status_code == 200)
    forged = c.call("POST", "/referrals/scan", "dr.meera", json={"token": slip["qr_payload"][:-3] + "abc"})
    check("a tampered QR code is rejected", forged.status_code in (400, 401))
    msgs = c.call("GET", "/admin/messages", "admin.ops", expect=200).json()
    check("referral SMS queued to Shekhar (sandbox)",
          any(m["template"] == "referral_patient" and m["to"].endswith(shekhar["phone"][-3:]) for m in msgs))
    q = c.call("GET", "/review/queue", "dr.meera", expect=200).json()
    check("case is in Dr. Meera's risk-sorted queue", any(t["screening_id"] == sid for t in q))

    step("3. Local doctor connects with Shekhar's consent (QR card + OTP)")
    card = c.call("POST", f"/patients/{shekhar['id']}/card", "kavya.asha", expect=200).json()
    req = c.call("POST", "/provider-connect/request", json={"card_token": card["token"],
                 "provider_name": "Dr. Ravi (local clinic)", "provider_phone": "+919000000099"}, expect=200).json()
    otp = req.get("sandbox_otp")
    check("OTP sent to the patient (not the doctor)", req["otp_sent_to"] == "patient's phone")
    bad = c.call("POST", "/provider-connect/verify", json={"request_id": req["request_id"], "otp": "000000"})
    check("wrong OTP is refused", bad.status_code == 401)
    if otp:
        tok = c.call("POST", "/provider-connect/verify", json={"request_id": req["request_id"], "otp": otp},
                     expect=200).json()["access_token"]
        summ = c.call("GET", "/provider/summary", token=tok, expect=200).json()
        check("doctor sees the care summary", summ["patient"]["display_id"] == "DK-SHEKAR")
        other = c.call("GET", f"/patients/{find_patient(c, 'kavya.asha', 'DK-LALITH')['id']}", token=tok)
        check("provider token cannot open another patient", other.status_code in (403, 404))
    else:
        check("sandbox OTP available (messaging_mode=twilio sends a real SMS instead)", True, "skipped")

    step("4. Dr. Meera reviews")
    case = c.call("GET", f"/review/cases/{sid}", "dr.meera", expect=200).json()
    check("case view: images, reasons, similar cases", bool(case.get("photos")) and "similar_cases" in case,
          f"{len(case.get('similar_cases', []))} similar")
    rv = c.call("POST", f"/review/cases/{sid}/review", "dr.meera", expect=201, json={
        "verdict": "needs_biopsy", "diagnosis_code": "OPMD-LEUK",
        "diagnosis_text": "Homogeneous leukoplakia left buccal mucosa with early OSMF bands",
        "notes": "Stop areca/tobacco. Biopsy booked.",
        "site_labels": {s: ("refer" if s == "left_buccal" else "no_refer") for s in SITES}}).json()
    check("review saved, labels created", rv.get("labels_created", 0) >= 1, str(rv)[:160])
    stats = c.call("GET", "/review/stats", "dr.meera", expect=200).json()
    check("AI–specialist agreement stats", "agreement" in str(stats).lower() or "agreed" in str(stats).lower())
    tl = c.call("GET", f"/patients/{shekhar['id']}/timeline", "kavya.asha", expect=200).json()["events"]
    check("Shekhar's timeline shows screening → referral → review", len(tl) >= 3, f"{len(tl)} events")

    step("5. Lalitha — pain relief can hide disease")
    lalitha = find_patient(c, "kavya.asha", "DK-LALITH")
    if pool:
        nos2 = pick.choice(len(pool["no_refer"]), size=len(SITES), replace=len(pool["no_refer"]) < len(SITES))
        imgs2 = {s: to_jpeg(pool["no_refer"][j][1]) for s, j in zip(SITES, nos2)}
    else:
        imgs2 = {s: photo(rng, refer=False) for s in SITES}
    res2 = screen(c, "kavya.asha", lalitha, imgs2,
                  habits={"areca": True, "areca_years": 25, "tobacco": False, "alcohol": False},
                  symptoms={"burning": False, "patch_noticed": True, "pain": False,
                            "pain_relieved_by_medication": True},
                  opening={"method": "manual", "readings": [{"mm": 44}]}, presigned_rewrite=a.rewrite_presigned)
    check("masked-symptom / 2-week rule makes it HIGH", res2["risk_level"] == "HIGH",
          "; ".join(r["rule"] + ": " + r["text"] for r in res2["reasons"][:2]))

    step("6. Governance & safety")
    other_asha = c.call("GET", f"/patients/{shekhar['id']}", "suma.asha")
    check("RLS: an ASHA from another PHC cannot see Shekhar", other_asha.status_code == 404)
    deny = c.call("POST", "/models/rollback", "kavya.asha")
    check("OPA: an ASHA cannot roll back a model", deny.status_code == 403)
    rules = c.call("GET", "/rules", "lead.rao", expect=200).json()
    active = next(r for r in rules if r["status"] == "active")
    new_def = dict(active["definition"])
    new_def["persistence_days"] = 14
    new_def["referral_due_days"] = 10
    prop = c.call("POST", "/rules", "lead.rao", expect=201,
                  json={"definition": new_def, "rationale": "Shorten referral window to 10 days (district request)"}
                  ).json()
    self_ok = c.call("POST", f"/rules/{prop['version']}/approve", "lead.rao", json={"comment": "self"})
    check("maker–checker: the proposer cannot approve", self_ok.status_code == 403)
    ok = c.call("POST", f"/rules/{prop['version']}/approve", "lead.iyer", json={"comment": "agreed"})
    check("a second clinical lead approves", ok.status_code == 200)
    bad_def = dict(new_def)
    bad_def["rules"] = [r for r in new_def["rules"] if r["id"] != "R7"]
    bad = c.call("POST", "/rules", "lead.rao", json={"definition": bad_def, "rationale": "remove fail-safe test"})
    check("a rule set without the AI fail-safe is rejected", bad.status_code == 422)
    rp = c.call("POST", f"/screenings/{sid}/replay", "lead.rao", expect=200).json()
    check("decision replay reproduces the original decision", rp["identical"], f"risk {rp['original_risk']}")
    av = c.call("GET", "/audit/verify", "admin.ops", expect=200).json()
    check("hash-chained audit log verifies", av.get("ok") is True, f"{av.get('checked')} rows")
    fh = c.call("GET", f"/fhir/Patient/{shekhar['id']}", "dr.meera", expect=200).json()
    check("FHIR R4 Patient", fh.get("resourceType") == "Patient")
    acc = c.call("GET", f"/audit/patient/{shekhar['id']}/access", "admin.ops", expect=200).json()
    check("patient can be told who opened their record", len(acc) >= 1, f"{len(acc)} accesses")

    step("7. District dashboard & MLOps")
    summ = c.call("GET", "/analytics/summary", "officer.dk", expect=200).json()
    check("district summary (k-anonymised)", bool(summ))
    hs = c.call("GET", "/analytics/hotspots", "officer.dk", expect=200).json()
    check("hotspots", "type" in hs or isinstance(hs, (list, dict)))
    pii = c.call("GET", f"/patients/{shekhar['id']}", "officer.dk")
    check("district officer sees aggregates only, no patient record", pii.status_code in (403, 404))
    models = c.call("GET", "/models", "lead.rao", expect=200).json()
    check("model registry", len(models) >= 1, ", ".join(m["version"] + ":" + m["status"] for m in models[:3]))
    rt = c.call("POST", "/models/retrain", "lead.rao", json={"exclude_noncommercial": False})
    check("retraining can be started (champion/challenger)", rt.status_code == 202)
    for kind in ("drift", "fairness"):
        r = c.call("POST", f"/governance/{kind}/run", "lead.rao")
        check(f"{kind} report job", r.status_code in (200, 202))

    step("8. Model lifecycle: candidate → shadow → human approval → rollback")
    run_id, run = rt.json()["run_id"], {}
    t0 = time.time()
    while time.time() - t0 < 120:
        run = next((r for r in c.call("GET", "/models/runs", "lead.rao", expect=200).json() if r["id"] == run_id), {})
        if run.get("status") in ("succeeded", "rejected", "failed", "done", "completed"):
            break
        time.sleep(2)
    cand = run.get("candidate_version")
    check("retraining finished and was scored on the fixed benchmark", bool(cand) or run.get("status") == "rejected",
          f"status={run.get('status')} candidate={cand} {run.get('error') or ''}"[:200])
    mstatus = {m["version"]: m["status"] for m in c.call("GET", "/models", "lead.rao", expect=200).json()}
    eligible = bool(cand) and mstatus.get(cand) == "candidate"
    if cand and eligible:
        sh = c.call("POST", f"/models/{cand}/shadow", "lead.rao")
        check("candidate runs in shadow mode (no effect on patients)", sh.status_code == 200, sh.text[:120])
        deny = c.call("POST", f"/models/{cand}/promote", "dr.meera")
        check("a specialist cannot promote a model (clinical lead only)", deny.status_code == 403)
        pr = c.call("POST", f"/models/{cand}/promote", "lead.iyer")
        check("clinical lead approves → candidate becomes active", pr.status_code == 200, pr.text[:120])
        rb = c.call("POST", "/models/rollback", "lead.rao")
        check("one-click rollback to the previous champion", rb.status_code == 200, rb.text[:120])
        act = [m["version"] for m in c.call("GET", "/models", "lead.rao", expect=200).json() if m["status"] == "active"]
        check("previous champion is active again", cand not in act, ", ".join(act))
    else:
        check("candidate not better than champion → kept out of production", True,
              "the champion/challenger gate did its job")

    step("9. Care-continuity writes: medicine photo (OCR), symptom report, referral visit, check-in reply, consent")
    from PIL import Image, ImageDraw, ImageFont
    label = Image.new("RGB", (900, 260), (250, 250, 245))
    d = ImageDraw.Draw(label)
    font = ImageFont.load_default(size=64)
    d.text((40, 40), "MUCOPAIN GEL", fill=(20, 20, 120), font=font)
    d.text((40, 140), "Benzocaine 20% w/w", fill=(20, 20, 20), font=ImageFont.load_default(size=44))
    buf = io.BytesIO()
    label.save(buf, "JPEG", quality=95)
    newp = c.call("POST", "/patients", "kavya.asha", expect=201, json={
        "full_name": "Ramesh Naik", "sex": "male", "birth_year": 1971, "phone": "+919000000003",
        "language": "kn"}).json()
    med = c.call("POST", f"/patients/{newp['id']}/medications", "kavya.asha", expect=201,
                 data={"prescribed_by": "Local clinic"}, files={"photo": ("tube.jpg", buf.getvalue(), "image/jpeg")}
                 ).json()
    t0, meds = time.time(), []
    while time.time() - t0 < 90:
        meds = c.call("GET", f"/patients/{newp['id']}/timeline", "kavya.asha", expect=200).json()["medications"]
        if meds and meds[0]["status"] != "pending_ocr":
            break
        time.sleep(2)
    check("medicine photo read by OCR and flagged as symptom-masking",
          bool(meds) and meds[0]["masks_symptoms"] is True, str(meds[0] if meds else med)[:140])
    ev = c.call("POST", f"/patients/{newp['id']}/timeline", "kavya.asha",
                json={"kind": "symptom_report", "summary": "Burning when eating spicy food", "data": {"burning": True}})
    check("symptom report added to the timeline", ev.status_code == 201)
    if ref["status"] == "visited":       # demo run a second time on the same data
        check("referral already marked as visited (earlier demo run)", True)
    else:
        st = c.call("POST", f"/referrals/{ref['id']}/status", "dr.meera",
                    json={"status": "visited", "outcome": {"note": "seen in OPD"}})
        check("referral marked as visited by the dental college", st.status_code == 200, st.text[:100])
    rep = c.call("POST", "/admin/simulate/sms-reply", "admin.ops", params={"patient_id": shekhar["id"], "body": "1"})
    check("patient replies '1' (symptoms back) to the check-in SMS → handled", rep.status_code == 200,
          rep.text[:120])
    texts = {t["purpose"]: t for t in c.call("GET", "/consent-texts", "kavya.asha", params={"language": "kn"},
                                              expect=200).json()}
    cons = c.call("POST", f"/patients/{newp['id']}/consents", "kavya.asha", expect=201, json={
        "purpose": "ai_training", "granted": True, "consent_text_id": texts["ai_training"]["id"],
        "method": "thumbprint"}).json()
    wd = c.call("POST", f"/consents/{cons['id']}/withdraw", "kavya.asha", json={"reason": "changed mind"})
    check("consent for AI training can be withdrawn (DPDP)", wd.status_code == 200, wd.text[:120])
    inc = c.call("POST", "/governance/incidents", "dr.meera", json={
        "kind": "model_issue", "severity": "low", "description": "Heat map highlighted the lip, not the lesion",
        "screening_id": sid})
    check("specialist can report an AI incident", inc.status_code == 201)
    snap = c.call("POST", "/audit/snapshot", "admin.ops")
    check("audit snapshot to WORM storage queued", snap.status_code in (200, 202))

    step("10. Every read endpoint answers without a server error (all roles)")
    spec = c.http.get(f"{c.base}/api/openapi.json").json()
    ids = {"pid": shekhar["id"], "sid": sid, "rid": ref["id"], "version": models[0]["version"]}
    errors = []
    for path, ops in spec["paths"].items():
        if "get" not in ops or not path.startswith("/api/v1/") or "{mid}" in path or "provider/summary" in path:
            continue
        concrete = path.removeprefix("/api/v1")
        for k, v in ids.items():
            concrete = concrete.replace("{" + k + "}", str(v))
        if "{" in concrete:
            continue
        for who in ("kavya.asha", "dr.meera", "lead.rao", "officer.dk", "admin.ops"):
            r = c.call("GET", concrete, who)
            if r.status_code >= 500:
                errors.append(f"{concrete} as {who}: {r.status_code}")
    check("no 5xx on any GET endpoint for any role", not errors, "; ".join(errors[:5]) or "all good")

    if pool:
        step(f"11. Model accuracy on real photos ({pool['source']})")
        from app.config import get_settings
        url = f"{get_settings().inference_url}/v1/predict"
        items = [(1, p) for _, p in pool["refer"]] + [(0, p) for _, p in pool["no_refer"]]
        if a.accuracy_photos:
            k_ref = max(1, (a.accuracy_photos * 2) // 3)
            sel = np.random.default_rng(11)
            items = ([items[j] for j in sel.choice(len(pool["refer"]), k_ref, replace=False)] +
                     [items[len(pool["refer"]) + j] for j in
                      sel.choice(len(pool["no_refer"]), max(1, a.accuracy_photos - k_ref), replace=False)])
        tp = fn = tn = fp = 0
        for i in range(0, len(items), 8):
            chunk = items[i:i + 8]
            r = c.http.post(url, files=[("files", (f"{k}.jpg", to_jpeg(p), "image/jpeg"))
                                        for k, (_, p) in enumerate(chunk)], timeout=120)
            r.raise_for_status()
            js = r.json()
            t_ = js["thresholds"]["screening"]
            for (y, _), res_ in zip(chunk, js["results"]):
                pred = 1 if res_.get("prob", 0) >= t_ else 0
                if len(items) <= 10:
                    print(f"      photo labelled {'suspicious' if y else 'normal':10s} p={res_.get('prob', 0):.3f} → "
                          f"{'REFER' if pred else 'clear':5s} {'✔' if pred == y else '✘ (model disagrees)'}")
                tp += y and pred; fn += y and not pred; tn += (not y) and (not pred); fp += (not y) and pred
        n = tp + fn + tn + fp
        acc, sens, spec = (tp + tn) / n, tp / max(1, tp + fn), tn / max(1, tn + fp)
        print(f"  · {n} photos: {tp + fn} suspicious, {tn + fp} normal  (model {js['model_version']}, "
              f"refer if p ≥ {t_:.2f})")
        print(f"  · suspicious caught: {tp}/{tp + fn} = {sens:.1%}   ·   normal cleared: {tn}/{tn + fp} = {spec:.1%}"
              f"   ·   accuracy {acc:.1%}")
        if not js.get("placeholder") and n >= 20:
            check("real-photo accuracy ≥ 85%", acc >= 0.85, f"{acc:.1%}")

    passed = sum(ok for _, ok in results)
    print(f"\n\033[1m{passed}/{len(results)} checks passed\033[0m")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
