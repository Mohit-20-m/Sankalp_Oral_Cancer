/**
 * REAL backend implementation (VITE_API_MODE=http): Arogya API /api/v1.
 * ───────────────────────────────────────────────────────────────────────────
 * Screens never call fetch directly; they use these functions. Field names are converted between the
 * backend (snake_case, its own site names) and the UI types here, in one place.
 */
import type { CaptureEvent, CaseDetail, GovernanceData, ProviderSummary, ReviewInput, Services, VisitPhotos } from "@/services/contracts";
import { ApiError, http, setEphemeralToken } from "@/services/api";
import { hasSession, logoutSession, passwordLogin } from "./session";
import type {
  AiResult,
  AppNotification,
  CapturedPhoto,
  HabitEntry,
  ModelVersion,
  Patient,
  QueueCase,
  Referral,
  RiskLevel,
  Role,
  RuleProposal,
  RuleThreshold,
  ScreeningDraft,
  SiteId,
  SymptomAnswers,
  User,
} from "@/types";

/* ───────────────────────── vocabulary mapping ───────────────────────── */
const SITE_TO_API: Record<SiteId, string> = {
  left_cheek: "left_buccal",
  right_cheek: "right_buccal",
  tongue_top: "tongue_dorsum",
  tongue_under: "tongue_ventral",
  gums: "gums",
  palate: "palate",
  open_mouth: "front_open",
};
const SITE_FROM_API = Object.fromEntries(Object.entries(SITE_TO_API).map(([a, b]) => [b, a])) as Record<string, SiteId>;
const UI_ROLES: Role[] = ["asha", "nurse", "specialist", "district_officer", "clinical_lead", "admin"];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ageFromYear = (y?: number | null) => (y ? new Date().getFullYear() - y : 0);
const initials = (n: string) =>
  n
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/* small caches for reference data */
let facilityNames: Record<string, string> | null = null;
let villageCache: { id: string; name: string; taluk: string }[] | null = null;
let thresholdCache: number | null = null;
let me: User | null = null;

async function facilities(): Promise<Record<string, string>> {
  facilityNames ??= Object.fromEntries((await http<Json[]>("/facilities")).map((f) => [f.id, f.name]));
  return facilityNames ?? {};
}
async function villages() {
  villageCache ??= (await http<Json[]>("/villages")).map((v) => ({ id: v.id, name: v.name, taluk: v.taluk }));
  return villageCache;
}
async function screeningThreshold() {
  if (thresholdCache == null) {
    try {
      const m = await http<Json>("/models/manifest");
      thresholdCache = Number(m?.head?.thresholds?.screening ?? 0.5);
    } catch {
      thresholdCache = 0.5;
    }
  }
  return thresholdCache;
}

async function loadMe(): Promise<User> {
  const m = await http<Json>("/me");
  if (!UI_ROLES.includes(m.role)) throw new ApiError(403, `The role "${m.role}" has no screen in this app`);
  const facs = await facilities().catch((): Record<string, string> => ({}));
  const fac = m.facility_id ? facs[m.facility_id] : undefined;
  const display = m.name || m.username;
  me = {
    id: m.user_id,
    name: m.username,
    displayName: display,
    role: m.role,
    facility: fac ?? (m.role === "district_officer" ? "District Health Office, DK" : m.role === "admin" ? "Platform operations" : "Clinical governance"),
    initials: initials(display),
  };
  return me;
}

/* ───────────────────────── helpers ───────────────────────── */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function toBlob(src: string): Promise<Blob> {
  return src.startsWith("data:") ? dataUrlToBlob(src) : await (await fetch(src)).blob();
}
async function sha256Hex(b: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const uuid = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Re-encode to ≤1600 px JPEG — phone photos are 12 MP; the model only needs a fraction of that. */
async function shrink(dataUrl: string, max = 1600): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1 && dataUrl.startsWith("data:image/jpeg")) return dataUrl;
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } catch {
    return dataUrl;
  }
}

/* ───────────────────────── patients ───────────────────────── */
const toPatient = (p: Json): Patient => ({
  id: p.id,
  displayId: p.displayId,
  name: p.name,
  age: p.age ?? 0,
  sex: p.sex,
  phone: (p.phone ?? "").replace(/^\+91/, ""),
  village: p.village,
  taluk: p.taluk,
  preferredLanguage: p.preferredLanguage,
  registeredAt: p.registeredAt,
  lastScreeningAt: p.lastScreeningAt ?? undefined,
  lastRisk: p.lastRisk ?? undefined,
  reviewed: p.reviewed,
  referralStatus: p.referralStatus ?? undefined,
  referralFacility: p.referralFacility ?? null,
});

