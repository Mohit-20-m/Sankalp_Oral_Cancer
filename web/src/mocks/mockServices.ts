/**
 * DEMO implementation of the service contracts. Adds realistic latency so
 * loading states are visible. Clinical outputs here are NOT model outputs —
 * they are placeholders tagged with modelVersion "demo" and a visible badge.
 */
import type { Services, CaseDetail, CaptureEvent, ProviderSummary, DistrictAnalytics } from "@/services/contracts";
import { ApiError } from "@/services/api";
import type { AiResult, Patient, Referral, RiskLevel, SiteId, ScreeningDraft } from "@/types";
import { PHOTO_SITES, MIN_GROUP_SIZE } from "@/config/constants";
import { samplePhotoUrl } from "./samplePhotos";
import { GOVERNANCE } from "./governance";
import {
  AUDIT,
  DEMO_USERS,
  FAILED_JOBS,
  MESSAGES,
  MODELS,
  NOTIFICATIONS,
  PATIENTS,
  PROPOSALS,
  QUEUE,
  REFERRALS,
  RULES,
  SERVICES,
  VILLAGES,
  rand,
  screeningHistory,
} from "./data";
import type { Role } from "@/types";

const wait = (ms = 350 + Math.random() * 400) => new Promise((r) => setTimeout(r, ms));
let currentUserId = "u-lead";

function demoAi(d: ScreeningDraft): AiResult {
  const s = d.symptoms;
  const habitScore = d.habits.filter((h) => h.status === "current").length;
  let signal = habitScore * 0.12 + (s.patches && s.patches !== "none" ? 0.3 : 0) + (s.nonHealingUlcer === "yes" ? 0.25 : 0) + (s.difficultyOpening === "yes" ? 0.12 : 0);
  const poor = Object.values(d.photos).filter((p) => p && p.quality.overall === "poor").length;
  const risk: RiskLevel = poor > 1 ? "CANNOT_ASSESS" : signal >= 0.6 ? "HIGH" : signal >= 0.3 ? "MEDIUM" : signal >= 0.2 ? "NEEDS_REVIEW" : "LOW";
  signal = Math.min(0.95, signal);
  const reasons: string[] = [];
  if (s.patches && s.patches !== "none") reasons.push(`Reported ${s.patches === "both" ? "white and red" : s.patches} patch${s.patchWeeks ? ` for ${s.patchWeeks} weeks` : ""}`);
  if (s.nonHealingUlcer === "yes") reasons.push("Ulcer not healing for over 2 weeks");
  d.habits.filter((h) => h.status === "current").forEach((h) => reasons.push(`Current ${h.kind === "areca" ? "areca nut" : h.kind} use${h.years ? ` for ${h.years} years` : ""}`));
  if (s.difficultyOpening === "yes") reasons.push("Reduced mouth opening reported");
  if (!reasons.length) reasons.push("No concerning findings in the answers or photographs");
  return {
    risk,
    confidence: 0.6 + rand() * 0.3,
    modelVersion: "demo (mock)",
    reasons,
    preliminary: true,
    siteScores: PHOTO_SITES.map((p, i) => ({ site: p.id, score: Math.min(0.98, signal * (0.6 + ((i * 37) % 10) / 12)), flagged: signal > 0.45 && i % 3 === 0 })),
  };
}

const channels = new Map<string, BroadcastChannel>();
const chan = (id: string) => {
  let c = channels.get(id);
  if (!c) {
    c = new BroadcastChannel(`capture-${id}`);
    channels.set(id, c);
  }
  return c;
};

let providerState: ProviderSummary | null = null;
const NOTES: Record<string, { at: string; by: string; text: string }[]> = {};

