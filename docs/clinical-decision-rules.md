# Clinical decision rules

The lesion model never decides on its own. Its output is one input to a **versioned, human-approved rule set**
that combines it with habits, symptoms, mouth opening and the patient's history. This document describes the
default rule set and the safeguards around it.

> The cut-offs below are a starting point and must be confirmed by an oral medicine specialist before clinical use.

## 1. Photo quality gate

Run in the browser at capture time and again on the server (same algorithm and thresholds), on the photo shrunk
to 640 px, centre region:

| Check | Rejects when |
|---|---|
| Sharpness (variance of the Laplacian) | below 15 |
| Brightness (mean luminance) | below 45 or above 215 |
| Glare (share of near-white pixels) | above 6 % |
| Mouth tissue (share of pink / red pixels) | below 12 % |

The sharpness cut-off was calibrated on the model's held-out clinical photographs: it rejects about 3.5 % of them.
Smooth mucosa and lesions have little texture, so a stricter cut-off rejects many good photos.

## 2. One score per mouth site

Six sites are scored (left and right buccal mucosa, tongue dorsum and ventral surface, gums, palate); the
open-mouth face photo is used only for mouth opening.

| Photo | Counts as |
|---|---|
| Passed the quality gate and looks like the training photos | its probability |
| Unclear or unusual photo, probability **below** the threshold | low (its probability) |
| Unclear or unusual photo, probability **at or above** the threshold | *unreliable flag* (not trusted for auto-referral) |
| Missing or unreadable | unusable |

"Unusual" means the photo's embedding is far from the training distribution (Mahalanobis distance above the
threshold exported with the model in `ood_stats.npz`). After a retake, the newest reliable photo of a site wins; an unclear retake never hides an
earlier reliable flag.

The threshold is the model's **screening** operating point (0.78 for model v1.0.0), tuned for at least 90 %
sensitivity on calibration data.

## 3. Rules

| Rule | Level | Condition |
|---|---|---|
| R1 | HIGH | AI flags a reliable photo **and** at least one supporting sign is present |
| R1b | NEEDS_REVIEW | AI flags a reliable photo, no supporting sign (retake first, then specialist) |
| R1c | NEEDS_REVIEW | Unreliable flag: high score on an unclear or unusual photo (retake first, then specialist) |
| R2 | HIGH | Mouth opening below 35 mm **and** burning sensation (signs of oral submucous fibrosis) |
| R3 | HIGH | Patch or sore present for 14 days or more |
| R4 | HIGH | Pain relieved by a medicine known to mask symptoms while the finding persists |
| R5 | HIGH | Symptoms returned after a previous high-risk screening |
| R6 | CANNOT_ASSESS | 3 or more sites unusable (AI rules R1 to R1c do not fire) |
| R7 | NEEDS_REVIEW | AI result not available (fail-safe: never LOW) |
| R8 | MEDIUM | High-risk habits |
| R9 | MEDIUM | Borderline mouth opening (35 to 40 mm) |
| R10 | MEDIUM | Restricted mouth opening (below 35 mm) |
| default | LOW | No rule matched |

**Supporting signs** (configurable in the rule set): high habit score, patch noticed by the patient, ulcer not
healing, restricted mouth opening, previous high-risk screening.

**Habit score** (weights): tobacco 3, alcohol 2, areca nut 2, habit for more than 10 years 1, burning 2,
difficulty opening 1. High from 5, moderate from 3.

The most severe matching rule determines the level (HIGH > CANNOT_ASSESS > NEEDS_REVIEW > MEDIUM > LOW). Every
matching rule is returned as a human-readable reason.

## 4. Mouth opening

Measured from the open-mouth face photo. The iris is about 11.7 mm wide in adults and is used as a ruler: the
browser locates both irises and the inner lips (MediaPipe Face Landmarker, on device), the worker can adjust the
points, and the server recomputes millimetres from the raw pixel readings and rejects implausible values
(outside 5 to 80 mm). Readings with head rotation above 12 degrees are flagged. This measures inter-lip distance,
an approximation of the clinical inter-incisal distance.

## 5. Retake before review

For R1b, R1c and R6 the result first asks the health worker to retake only the affected sites, once each, within
24 hours. A clean retake usually resolves the case as LOW; a still-flagged or unclear retake goes to the specialist
queue; if no retake arrives in time a scheduled job sends the case to the specialist.

## 6. Actions

| Level | Actions |
|---|---|
| HIGH | Referral to the nearest accepting facility, patient SMS, specialist task, 14-day check-in, follow-up in 90 days |
| CANNOT_ASSESS | Retake request, then specialist task; follow-up in 30 days |
| NEEDS_REVIEW | Retake request where applicable, then specialist task; follow-up in 7 days |
| MEDIUM | Habit counselling, follow-up in 120 days |
| LOW | Habit counselling, follow-up in 365 days; about 7 % randomly sampled for specialist audit |

When a specialist confirms a case that has no referral yet, the referral and SMS are created automatically.

## 7. Governance

- **Rule sets are data.** Each version is stored with its SHA-256; proposing and approving must be done by two
  different clinical leads (maker-checker, enforced by OPA).
- **The fail-safe cannot be removed.** A rule set without "AI unavailable must not be LOW" is rejected.
- **No silent downgrade.** If the patient has an open referral, automation never lowers the risk; only a specialist
  can.
- **Replayable.** Every decision stores its facts, rule-set version and hash, model version and head version.
  `POST /screenings/{id}/replay` re-evaluates the stored facts with the stored rule set and confirms the outcome.