/* ───────────────────────── screening ───────────────────────── */
function habitsToApi(hs: HabitEntry[]) {
  const by = Object.fromEntries(hs.map((h) => [h.kind, h])) as Record<string, HabitEntry>;
  const used = (h?: HabitEntry) => !!h && h.status !== "never";
  const form = (by.tobacco?.form ?? "").toLowerCase();
  return {
    areca: used(by.areca),
    areca_years: used(by.areca) ? by.areca.years ?? null : null,
    tobacco: used(by.tobacco),
    tobacco_type: !used(by.tobacco) ? "none" : /smok|beedi|cig/.test(form) ? (/chew|gutka|khaini/.test(form) ? "both" : "smoked") : "smokeless",
    tobacco_years: used(by.tobacco) ? by.tobacco.years ?? null : null,
    alcohol: used(by.alcohol),
    alcohol_frequency: !used(by.alcohol) ? "none" : (by.alcohol.perDay ?? 0) >= 1 ? "daily" : "occasional",
  };
}
function habitsFromApi(h: Json = {}): HabitEntry[] {
  return [
    { kind: "areca", status: h.areca ? "current" : "never", years: h.areca_years ?? undefined },
    { kind: "tobacco", status: h.tobacco ? "current" : "never", years: h.tobacco_years ?? undefined, form: h.tobacco_type && h.tobacco_type !== "none" ? h.tobacco_type : undefined },
    { kind: "alcohol", status: h.alcohol ? "current" : "never" },
  ];
}
const yes = (v: unknown) => v === "yes";
function symptomsToApi(s: SymptomAnswers) {
  return {
    burning: yes(s.burningSpicy),
    difficulty_opening: yes(s.difficultyOpening),
    patch_noticed: !!s.patches && s.patches !== "none",
    patch_duration_days: s.patchWeeks != null && s.patches && s.patches !== "none" ? Math.round(s.patchWeeks * 7) : null,
    pain: yes(s.pain),
    pain_relieved_by_medication: yes(s.takingMedicines),
    ulcer_not_healing: yes(s.nonHealingUlcer),
  };
}
function symptomsFromApi(s: Json = {}): SymptomAnswers {
  const yn = (b: unknown) => (b ? "yes" : "no") as "yes" | "no";
  return {
    burningSpicy: yn(s.burning),
    difficultyOpening: yn(s.difficulty_opening),
    patches: s.patch_noticed ? "white" : "none",
    patchWeeks: s.patch_duration_days != null ? Math.round(s.patch_duration_days / 7) : undefined,
    pain: yn(s.pain),
    nonHealingUlcer: yn(s.ulcer_not_healing),
    takingMedicines: yn(s.pain_relieved_by_medication),
  };
}

async function toAiResult(r: Json): Promise<AiResult> {
  const thr = await screeningThreshold();
  const sites = Object.entries((r.sites ?? {}) as Record<string, Json>).filter(([, v]) => v.ai);
  const scores = sites.map(([s, v]) => ({ site: SITE_FROM_API[s] ?? (s as SiteId), score: Number(v.ai.prob), flagged: Number(v.ai.prob) >= thr }));
  return {
    risk: (r.risk_level ?? "NEEDS_REVIEW") as RiskLevel,
    confidence: scores.length ? Math.max(...scores.map((x) => x.score)) : 0,
    modelVersion: sites[0]?.[1].ai.model_version ?? (r.ai_status === "unavailable" ? "AI unavailable — retrying" : "pending"),
    reasons: ((r.reasons ?? []) as Json[]).map((x) => x.text),
    siteScores: scores,
    preliminary: r.ai_status !== "done",
    retake: r.retake?.sites?.length
      ? { sites: (r.retake.sites as string[]).map((s) => SITE_FROM_API[s] ?? (s as SiteId)), deadline: r.retake.deadline }
      : undefined,
    aiOnlyFlag: !!r.ai_only_flag,
  };
}

/** Poll until the AI + rules have produced a result (fail-safe: if the AI is down the result is NEEDS_REVIEW,
 *  never LOW), then load the referral if one was created. */
async function awaitResult(sid: string): Promise<{ screeningId: string; result: AiResult; referral?: Referral }> {
  let r: Json = {};
  for (let i = 0; i < 50; i++) {
    r = await http<Json>(`/screenings/${sid}`);
    const settled = r.status !== "processing" && r.status !== "received";
    if (r.risk_level && settled && (r.ai_status === "done" || r.ai_status === "partial")) break;
    if (r.risk_level && r.ai_status === "unavailable" && i > 8) break;
    await sleep(1500);
  }
  const result = await toAiResult(r);
  let referral: Referral | undefined;
  if (r.referral?.id) referral = toReferral(await lookupReferral(`RF-${String(r.referral.id).replace(/-/g, "").slice(0, 8)}`));
  return { screeningId: sid, result, referral };
}

const REF_STATUS_TO_API: Record<string, string> = { booked: "booked", visited: "visited", completed: "completed", issued: "booked", overdue: "booked" };
const toReferral = (r: Json): Referral => ({
  code: r.code,
  patientId: r.patientId,
  patientName: r.patientName,
  facility: r.facility,
  visitBy: r.visitBy,
  status: r.status,
  issuedAt: r.issuedAt,
  risk: r.risk,
  smsSent: r.smsSent,
  bookedFor: r.bookedFor ?? null,
});
const refIds = new Map<string, string>();
async function lookupReferral(code: string): Promise<Json> {
  const c = code.trim().replace(/^REF:/i, "");
  const r = await http<Json>(`/web/referrals/lookup?code=${encodeURIComponent(c)}`);
  refIds.set(r.code, r.id);
  return r;
}

