"""One screening for a NEW patient, used by the chaos demo.

    python scripts/quick_screen.py [--local --base URL] [--expect NEEDS_REVIEW] [--wait-final 180]

Prints the decision right after submission, then (with --wait-final) waits until the AI result arrives —
e.g. after the inference service comes back — and prints the recalculated decision.
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid

import numpy as np

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])
from scripts.demo_journey import SITES, Client, photo  # noqa: E402
from scripts import demo_journey as dj  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://api:8000")
    ap.add_argument("--keycloak", default="http://keycloak:8080/auth")
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--rewrite-presigned", default=None)
    ap.add_argument("--expect", default=None)
    ap.add_argument("--wait-final", type=int, default=0)
    ap.add_argument("--insecure", action="store_true", help="accept the self-signed certificate")
    a = ap.parse_args()
    c = Client(a.base, a.local, a.keycloak, verify=False)
    rng = np.random.default_rng()
    p = c.call("POST", "/patients", "kavya.asha", expect=201, json={
        "full_name": f"Chaos Test {uuid.uuid4().hex[:4]}", "sex": "male", "birth_year": 1970,
        "phone": "+919000000050", "language": "kn"}).json()
    texts = {t["purpose"]: t for t in c.call("GET", "/consent-texts", "kavya.asha", params={"language": "kn"},
                                              expect=200).json()}
    for purpose in ("screening", "sharing", "ai_training"):
        c.call("POST", f"/patients/{p['id']}/consents", "kavya.asha", expect=201, json={
            "purpose": purpose, "granted": True, "consent_text_id": texts[purpose]["id"], "method": "thumbprint"})
    pool = dj.real_photo_pool(None)           # real held-out photos when the trained model is installed
    if pool:
        k = rng.integers(len(pool["refer"]))
        nos = rng.choice(len(pool["no_refer"]), size=len(SITES), replace=False)
        imgs = {s: dj.to_jpeg(pool["no_refer"][j][1]) for s, j in zip(SITES, nos)}
        imgs["left_buccal"] = dj.to_jpeg(pool["refer"][k][1])
    else:
        imgs = {s: photo(rng, refer=(s == "left_buccal")) for s in SITES}
    body_habits = {"areca": True, "areca_years": 12, "tobacco": True, "alcohol": False}
    first = dj.screen(c, "kavya.asha", p, imgs, body_habits, {"burning": False}, None, a.rewrite_presigned,
                      first_decision_only=True)
    print(f"first decision: {first['risk_level']} (ai_status={first['ai_status']}) — "
          + "; ".join(r["text"] for r in first["reasons"][:2]))
    ok = a.expect is None or first["risk_level"] == a.expect
    if a.wait_final:
        t0 = time.time()
        while time.time() - t0 < a.wait_final:
            r_ = c.call("GET", f"/screenings/{first['id']}", "kavya.asha")
            if r_.status_code != 200:          # a service is still restarting — keep waiting
                time.sleep(3)
                continue
            cur = r_.json()
            if cur["ai_status"] == "done":
                print(f"after recovery: {cur['risk_level']} (ai_status=done) — "
                      + "; ".join(r["text"] for r in cur["reasons"][:2]))
                return 0 if ok else 1
            time.sleep(3)
        print("AI result still pending (retry scheduled with exponential backoff)")
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