export const mockServices: Services = {
  home: {
    async summary() {
      await wait(200);
      return { screenedToday: 7, screenedAvg: 5, followupsDue: 4, followupsOverdue: 2, pendingUploads: 2, activeReferrals: 11, visitedThisWeek: 3, facilities: 6, screened90d: 2814, overdueReferrals: 61, worstTaluk: "Bantwal", candidateModels: 1, activeModel: "2.4.1", pendingRules: 2, openIncidents: 1, failedJobs: 4, failedMessages: 2 };
    },
  },
  auth: {
    async login(username, password) {
      await wait(600);
      const u = Object.values(DEMO_USERS).find((x) => x.name === username.trim().toLowerCase());
      if (!u || password.length < 4) throw new ApiError(401, "Invalid credentials");
      currentUserId = u.id;
      return u;
    },
    async logout() {
      await wait(150);
    },
  },

  patients: {
    async search(q) {
      await wait(250);
      const s = q.trim().toLowerCase();
      if (!s) return PATIENTS.slice(0, 24);
      return PATIENTS.filter((p) => p.name.toLowerCase().includes(s) || p.phone.includes(s) || p.id.toLowerCase().includes(s) || p.village.toLowerCase().includes(s));
    },
    async get(id) {
      await wait();
      const p = PATIENTS.find((x) => x.id === id);
      if (!p) throw new ApiError(404, "Patient not found");
      return p;
    },
    async register(p) {
      await wait(500);
      const np: Patient = { ...p, id: `PT-${Math.floor(30000 + Math.random() * 9000)}`, registeredAt: new Date().toISOString() };
      PATIENTS.unshift(np);
      return np;
    },
    async history(id) {
      await wait(300);
      const p = PATIENTS.find((x) => x.id === id);
      return p ? screeningHistory(p) : [];
    },
    async visits(id) {
      await wait(300);
      const p = PATIENTS.find((x) => x.id === id);
      if (!p) return [];
      const mk = (seed: number, daysBack: number, risk: RiskLevel) => ({
        screeningId: `SC-${seed}`,
        date: new Date(Date.now() - daysBack * 864e5).toISOString(),
        risk,
        mouthOpeningMm: 36 - seed / 20,
        photos: Object.fromEntries(PHOTO_SITES.map((s, i) => [s.id, { url: samplePhotoUrl(s.id, seed + i), heatmapUrl: null, score: null }])),
      });
      return [mk(22, 150, "LOW"), mk(3, 2, p.lastRisk ?? "MEDIUM")];
    },
    async care(id) {
      await wait(200);
      return {
        notes: (NOTES[id] ??= [{ by: "Rekha (Nurse)", at: new Date(Date.now() - 5 * 864e5).toISOString(), text: "Patient reports cutting down areca to twice a day. Encouraged to continue." }]),
        medicines: [
          { name: "Vitamin A supplement", detail: "1 tablet daily", by: "Dr. Meera", masksSymptoms: false },
          { name: "Benzocaine gel (Mucopain)", detail: "As needed for pain", by: "Dr. Prakash (Provider Connect)", masksSymptoms: true },
        ],
        responses: [
          { at: new Date(Date.now() - 12 * 864e5).toISOString(), channel: "Voice call", text: "Visited dental college — yes", ok: true },
          { at: new Date(Date.now() - 40 * 864e5).toISOString(), channel: "SMS", text: "Symptoms not back", ok: true },
          { at: new Date(Date.now() - 70 * 864e5).toISOString(), channel: "Voice call", text: "No answer (3 attempts)", ok: false },
        ],
      };
    },
    async issueCard(id) {
      await wait(300);
      return { link: `${window.location.origin}/connect?card=PATIENT:${id}`, displayId: id };
    },
    async addNote(id, text) {
      await wait(250);
      (NOTES[id] ??= []).unshift({ by: "You", at: new Date().toISOString(), text });
    },
  },

  reference: {
    async villages() {
      await wait(150);
      return VILLAGES.map((v) => ({ id: v.name, name: v.name, taluk: v.taluk }));
    },
    async modelVersion() {
      return "demo (mock)";
    },
  },

  screening: {
    async submit(d) {
      await wait(1800);
      const result = demoAi(d);
      let referral: Referral | undefined;
      if (d.patient && (result.risk === "HIGH" || result.risk === "MEDIUM")) {
        referral = {
          code: `RF-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${d.patient.id.slice(-3)}`,
          patientId: d.patient.id,
          patientName: d.patient.name,
          facility: "Govt. Dental College, Mangaluru",
          visitBy: new Date(Date.now() + (result.risk === "HIGH" ? 7 : 21) * 864e5).toISOString(),
          status: "issued",
          issuedAt: new Date().toISOString(),
          risk: result.risk,
          smsSent: true,
        };
        REFERRALS.unshift(referral);
      }
      return { screeningId: `SC-${Date.now().toString(36)}`, result, referral };
    },
    async retake(screeningId, photos) {
      await wait(1500);
      // demo: a retake in good quality clears the flag; otherwise a doctor double-checks
      const clean = photos.every((p) => p.quality.acceptable);
      const result: AiResult = {
        risk: clean ? "LOW" : "NEEDS_REVIEW",
        confidence: clean ? 0.12 : 0.85,
        modelVersion: "demo (mock)",
        reasons: clean ? ["Retaken photo looks normal — no warning signs found"] : ["Retaken photo still flagged — a doctor will double-check it"],
        siteScores: photos.map((p) => ({ site: p.site, score: clean ? 0.12 : 0.85, flagged: !clean })),
        preliminary: true,
        aiOnlyFlag: !clean,
      };
      return { screeningId, result };
    },
  },

  capture: {
    async createSession() {
      await wait(400);
      const id = Math.random().toString(36).slice(2, 10);
      return { id, url: `${window.location.origin}/capture/${id}`, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    },
    subscribe(id, cb) {
      const c = chan(id);
      const h = (e: MessageEvent<CaptureEvent>) => cb(e.data);
      c.addEventListener("message", h);
      return () => c.removeEventListener("message", h);
    },
    async sendPhoto(id, photo) {
      await wait(500);
      chan(id).postMessage({ type: "photo", photo } satisfies CaptureEvent);
    },
    announce(id, device) {
      chan(id).postMessage({ type: "connected", device } satisfies CaptureEvent);
    },
  },

  specialist: {
    async queue() {
      await wait();
      return [...QUEUE];
    },
    async getCase(id) {
      await wait(600);
      const c = QUEUE.find((q) => q.id === id);
      if (!c) throw new ApiError(404, "Case not found");
      const p = PATIENTS.find((x) => x.id === c.patient.id)!;
      const seed = parseInt(id.slice(-2), 10) || 3;
      const high = c.risk === "HIGH" ? 0.82 : c.risk === "MEDIUM" ? 0.58 : 0.25;
      const scores = PHOTO_SITES.map((s, i) => ({ site: s.id, score: Math.max(0.04, Math.min(0.97, high * (0.45 + (((i + seed) * 29) % 11) / 14))), flagged: false }));
      scores.forEach((s) => (s.flagged = s.score > 0.6));
      const detail: CaseDetail = {
        case: c,
        patient: p,
        photos: PHOTO_SITES.map((s, i) => ({
          site: s.id,
          url: samplePhotoUrl(s.id, seed + i),
          heat: scores[i].score > 0.35 ? [{ x: 0.35 + ((i * 17) % 30) / 100, y: 0.4 + ((i * 11) % 25) / 100, r: 0.18, w: scores[i].score }] : [],
        })),
        ai: {
          risk: c.risk,
          confidence: c.aiConfidence,
          modelVersion: "demo (mock)",
          preliminary: true,
          siteScores: scores,
          reasons: [
            scores.some((s) => s.flagged) ? `Texture irregularity at ${scores.filter((s) => s.flagged).map((s) => s.site.replace("_", " ")).join(", ")}` : "No site above the referral threshold",
            "Current areca nut + tobacco use for 15+ years",
            "Self-reported white patch for 6 weeks",
          ],
        },
        habits: [
          { kind: "areca", status: "current", years: 18, perDay: 4 },
          { kind: "tobacco", status: "current", years: 15, perDay: 3, form: "Chewing" },
          { kind: "alcohol", status: "past", years: 6 },
        ],
        symptoms: { burningSpicy: "yes", difficultyOpening: "no", patches: "white", patchWeeks: 6, pain: "no", nonHealingUlcer: "no", takingMedicines: "no" },
        mouthOpeningMm: 34.5,
        timeline: [
          { at: c.submittedAt, label: "Screening submitted", detail: c.submittedBy },
          { at: new Date(new Date(c.submittedAt).getTime() + 90000).toISOString(), label: "AI pre-screen completed", detail: `${c.risk.replace("_", " ")} · demo model` },
          { at: new Date(new Date(c.submittedAt).getTime() + 120000).toISOString(), label: "Added to specialist queue" },
          { at: p.registeredAt, label: "Patient registered", detail: p.village },
        ],
        previous: { date: new Date(Date.now() - 140 * 864e5).toISOString(), risk: "LOW", photos: PHOTO_SITES.map((s, i) => ({ site: s.id, url: samplePhotoUrl(s.id, seed + i + 20) })) },
        similar: [
          { id: "SIM-1", site: "left_cheek", url: samplePhotoUrl("left_cheek", 9), similarity: 0.91, finalLabel: "Leukoplakia (homogeneous)", risk: "MEDIUM" },
          { id: "SIM-2", site: "left_cheek", url: samplePhotoUrl("left_cheek", 14), similarity: 0.87, finalLabel: "Frictional keratosis — benign", risk: "LOW" },
          { id: "SIM-3", site: "tongue_top", url: samplePhotoUrl("tongue_top", 21), similarity: 0.83, finalLabel: "Oral submucous fibrosis (early)", risk: "HIGH" },
        ],
      };
      return detail;
    },
    async submitReview(id) {
      await wait(800);
      const i = QUEUE.findIndex((q) => q.id === id);
      if (i >= 0) QUEUE.splice(i, 1);
    },
    async stats() {
      await wait();
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      return {
        reviewed: 412,
        agreementRate: 0.874,
        medianMinutes: 3.6,
        thisWeek: 58,
        byDay: days.map((d, i) => {
          const r = 6 + ((i * 7) % 9);
          return { day: d, reviewed: r, agreed: Math.round(r * (0.78 + (i % 3) * 0.06)) };
        }),
        byDecision: [
          { name: "Confirm referral", value: 132 },
          { name: "Not suspicious", value: 201 },
          { name: "Needs biopsy", value: 41 },
          { name: "Cannot assess", value: 38 },
        ],
      };
    },
  },

  referrals: {
    async list() {
      await wait();
      return [...REFERRALS];
    },
    async lookup(code) {
      await wait(500);
      const r = REFERRALS.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
      if (!r) throw new ApiError(404, "Invalid referral code");
      return r;
    },
    async setStatus(code, status, bookedFor) {
      await wait(500);
      const r = REFERRALS.find((x) => x.code === code);
      if (!r) throw new ApiError(404, "Invalid referral code");
      r.status = status;
      if (bookedFor) r.bookedFor = bookedFor;
      return { ...r };
    },
  },

  provider: {
    async requestOtp(input) {
      await wait(700);
      if (!input.qrToken || input.qrToken.length < 4) throw new ApiError(400, "Invalid QR");
      return { requestId: `otp-${Date.now()}`, maskedPhone: "98•••••412", demoCode: "123456" };
    },
    async verifyOtp(_rid, otp) {
      await wait(700);
      if (otp !== "123456") throw new ApiError(401, "Incorrect code");
      const p = PATIENTS.find((x) => x.lastRisk === "HIGH") ?? PATIENTS[0];
      providerState = {
        patient: { id: p.id, name: p.name, age: p.age, sex: p.sex, village: p.village },
        risk: p.lastRisk ?? "MEDIUM",
        reviewed: true,
        referral: REFERRALS.find((r) => r.patientId === p.id),
        medicines: [{ name: "Vitamin A supplement", dose: "1 tab daily", since: new Date(Date.now() - 20 * 864e5).toISOString(), addedBy: "Dr. Meera" }],
        history: [
          { date: p.lastScreeningAt!, event: "Oral screening — specialist reviewed" },
          { date: new Date(Date.now() - 140 * 864e5).toISOString(), event: "Oral screening — low risk" },
          { date: p.registeredAt, event: "Registered at Ujire PHC" },
        ],
        notes: [{ at: new Date(Date.now() - 3 * 864e5).toISOString(), by: "Dr. Meera (Specialist)", text: "Counselled on areca cessation. Review in 4 weeks." }],
        accessExpiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
      };
      return providerState;
    },
    async addNote(text) {
      await wait(400);
      providerState?.notes.unshift({ at: new Date().toISOString(), by: "You (visiting doctor)", text });
    },
    async addMedicine(m) {
      await wait(400);
      providerState?.medicines.unshift({ ...m, since: new Date().toISOString(), addedBy: "You (visiting doctor)" });
    },
  },

  district: {
    async analytics(f) {
      await wait(700);
      const mult = f.range === "30d" ? 0.12 : f.range === "90d" ? 0.32 : 1;
      const vs = VILLAGES.filter((v) => f.taluk === "all" || v.taluk === f.taluk).map((v, i) => {
        const screened = Math.round((40 + ((i * 53) % 180)) * mult);
        const high = Math.round(screened * (0.03 + ((i * 7) % 6) / 100));
        const hide = screened < MIN_GROUP_SIZE;
        return {
          name: v.name,
          taluk: v.taluk,
          screened: hide ? null : screened,
          highRisk: hide || high < MIN_GROUP_SIZE ? null : high,
          coverage: hide ? null : Math.min(0.95, 0.25 + ((i * 13) % 60) / 100),
        };
      });
      const screened = vs.reduce((a, v) => a + (v.screened ?? 0), 0);
      const highRisk = Math.round(screened * 0.058);
      const referred = Math.round(highRisk * 2.6);
      const visited = Math.round(referred * 0.71);
      const months = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
      const nM = f.range === "30d" ? 2 : f.range === "90d" ? 4 : 12;
      const sel = months.slice(-nM);
      const res: DistrictAnalytics = {
        totals: { screened, highRisk, referred, visited, overdue: Math.round(referred * 0.14) },
        volume: sel.map((m, i) => ({ month: m, screened: Math.round((screened / nM) * (0.7 + i * (0.6 / nM))) })),
        riskTrend: sel.map((m, i) => ({ month: m, LOW: 78 - i * 0.4, MEDIUM: 16 + (i % 3), HIGH: 6 - (i % 4) * 0.4 })),
        funnel: [
          { stage: "Screened", value: screened },
          { stage: "Flagged", value: Math.round(screened * 0.19) },
          { stage: "Referred", value: referred },
          { stage: "Visited", value: visited },
          { stage: "Completed", value: Math.round(visited * 0.82) },
        ],
        villages: vs,
      };
      return res;
    },
  },

  lead: {
    async models() {
      await wait();
      return MODELS.map((m) => ({ ...m }));
    },
    async modelAction(id, action) {
      await wait(900);
      const m = MODELS.find((x) => x.id === id);
      if (!m) return;
      if (action === "promote") {
        MODELS.forEach((x) => x.status === "active" && (x.status = "retired"));
        m.status = "active";
      } else if (action === "shadow") m.status = "shadow";
      else if (action === "retire") m.status = "retired";
      else if (action === "rollback") {
        MODELS.forEach((x) => x.status === "active" && (x.status = "retired"));
        m.status = "active";
      }
    },
    async rules() {
      await wait();
      return RULES.map((r) => ({ ...r }));
    },
    async proposals() {
      await wait();
      return PROPOSALS.map((p) => ({ ...p }));
    },
    async propose(ruleId, newValue, reason) {
      await wait(600);
      const r = RULES.find((x) => x.id === ruleId)!;
      const p = { id: `p${Date.now()}`, ruleId, ruleName: r.name, oldValue: r.current, newValue, reason, proposedBy: "Dr. Anand (Clinical lead)", proposedById: currentUserId, proposedAt: new Date().toISOString(), status: "pending" as const };
      PROPOSALS.unshift(p);
      return p;
    },
    async decide(id, approve) {
      await wait(600);
      const p = PROPOSALS.find((x) => x.id === id);
      if (!p) return;
      if (p.proposedById === currentUserId) throw new ApiError(403, "You cannot approve your own proposal");
      p.status = approve ? "approved" : "rejected";
      if (approve) {
        const r = RULES.find((x) => x.id === p.ruleId);
        if (r) r.current = p.newValue;
      }
    },
  },

  governance: {
    async load() {
      await wait();
      return GOVERNANCE;
    },
    async runDrift() {
      await wait(900);
      return { status: "ok" };
    },
    async runFairness() {
      await wait(900);
      return { status: "ok" };
    },
  },

  admin: {
    async health() {
      await wait();
      return SERVICES.map((s) => ({ ...s, latencyMs: Math.round(s.latencyMs * (0.85 + Math.random() * 0.3)) }));
    },
    async failedJobs() {
      await wait();
      return [...FAILED_JOBS];
    },
    async retryJob(id) {
      await wait(1100);
      const i = FAILED_JOBS.findIndex((j) => j.id === id);
      if (i >= 0) FAILED_JOBS.splice(i, 1);
    },
    async messages() {
      await wait();
      return [...MESSAGES];
    },
    async audit(q) {
      await wait(300);
      const s = q.toLowerCase();
      return AUDIT.filter((a) => !s || `${a.actor} ${a.action} ${a.resource} ${a.id}`.toLowerCase().includes(s));
    },
    async verifyChain() {
      await wait(1600);
      const bad = AUDIT.find((a) => a.tampered);
      return { ok: !bad, checked: AUDIT.length, brokenAt: bad?.id };
    },
  },

  notifications: {
    async list() {
      await wait(250);
      return NOTIFICATIONS.map((n) => ({ ...n }));
    },
    async markAllRead() {
      NOTIFICATIONS.forEach((n) => (n.read = true));
    },
  },
};

/** Exposed for the demo login role picker. */
export function demoUsernameFor(role: Role) {
  return DEMO_USERS[role].name;
}
export type { SiteId };