/* ───────────────────────── specialist ───────────────────────── */
const KIND_TO_CASE: Record<string, QueueCase["caseType"]> = {
  referral_review: "first_screening",
  escalation: "follow_up",
  cannot_assess: "low_quality",
  needs_review: "second_opinion",
  audit_sample: "second_opinion",
  disputed_label: "second_opinion",
};
async function fetchQueue(): Promise<QueueCase[]> {
  const rows = await http<Json[]>("/review/queue");
  const best = new Map<string, Json>();
  for (const t of rows) if (!best.has(t.screening_id) || t.priority < best.get(t.screening_id)!.priority) best.set(t.screening_id, t);
  return [...best.values()].map((t) => ({
    id: t.screening_id,
    patient: { id: t.patient.id, displayId: t.patient.display_id, name: t.patient.name, age: ageFromYear(t.patient.birth_year), sex: t.patient.sex, village: t.patient.village ?? "—" },
    priority: (t.priority <= 10 ? 1 : t.priority <= 20 ? 2 : 3) as 1 | 2 | 3,
    risk: (t.risk_level ?? "NEEDS_REVIEW") as RiskLevel,
    caseType: KIND_TO_CASE[t.kind] ?? "second_opinion",
    submittedAt: t.captured_at,
    submittedBy: t.facility ?? "PHC screening",
    aiConfidence: t.lesion_score ?? 0,
  }));
}
const DECISION_TO_API: Record<string, string> = {
  confirm_referral: "confirm_refer",
  not_suspicious: "not_suspicious",
  needs_biopsy: "needs_biopsy",
  cannot_assess: "cannot_assess",
};
function overrideCode(text?: string) {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/miss|didn.?t (see|flag)|not flagged/.test(t)) return "lesion_missed_by_ai";
  if (/false|benign|normal|over.?call/.test(t)) return "false_alarm";
  if (/blur|dark|glare|quality|photo/.test(t)) return "poor_image";
  if (/history|biopsy|previous|clinical/.test(t)) return "clinical_history";
  return "other";
}

/* ───────────────────────── rules (maker–checker) ───────────────────────── */
const RULES: { id: string; name: string; description: string; path: string[]; unit: string }[] = [
  { id: "restricted_mm", name: "Restricted mouth opening", description: "Below this opening, with burning, the result is HIGH (signs of OSMF).", path: ["mouth_opening", "restricted_mm"], unit: "mm" },
  { id: "borderline_mm", name: "Borderline mouth opening", description: "Between the restricted and this value the opening is flagged as borderline.", path: ["mouth_opening", "borderline_mm"], unit: "mm" },
  { id: "persistence_days", name: "Two-week rule", description: "A patch or sore present this long or longer is always HIGH.", path: ["persistence_days"], unit: "days" },
  { id: "referral_due_days", name: "Referral visit window", description: "Days the patient has to reach the specialist after a HIGH result.", path: ["referral_due_days"], unit: "days" },
  { id: "habit_high", name: "High-risk habit score", description: "Habit points (tobacco, areca, alcohol, years, symptoms) at or above this are high risk.", path: ["habit_scoring", "levels", "high"], unit: "points" },
  { id: "followup_low", name: "Routine re-screen after LOW", description: "Days until a LOW-risk patient is screened again.", path: ["followup_days", "LOW"], unit: "days" },
];
const getPath = (o: Json, p: string[]) => p.reduce<Json | undefined>((a, k) => (a == null ? undefined : a[k]), o) as unknown as number;
function setPath(o: Json, p: string[], v: number) {
  const c = structuredClone(o);
  let cur = c;
  p.slice(0, -1).forEach((k) => (cur = cur[k]));
  cur[p[p.length - 1]] = v;
  return c;
}

/* ───────────────────────── capture (phone → desktop) ───────────────────────── */
const captureSecret = () => new URLSearchParams(window.location.search).get("t") ?? "";

/* ───────────────────────── provider ───────────────────────── */
let provider: { patientId: string; expiresAt: string; doctor: string } | null = null;
async function providerSummary(): Promise<ProviderSummary> {
  const s = await http<Json>("/web/provider/summary");
  return {
    patient: s.patient,
    risk: s.risk,
    reviewed: s.reviewed,
    referral: s.referral ? toReferral(s.referral) : undefined,
    medicines: s.medicines,
    history: s.history,
    notes: s.notes,
    accessExpiresAt: provider?.expiresAt ?? new Date(Date.now() + 24 * 3600e3).toISOString(),
  };
}

/* ═════════════════════════ the service object ═════════════════════════ */
export const httpServices: Services = {
  home: { summary: () => http("/web/home") },
  auth: {
    async login(username, password) {
      await passwordLogin(username.trim(), password);
      return loadMe();
    },
    async logout() {
      me = null;
      await logoutSession();
    },
    async restore() {
      if (!hasSession()) return null;
      try {
        return await loadMe();
      } catch {
        return null;
      }
    },
  },

  patients: {
    search: async (q) => (await http<Json[]>(`/web/patients?q=${encodeURIComponent(q)}`)).map(toPatient),
    get: async (id) => toPatient(await http<Json>(`/web/patients/${id}`)),
    async register(p) {
      const v = (await villages()).find((x) => x.name === p.village);
      const created = await http<Json>("/patients", {
        method: "POST",
        headers: { "Idempotency-Key": uuid() },
        json: {
          full_name: p.name,
          sex: p.sex,
          birth_year: p.age ? new Date().getFullYear() - p.age : null,
          phone: p.phone ? (p.phone.startsWith("+") ? p.phone : `+91${p.phone}`) : null,
          language: p.preferredLanguage,
          village_id: v?.id ?? null,
        },
      });
      return toPatient(await http<Json>(`/web/patients/${created.id}`));
    },
    history: async (id) => http(`/web/patients/${id}/history`),
    async visits(id) {
      const r = await http<Json>(`/patients/${id}/comparison`);
      return (r.visits as Json[]).map(
        (v): VisitPhotos => ({
          screeningId: v.screening_id,
          date: v.captured_at,
          risk: v.risk_level,
          mouthOpeningMm: v.mouth_opening_mm,
          photos: Object.fromEntries(
            Object.entries(v.sites as Record<string, Json>)
              .filter(([, s]) => s.image_url)
              .map(([site, s]) => [SITE_FROM_API[site] ?? site, { url: s.image_url, heatmapUrl: s.heatmap_url, score: s.prob }]),
          ),
        }),
      );
    },
    async care(id) {
      const r = await http<Json>(`/patients/${id}/timeline`);
      const ev = (r.events as Json[]).slice().reverse();
      return {
        notes: ev.filter((e) => ["note", "provider_visit", "symptom_report", "review"].includes(e.kind)).map((e) => ({ at: e.occurred_at, by: e.created_by ?? e.source, text: e.summary })),
        medicines: ((r.medications ?? []) as Json[])
          .slice()
          .reverse()
          .map((m) => ({
            name: m.name ?? (m.status === "pending_ocr" ? "Reading the photo…" : "Unidentified medicine"),
            detail: [m.category?.replace(/_/g, " "), m.started_on ? `since ${m.started_on}` : null].filter(Boolean).join(" · ") || m.status,
            by: m.prescribed_by ?? "recorded at screening",
            masksSymptoms: !!m.masks_symptoms,
          })),
        responses: ev
          .filter((e) => e.kind === "checkin" || e.source === "patient_sms" || e.source === "ivr")
          .map((e) => ({ at: e.occurred_at, channel: e.source === "ivr" ? "Voice call" : "SMS", text: e.summary, ok: !/no answer|failed/i.test(e.summary) })),
      };
    },
    async issueCard(id) {
      const r = await http<Json>(`/patients/${id}/card`, { method: "POST" });
      return { link: r.link, displayId: r.display_id };
    },
    async addNote(id, text) {
      await http(`/patients/${id}/timeline`, { method: "POST", json: { kind: "note", summary: text } });
    },
  },

  reference: {
    villages,
    async modelVersion() {
      const m = await http<Json>("/models/manifest");
      return `${m.active_version}${m.placeholder ? " (placeholder)" : ""}`;
    },
  },

  screening: {
    async submit(d: ScreeningDraft) {
      const p = d.patient!;
      // 1. consent (DPDP): one record per purpose, in the patient's language
      const texts = Object.fromEntries((await http<Json[]>(`/consent-texts?language=${p.preferredLanguage}`)).map((x) => [x.purpose, x.id]));
      const method = d.consent.method === "fingerprint" ? "thumbprint" : d.consent.method === "verbal_witness" ? "verbal_witnessed" : "signature";
      const evidence = d.consent.signatureDataUrl ? await sha256Hex(dataUrlToBlob(d.consent.signatureDataUrl)) : undefined;
      for (const [purpose, granted] of [
        ["screening", d.consent.screening],
        ["sharing", d.consent.photos],
        ["ai_training", d.consent.research],
      ] as const) {
        if (texts[purpose])
          await http(`/patients/${p.id}/consents`, { method: "POST", json: { purpose, granted, consent_text_id: texts[purpose], method, evidence_sha256: evidence } });
      }
      // 2. medicine the patient uses (pain-relief gels can hide disease → masked-symptom rule)
      if (d.symptoms.takingMedicines === "yes" && (d.symptoms.medicineNames || d.symptoms.medicinePhoto)) {
        const form = new FormData();
        if (d.symptoms.medicineNames) form.append("name_entered", d.symptoms.medicineNames);
        if (d.symptoms.medicinePhoto) form.append("photo", await toBlob(d.symptoms.medicinePhoto), "medicine.jpg");
        await http(`/patients/${p.id}/medications`, { method: "POST", body: form });
      }
      // 3. the screening + photo manifest (sha256 so the server can verify every upload)
      const photos = await Promise.all(
        Object.values(d.photos)
          .filter(Boolean)
          .map(async (ph) => {
            const blob = await toBlob(ph!.dataUrl);
            return { ph: ph!, blob, sha: await sha256Hex(blob) };
          }),
      );
      const clientUuid = uuid();
      const mm = d.mouth.finalMm ?? (d.mouth.attemptsMm.length ? d.mouth.attemptsMm[d.mouth.attemptsMm.length - 1] : undefined);
      const plan = await http<Json>("/screenings", {
        method: "POST",
        headers: { "Idempotency-Key": clientUuid },
        json: {
          client_uuid: clientUuid,
          patient_id: p.id,
          captured_at: new Date().toISOString(),
          habits: habitsToApi(d.habits),
          symptoms: symptomsToApi(d.symptoms),
          // raw photo-pixel readings (iris width + lip gap): the server recomputes mm and sanity-checks it
          mouth_opening:
            mm == null
              ? null
              : d.mouth.readings?.length
                ? { method: "iris", source: d.mouth.method ?? "manual", readings: d.mouth.readings, head_pose: d.mouth.headPose ?? { yaw: 0, pitch: 0, roll: 0 } }
                : { method: "manual", readings: (d.mouth.attemptsMm.length ? d.mouth.attemptsMm : [mm]).map((x) => ({ mm: x })), head_pose: { yaw: d.mouth.tiltWarning ? 20 : 0, pitch: 0 } },
          images: photos.map(({ ph, blob, sha }) => ({
            client_uuid: uuid(),
            site: SITE_TO_API[ph.site],
            sha256: sha,
            size_bytes: blob.size,
            content_type: ["image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg",
            quality: { ...ph.quality, source: ph.source },
          })),
          device: { client: "web", source: [...new Set(photos.map((x) => x.ph.source))].join(","), ua: navigator.userAgent.slice(0, 120) },
          app_version: "web-1.0",
        },
      });
      const sid = plan.screening_id as string;
      // 4. upload each photo through the API (works on any network; checksum verified server-side)
      for (const item of plan.images as Json[]) {
        const match = photos.find((x) => SITE_TO_API[x.ph.site] === item.site);
        if (!match || item.status !== "pending") continue;
        const form = new FormData();
        form.append("file", match.blob, `${item.site}.jpg`);
        await http(String(item.direct_upload).replace(/^\/api\/v1/, ""), { method: "PUT", body: form });
      }
      await http(`/screenings/${sid}/submit`, { method: "POST" });
      // 5. wait for the AI + rules
      return awaitResult(sid);
    },
    async retake(sid: string, photos: CapturedPhoto[]) {
      const form = new FormData();
      for (const ph of photos) form.append("files", await toBlob(ph.dataUrl), `${SITE_TO_API[ph.site]}.jpg`);
      form.append("sites", photos.map((ph) => SITE_TO_API[ph.site]).join(","));
      form.append("quality", JSON.stringify(photos.map((ph) => ({ ...ph.quality, source: ph.source }))));
      await http(`/screenings/${sid}/retake`, { method: "POST", body: form });
      return awaitResult(sid);
    },
  },

  capture: {
    async createSession() {
      const s = await http<{ id: string; url: string; expiresAt: string }>("/web/capture-sessions", { method: "POST" });
      // If this computer is already being used through its Wi-Fi address, the phone can use the same address.
      const u = new URL(s.url);
      const here = window.location;
      if (/^(localhost|127\.)/.test(u.hostname) && !/^(localhost|127\.)/.test(here.hostname)) {
        u.protocol = here.protocol;
        u.host = here.host;
      }
      return { ...s, url: u.toString() };
    },
    subscribe(id, cb) {
      let stop = false;
      let after = 0;
      (async () => {
        while (!stop) {
          try {
            const r = await http<{ events: { seq: number; event: CaptureEvent }[] }>(`/web/capture-sessions/${id}/events?after=${after}`);
            for (const e of r.events) {
              after = e.seq;
              cb(e.event);
            }
          } catch (e) {
            if (e instanceof ApiError && (e.status === 410 || e.status === 403)) {
              cb({ type: "expired" });
              return;
            }
          }
          await sleep(1500);
        }
      })();
      return () => {
        stop = true;
      };
    },
    async sendPhoto(id, photo) {
      const small: CapturedPhoto = { ...photo, dataUrl: await shrink(photo.dataUrl) };
      await http(`/web/capture-sessions/${id}/photos?t=${encodeURIComponent(captureSecret())}`, { method: "POST", json: small, noAuth: true });
    },
    announce(id, device) {
      void http(`/web/capture-sessions/${id}/connect?t=${encodeURIComponent(captureSecret())}`, { method: "POST", json: { device }, noAuth: true }).catch(() => undefined);
    },
  },

  specialist: {
    queue: fetchQueue,
    async getCase(id): Promise<CaseDetail> {
      const [c, q] = await Promise.all([http<Json>(`/review/cases/${id}`), fetchQueue().catch(() => [] as QueueCase[])]);
      const thr = await screeningThreshold();
      const pv = await http<Json>(`/web/patients/${c.patient.id}`).catch(() => null);
      const patient: Patient = pv
        ? toPatient(pv)
        : { id: c.patient.id, name: c.patient.name, age: ageFromYear(c.patient.birth_year), sex: c.patient.sex, phone: "", village: "—", taluk: "—", preferredLanguage: c.patient.language, registeredAt: c.captured_at };
      const qc: QueueCase = q.find((x) => x.id === id) ?? {
        id,
        patient: { id: patient.id, name: patient.name, age: patient.age, sex: patient.sex, village: patient.village },
        priority: 2,
        risk: c.risk_level,
        caseType: "second_opinion",
        submittedAt: c.captured_at,
        submittedBy: "PHC screening",
        aiConfidence: 0,
      };
      const photos = (c.photos as Json[])
        .filter((ph) => ph.site !== "front_open" || ph.image_url)
        .map((ph) => ({ site: SITE_FROM_API[ph.site] ?? ph.site, url: ph.image_url ?? "", heat: [], heatmapUrl: ph.heatmap_url, prob: ph.prob }));
      let previous: CaseDetail["previous"];
      try {
        const visits = await httpServices.patients.visits(c.patient.id);
        const prev = visits.filter((v) => v.screeningId !== id).pop();
        if (prev && Object.keys(prev.photos).length)
          previous = { date: prev.date, risk: (prev.risk ?? "LOW") as RiskLevel, photos: Object.entries(prev.photos).map(([s, v]) => ({ site: s as SiteId, url: v!.url })) };
      } catch {
        /* no earlier visit */
      }
      const scores = photos.filter((p) => p.prob != null).map((p) => ({ site: p.site, score: Number(p.prob), flagged: Number(p.prob) >= thr }));
      return {
        case: qc,
        patient,
        photos: photos.map(({ prob: _p, ...rest }) => rest),
        ai: {
          risk: c.risk_level,
          confidence: scores.length ? Math.max(...scores.map((s) => s.score)) : 0,
          modelVersion: c.explanation?.model_version ?? "—",
          reasons: [c.explanation?.summary, ...((c.explanation?.reasons ?? []) as Json[]).map((r) => r.text)].filter(Boolean),
          siteScores: scores,
          preliminary: true,
        },
        habits: habitsFromApi(c.habits),
        symptoms: symptomsFromApi(c.symptoms),
        mouthOpeningMm: c.mouth_opening_mm ?? 0,
        timeline: (c.timeline as Json[]).slice().reverse().map((e) => ({ at: e.at, label: e.summary, detail: e.source })),
        previous,
        similar: (c.similar_cases as Json[]).map((s) => ({
          id: s.id,
          site: "left_cheek" as SiteId,
          url: s.thumbnail_url ?? "",
          similarity: s.similarity,
          finalLabel: `${s.label === "refer" ? "Suspicious — referred" : "Not suspicious"}${s.diagnosis_code ? ` (${s.diagnosis_code})` : ""} · ${s.origin === "phase1_reference" ? s.source ?? "reference set" : "specialist-confirmed"}`,
          risk: (s.label === "refer" ? "HIGH" : "LOW") as RiskLevel,
        })),
      };
    },
    async submitReview(id, r: ReviewInput) {
      const siteLabels = Object.fromEntries(
        Object.entries(r.siteDecisions)
          .filter(([, v]) => v === "refer" || v === "no_refer")
          .map(([s, v]) => [SITE_TO_API[s as SiteId], v]),
      );
      await http(`/review/cases/${id}/review`, {
        method: "POST",
        json: {
          verdict: DECISION_TO_API[r.decision],
          diagnosis_text: r.diagnosis,
          override_reason: overrideCode(r.overrideReason),
          notes: [r.notes, r.overrideReason ? `Override: ${r.overrideReason}` : ""].filter(Boolean).join("\n") || null,
          site_labels: siteLabels,
        },
      });
    },
    stats: () => http("/web/specialist/stats"),
  },

  referrals: {
    list: async () => (await http<Json[]>("/web/referrals")).map((r) => (refIds.set(r.code, r.id), toReferral(r))),
    lookup: async (code) => toReferral(await lookupReferral(code)),
    async setStatus(code, status, bookedFor) {
      const id = refIds.get(code) ?? (await lookupReferral(code)).id;
      await http(`/referrals/${id}/status`, { method: "POST", json: { status: REF_STATUS_TO_API[status] ?? status, booked_for: bookedFor } });
      return toReferral(await lookupReferral(code));
    },
  },

  provider: {
    async requestOtp(input) {
      const raw = input.qrToken.trim();
      const card = raw.includes("card=") ? new URL(raw, window.location.origin).searchParams.get("card") ?? raw : raw.replace(/^CARD:/i, "");
      setEphemeralToken(null);
      const r = await http<Json>("/provider-connect/request", {
        method: "POST",
        noAuth: true,
        json: { card_token: card, provider_name: input.doctorName, provider_phone: input.phone.startsWith("+") ? input.phone : `+91${input.phone}`, provider_reg_no: input.regNo || null },
      });
      return { requestId: r.request_id, maskedPhone: "the patient's registered phone", demoCode: r.sandbox_otp };
    },
    async verifyOtp(requestId, otp) {
      const r = await http<Json>("/provider-connect/verify", { method: "POST", noAuth: true, json: { request_id: requestId, otp } });
      setEphemeralToken(r.access_token); // memory only — gone on refresh
      provider = { patientId: r.patient_id, expiresAt: r.expires_at, doctor: "Visiting doctor" };
      return providerSummary();
    },
    async addNote(text) {
      if (!provider) throw new ApiError(401, "Provider access has ended");
      await http(`/patients/${provider.patientId}/timeline`, { method: "POST", json: { kind: "note", summary: text } });
    },
    async addMedicine(m) {
      if (!provider) throw new ApiError(401, "Provider access has ended");
      const form = new FormData();
      form.append("name_entered", m.dose ? `${m.name} (${m.dose})` : m.name);
      form.append("prescribed_by", provider.doctor);
      await http(`/patients/${provider.patientId}/medications`, { method: "POST", body: form });
    },
  },

  district: {
    analytics: (f) => http(`/web/district?taluk=${encodeURIComponent(f.taluk)}&days=${f.range === "30d" ? 30 : f.range === "90d" ? 90 : 365}`),
  },

  lead: {
    async models() {
      const [ms, perf] = await Promise.all([http<Json[]>("/models"), http<Json[]>("/models/performance")]);
      const pm = Object.fromEntries(perf.map((p) => [p.version, p]));
      return ms
        .map(
          (m): ModelVersion => ({
            id: m.version,
            version: m.version,
            status: (["active", "shadow", "candidate"].includes(m.status) ? m.status : "retired") as ModelVersion["status"],
            createdAt: m.created_at,
            sensitivity: pm[m.version]?.sensitivity ?? m.benchmark?.sensitivity ?? 0,
            specificity: pm[m.version]?.specificity ?? m.benchmark?.specificity ?? 0,
            auc: pm[m.version]?.auc ?? m.benchmark?.auc ?? 0,
            datasetId: m.kind === "head" ? `retrained head on ${m.backbone_version}` : "original training set",
            notes: [m.placeholder ? "PLACEHOLDER model" : null, m.status === "rolled_back" ? "rolled back" : null, m.notes].filter(Boolean).join(" · "),
          }),
        )
        .reverse();
    },
    async modelAction(id, action) {
      if (action === "promote") await http(`/models/${encodeURIComponent(id)}/promote`, { method: "POST" });
      else if (action === "shadow") await http(`/models/${encodeURIComponent(id)}/shadow`, { method: "POST" });
      // "Roll back to this" re-activates that exact earlier version (clinical-lead action, audited)
      else if (action === "rollback") await http(`/models/${encodeURIComponent(id)}/promote`, { method: "POST" });
      else if (action === "retrain") await http("/models/retrain", { method: "POST", json: { exclude_noncommercial: false } });
      else if (action === "retire") await http("/models/shadow", { method: "DELETE" });
    },
    async rules() {
      const rs = await http<Json[]>("/rules");
      const active = rs.find((r) => r.status === "active");
      return RULES.map((r): RuleThreshold => ({ id: r.id, name: r.name, description: r.description, unit: r.unit, current: Number(getPath(active?.definition ?? {}, r.path)) }));
    },
    async proposals() {
      const rs = (await http<Json[]>("/rules")).sort((a, b) => a.version - b.version);
      const out: RuleProposal[] = [];
      rs.forEach((r, i) => {
        if (i === 0) return;
        const prev = rs.slice(0, i).reverse().find((x) => ["active", "retired"].includes(x.status)) ?? rs[0];
        const hit = RULES.find((k) => getPath(prev.definition, k.path) !== getPath(r.definition, k.path));
        const changed = hit ?? RULES[0];
        out.push({
          id: String(r.version),
          ruleId: changed.id,
          ruleName: hit ? hit.name : `Rule set v${r.version} (rule wording / other settings)`,
          oldValue: Number(getPath(prev.definition, changed.path)),
          newValue: Number(getPath(r.definition, changed.path)),
          reason: r.rationale ?? "",
          proposedBy: r.proposed_by === me?.id ? `You (${me?.displayName})` : "Another clinical lead",
          proposedById: r.proposed_by ?? "",
          proposedAt: r.proposed_at,
          status: r.status === "pending_approval" || r.status === "draft" ? "pending" : r.status === "rejected" ? "rejected" : "approved",
        });
      });
      return out.reverse();
    },
    async propose(ruleId, newValue, reason) {
      const rs = await http<Json[]>("/rules");
      const active = rs.find((r) => r.status === "active")!;
      const rule = RULES.find((r) => r.id === ruleId)!;
      const res = await http<Json>("/rules", { method: "POST", json: { definition: setPath(active.definition, rule.path, newValue), rationale: reason } });
      return {
        id: String(res.version),
        ruleId,
        ruleName: rule.name,
        oldValue: Number(getPath(active.definition, rule.path)),
        newValue,
        reason,
        proposedBy: `You (${me?.displayName ?? ""})`,
        proposedById: me?.id ?? "",
        proposedAt: new Date().toISOString(),
        status: "pending",
      };
    },
    async decide(id, approve) {
      await http(`/rules/${id}/${approve ? "approve" : "reject"}`, { method: "POST", json: { comment: approve ? "approved in web console" : "rejected in web console" } });
    },
  },

  governance: {
    async load(): Promise<GovernanceData> {
      const [ds, sn, dr, fa, inc] = await Promise.all([
        http<Json[]>("/governance/datasets"),
        http<Json[]>("/governance/lineage/snapshots"),
        http<Json[]>("/governance/drift"),
        http<Json | null>("/governance/fairness"),
        http<Json[]>("/governance/incidents"),
      ]);
      return {
        datasets: ds.map((d) => ({ id: d.id, name: d.name, images: d.n_images, licence: d.licence ?? "—", commercialUse: !!d.commercial_use, issues: d.known_issues })),
        snapshots: sn.map((s) => ({ id: s.id, createdAt: s.created_at, samples: s.n_samples, labels: s.label_counts ?? {}, sources: s.sources ?? {}, usedBy: s.used_by_model_version, sha256: s.sha256 })),
        drift: dr
          .slice()
          .reverse()
          .map((d) => ({ id: d.id, createdAt: d.created_at, modelVersion: d.model_version, alert: d.alert, psiProb: d.metrics?.psi_prob ?? null, psiEmbedding: d.metrics?.psi_embedding_norm ?? null, oodRate: d.metrics?.ood_rate ?? null, reportUrl: d.report_url })),
        fairness: fa
          ? {
              createdAt: fa.created_at,
              modelVersion: fa.model_version,
              reviews: fa.n_reviews,
              groups: Object.entries((fa.groups ?? {}) as Record<string, Record<string, Json>>).flatMap(([g, keys]) =>
                Object.entries(keys).map(([k, v]) => ({ group: g, key: k, n: v.n, sensitivity: v.sensitivity ?? null, specificity: v.specificity ?? null, agreement: v.agreement ?? null, suppressed: v.suppressed })),
              ),
            }
          : null,
        incidents: inc.map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, status: i.status, description: i.description, createdAt: i.created_at, modelVersion: i.model_version })),
      };
    },
    runDrift: () => http("/governance/drift/run", { method: "POST" }),
    runFairness: () => http("/governance/fairness/run", { method: "POST" }),
  },

  admin: {
    health: () => http("/web/admin/health"),
    async failedJobs() {
      return (await http<Json[]>("/admin/dead-letters")).map((d) => ({ id: d.id, type: d.task, error: d.error, attempts: d.attempts, lastTriedAt: d.failed_at }));
    },
    async retryJob(id) {
      await http(`/admin/dead-letters/${id}/retry`, { method: "POST" });
    },
    async messages() {
      return (await http<Json[]>("/admin/messages")).map((m) => ({
        id: m.id,
        channel: m.channel === "voice" ? "voice" : "sms",
        to: m.to ?? "—",
        template: m.template,
        status: m.status === "failed" ? "failed" : m.status === "queued" ? "queued" : "delivered",
        at: m.created_at,
      }));
    },
    audit: (q) => http(`/web/admin/audit?q=${encodeURIComponent(q)}`),
    async verifyChain() {
      const r = await http<Json>("/audit/verify");
      return { ok: r.ok, checked: r.checked, brokenAt: r.problems?.[0] ? `#${r.problems[0].id} — ${r.problems[0].problem}` : undefined };
    },
  },

  notifications: {
    async list() {
      const kind = (t: string): AppNotification["kind"] => (/review/.test(t) ? "review" : /referral/.test(t) ? "referral" : /followup|checkin/.test(t) ? "followup" : "system");
      const title = (t: string) =>
        ({ staff_review_done: "Screening update", staff_referral_overdue: "Referral overdue", staff_followup_due: "Follow-up due", staff_escalation: "Escalation" })[t] ??
        t.replace(/^staff_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      return (await http<Json[]>("/notifications")).map((n) => ({ id: n.id, kind: kind(n.template), title: title(n.template), body: n.body, at: n.created_at, read: n.status === "read" }));
    },
    async markAllRead() {
      const unread = (await http<Json[]>("/notifications?unread_only=true")).map((n) => n.id as string);
      await Promise.all(unread.map((id) => http(`/notifications/${id}/read`, { method: "POST" })));
    },
  },
};
