/**
 * ─────────────────────────────────────────────────────────────
 *  MOCK DATA — used only when VITE_API_MODE=mock (the default).
 *  All people here are fictional. Kept separate from real services
 *  (src/services/http) so it can be deleted without touching screens.
 * ─────────────────────────────────────────────────────────────
 */
import type {
  AppNotification,
  AuditEntry,
  FailedJob,
  MessageLog,
  ModelVersion,
  Patient,
  QueueCase,
  Referral,
  RiskLevel,
  RuleProposal,
  RuleThreshold,
  Screening,
  ServiceHealth,
  User,
  Role,
} from "@/types";

let s = 42;
export const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
const daysAhead = (d: number) => new Date(Date.now() + d * 864e5).toISOString();

export const DEMO_USERS: Record<Role, User> = {
  asha: { id: "u-kavya", name: "kavya", displayName: "Kavya", role: "asha", facility: "Ujire PHC", initials: "KV" },
  nurse: { id: "u-rekha", name: "rekha", displayName: "Rekha", role: "nurse", facility: "Ujire PHC", initials: "RK" },
  specialist: { id: "u-meera", name: "meera", displayName: "Dr. Meera", role: "specialist", facility: "Govt. Dental College, Mangaluru", initials: "MR" },
  local_doctor: { id: "u-local", name: "local", displayName: "Dr. Prakash", role: "local_doctor", facility: "Private clinic, Belthangady", initials: "PR" },
  district_officer: { id: "u-dho", name: "dho", displayName: "Mr. Suresh", role: "district_officer", facility: "District Health Office, DK", initials: "SU" },
  clinical_lead: { id: "u-lead", name: "lead", displayName: "Dr. Anand", role: "clinical_lead", facility: "Clinical Governance Unit", initials: "AN" },
  admin: { id: "u-admin", name: "admin", displayName: "Farhan", role: "admin", facility: "Platform Operations", initials: "FA" },
};

export const ROLE_LABEL: Record<Role, string> = {
  asha: "ASHA worker",
  nurse: "Nurse",
  specialist: "Specialist",
  local_doctor: "Local doctor",
  district_officer: "District officer",
  clinical_lead: "Clinical lead",
  admin: "Administrator",
};

export const TALUKS = ["Belthangady", "Bantwal", "Puttur", "Sullia", "Mangaluru", "Moodbidri", "Kadaba"] as const;
export const VILLAGES: { name: string; taluk: (typeof TALUKS)[number] }[] = [
  { name: "Ujire", taluk: "Belthangady" },
  { name: "Dharmasthala", taluk: "Belthangady" },
  { name: "Venur", taluk: "Belthangady" },
  { name: "Guruvayanakere", taluk: "Belthangady" },
  { name: "Kokkada", taluk: "Belthangady" },
  { name: "Vittal", taluk: "Bantwal" },
  { name: "Kalladka", taluk: "Bantwal" },
  { name: "Siddakatte", taluk: "Bantwal" },
  { name: "Panemangalore", taluk: "Bantwal" },
  { name: "Uppinangady", taluk: "Puttur" },
  { name: "Kumbra", taluk: "Puttur" },
  { name: "Savanoor", taluk: "Puttur" },
  { name: "Bellare", taluk: "Sullia" },
  { name: "Guthigar", taluk: "Sullia" },
  { name: "Panja", taluk: "Sullia" },
  { name: "Mulki", taluk: "Mangaluru" },
  { name: "Bajpe", taluk: "Mangaluru" },
  { name: "Surathkal", taluk: "Mangaluru" },
  { name: "Mijar", taluk: "Moodbidri" },
  { name: "Shirthady", taluk: "Moodbidri" },
  { name: "Nelyadi", taluk: "Kadaba" },
  { name: "Alankar", taluk: "Kadaba" },
];

const FIRST_F = ["Lakshmi", "Sunanda", "Girija", "Savitha", "Prema", "Shobha", "Vimala", "Bhavani", "Kamala", "Leela", "Yamuna", "Sharada", "Fathima", "Mary", "Jayanthi"];
const FIRST_M = ["Ramesh", "Sanjeeva", "Ganesh", "Vasantha", "Babu", "Ismail", "Krishna", "Narayana", "Umesh", "Shekhar", "Joseph", "Mohan", "Seetharam", "Dinesh"];
const LAST = ["Shetty", "Poojary", "Gowda", "Naik", "Bhat", "Rai", "Acharya", "Hegde", "Kotian", "Salian", "D'Souza", "Moolya", "Bangera", "Suvarna"];
const RISKS: RiskLevel[] = ["LOW", "LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "NEEDS_REVIEW", "CANNOT_ASSESS"];

export const PATIENTS: Patient[] = Array.from({ length: 48 }, (_, i) => {
  const sex = rand() > 0.48 ? "female" : "male";
  const v = pick(VILLAGES);
  const risk = pick(RISKS);
  return {
    id: `PT-${(24100 + i * 7).toString()}`,
    name: `${sex === "female" ? pick(FIRST_F) : pick(FIRST_M)} ${pick(LAST)}`,
    age: 32 + Math.floor(rand() * 42),
    sex,
    phone: `9${Math.floor(100000000 + rand() * 899999999)}`,
    village: v.name,
    taluk: v.taluk,
    preferredLanguage: pick(["kn", "tcy", "kn", "en"] as const),
    registeredAt: daysAgo(30 + Math.floor(rand() * 300)),
    lastScreeningAt: daysAgo(Math.floor(rand() * 60), Math.floor(rand() * 10)),
    lastRisk: risk,
    reviewed: risk === "LOW" ? rand() > 0.6 : rand() > 0.4,
    referralStatus: risk === "HIGH" || risk === "MEDIUM" ? pick(["issued", "booked", "visited", "completed", "overdue"] as const) : undefined,
  } satisfies Patient;
}).sort((a, b) => (b.lastScreeningAt ?? "").localeCompare(a.lastScreeningAt ?? ""));

export function screeningHistory(p: Patient): Screening[] {
  const n = 1 + (p.name.length % 3);
  return Array.from({ length: n }, (_, i) => ({
    id: `SC-${p.id.slice(3)}-${i}`,
    patientId: p.id,
    date: i === 0 ? p.lastScreeningAt! : daysAgo(120 * i + 30),
    risk: i === 0 ? p.lastRisk! : pick(["LOW", "MEDIUM"] as const),
    reviewed: i > 0 || !!p.reviewed,
    reviewer: i > 0 || p.reviewed ? "Dr. Meera" : undefined,
    summary: i === 0 ? "Seven-site photo screening with habit & symptom history." : "Routine follow-up screening.",
  }));
}

export const QUEUE: QueueCase[] = PATIENTS.filter((p) => p.lastRisk !== "LOW" || rand() > 0.7)
  .slice(0, 16)
  .map((p, i) => ({
    id: `CASE-${3300 + i}`,
    patient: { id: p.id, name: p.name, age: p.age, sex: p.sex, village: p.village },
    risk: p.lastRisk!,
    priority: p.lastRisk === "HIGH" ? 1 : p.lastRisk === "NEEDS_REVIEW" || p.lastRisk === "MEDIUM" ? 2 : 3,
    caseType: p.lastRisk === "CANNOT_ASSESS" ? "low_quality" : pick(["first_screening", "first_screening", "follow_up", "second_opinion"] as const),
    submittedAt: daysAgo(Math.floor(rand() * 4), Math.floor(rand() * 20)),
    submittedBy: pick(["Kavya (ASHA)", "Rekha (Nurse)", "Asha D. (ASHA)"]),
    aiConfidence: 0.55 + rand() * 0.4,
  }));

export const REFERRALS: Referral[] = PATIENTS.filter((p) => p.referralStatus).map((p, i) => ({
  code: `RF-${(7400 + i * 13).toString(36).toUpperCase()}-${p.id.slice(-3)}`,
  patientId: p.id,
  patientName: p.name,
  facility: "Govt. Dental College, Mangaluru",
  visitBy: p.lastRisk === "HIGH" ? daysAhead(7 - i) : daysAhead(21 - i),
  status: p.referralStatus!,
  issuedAt: p.lastScreeningAt!,
  risk: p.lastRisk!,
  smsSent: true,
}));

export const NOTIFICATIONS: AppNotification[] = [
  { id: "n1", kind: "review", title: "Specialist review completed", body: "Dr. Meera confirmed referral for Lakshmi Shetty (PT-24107).", at: daysAgo(0, 1), read: false },
  { id: "n2", kind: "referral", title: "Referral visited", body: "Ramesh Poojary attended the dental college on time.", at: daysAgo(0, 3), read: false },
  { id: "n3", kind: "followup", title: "4 follow-ups due this week", body: "Ujire and Dharmasthala have patients due for 3-month follow-up.", at: daysAgo(0, 6), read: false },
  { id: "n4", kind: "system", title: "Screening model updated", body: "Version 2.4.1 is now active. No action needed.", at: daysAgo(1), read: true },
  { id: "n5", kind: "referral", title: "Referral overdue", body: "Girija Gowda has not visited by the referral date.", at: daysAgo(2), read: true },
  { id: "n6", kind: "review", title: "Case returned: retake photos", body: "Under-tongue photo was too blurred for assessment.", at: daysAgo(3), read: true },
];

export const MODELS: ModelVersion[] = [
  { id: "m5", version: "2.5.0-rc1", status: "candidate", createdAt: daysAgo(3), sensitivity: 0.934, specificity: 0.861, auc: 0.951, datasetId: "DS-2026-10", notes: "Retrained with 2,140 newly reviewed cases; adds palate augmentation." },
  { id: "m4", version: "2.4.1", status: "active", createdAt: daysAgo(42), sensitivity: 0.912, specificity: 0.858, auc: 0.938, datasetId: "DS-2026-08", notes: "Current production model." },
  { id: "m3", version: "2.5.0-shadow", status: "shadow", createdAt: daysAgo(18), sensitivity: 0.926, specificity: 0.849, auc: 0.944, datasetId: "DS-2026-09", notes: "Running silently alongside 2.4.1 for comparison." },
  { id: "m2", version: "2.3.0", status: "retired", createdAt: daysAgo(160), sensitivity: 0.887, specificity: 0.842, auc: 0.921, datasetId: "DS-2026-04", notes: "Retired after drift on under-tongue site." },
  { id: "m1", version: "2.2.2", status: "retired", createdAt: daysAgo(260), sensitivity: 0.871, specificity: 0.83, auc: 0.909, datasetId: "DS-2025-12", notes: "Legacy." },
];

export const RULES: RuleThreshold[] = [
  { id: "r1", name: "High-risk threshold", description: "Model score at or above which a case is marked HIGH and auto-referred.", current: 0.72, unit: "score" },
  { id: "r2", name: "Medium-risk threshold", description: "Score at or above which a case is MEDIUM and queued for review.", current: 0.45, unit: "score" },
  { id: "r3", name: "Minimum image quality", description: "Below this, the site is marked CANNOT ASSESS.", current: 0.6, unit: "score" },
  { id: "r4", name: "High-risk visit window", description: "Days within which a HIGH-risk patient must visit.", current: 7, unit: "days" },
  { id: "r5", name: "Follow-up interval (medium)", description: "Days until a MEDIUM-risk follow-up is due.", current: 90, unit: "days" },
];

export const PROPOSALS: RuleProposal[] = [
  { id: "p1", ruleId: "r1", ruleName: "High-risk threshold", oldValue: 0.72, newValue: 0.68, reason: "Shadow-mode data shows 6 missed early lesions at 0.68–0.72; specificity cost is ~1.4%.", proposedBy: "Dr. Kiran (Clinical lead)", proposedById: "u-kiran", proposedAt: daysAgo(2), status: "pending" },
  { id: "p2", ruleId: "r4", ruleName: "High-risk visit window", oldValue: 7, newValue: 10, reason: "Dental college requests extra days due to OPD load on weekends.", proposedBy: "Dr. Anand (Clinical lead)", proposedById: "u-lead", proposedAt: daysAgo(1), status: "pending" },
  { id: "p3", ruleId: "r3", ruleName: "Minimum image quality", oldValue: 0.55, newValue: 0.6, reason: "Reduce un-assessable images reaching specialists.", proposedBy: "Dr. Kiran (Clinical lead)", proposedById: "u-kiran", proposedAt: daysAgo(30), status: "approved" },
];

function hash(n: number) {
  let h = (n * 2654435761) >>> 0;
  return h.toString(16).padStart(8, "0") + ((h ^ 0x5bd1e995) >>> 0).toString(16).padStart(8, "0");
}
const ACTIONS = [
  ["VIEW", "patient"],
  ["CREATE", "screening"],
  ["UPDATE", "referral"],
  ["REVIEW", "case"],
  ["LOGIN", "session"],
  ["EXPORT", "district_report"],
  ["APPROVE", "rule_change"],
  ["VIEW", "photos"],
] as const;
const ACTORS: [string, Role][] = [
  ["Kavya", "asha"],
  ["Rekha", "nurse"],
  ["Dr. Meera", "specialist"],
  ["Mr. Suresh", "district_officer"],
  ["Dr. Anand", "clinical_lead"],
  ["Farhan", "admin"],
];
export const AUDIT: AuditEntry[] = Array.from({ length: 60 }, (_, i) => {
  const [action, res] = pick(ACTIONS);
  const [actor, role] = pick(ACTORS);
  return {
    id: `AU-${90000 - i}`,
    at: new Date(Date.now() - i * 47 * 60000).toISOString(),
    actor,
    role,
    action,
    resource: `${res}/${res === "patient" || res === "photos" ? pick(PATIENTS).id : Math.floor(rand() * 9000 + 1000)}`,
    ip: `10.12.${Math.floor(rand() * 40)}.${Math.floor(rand() * 250)}`,
    hash: hash(90000 - i),
    prevHash: hash(90000 - i - 1),
    tampered: i === 23,
  };
});

export const SERVICES: ServiceHealth[] = [
  { id: "api", name: "Core API", state: "operational", latencyMs: 84, uptime: 99.98, description: "Patients, screenings, referrals" },
  { id: "inference", name: "AI inference", state: "operational", latencyMs: 1240, uptime: 99.91, description: "ONNX screening model workers" },
  { id: "storage", name: "Photo storage", state: "operational", latencyMs: 132, uptime: 99.99, description: "Encrypted object storage" },
  { id: "sms", name: "SMS gateway", state: "degraded", latencyMs: 2900, uptime: 98.7, description: "Referral & reminder messages" },
  { id: "voice", name: "Voice (IVR)", state: "operational", latencyMs: 410, uptime: 99.6, description: "Follow-up voice calls" },
  { id: "sync", name: "Offline sync", state: "operational", latencyMs: 210, uptime: 99.95, description: "Mobile upload queue" },
  { id: "realtime", name: "Realtime capture", state: "operational", latencyMs: 46, uptime: 99.9, description: "Phone ↔ desktop capture sessions" },
  { id: "audit", name: "Audit ledger", state: "operational", latencyMs: 61, uptime: 100, description: "Hash-chained audit log" },
];

export const FAILED_JOBS: FailedJob[] = [
  { id: "job-881", type: "sms.referral_confirmation", error: "Gateway timeout (504) after 30s", attempts: 3, lastTriedAt: daysAgo(0, 1) },
  { id: "job-877", type: "inference.rescore", error: "Image decode failed: truncated JPEG", attempts: 2, lastTriedAt: daysAgo(0, 2) },
  { id: "job-860", type: "sync.upload_bundle", error: "Checksum mismatch on photo 4/7", attempts: 5, lastTriedAt: daysAgo(0, 5) },
  { id: "job-842", type: "voice.followup_call", error: "Number unreachable", attempts: 3, lastTriedAt: daysAgo(1) },
];

export const MESSAGES: MessageLog[] = Array.from({ length: 24 }, (_, i) => ({
  id: `MSG-${5100 + i}`,
  channel: rand() > 0.3 ? "sms" : "voice",
  to: `98•••••${Math.floor(100 + rand() * 899)}`,
  template: pick(["referral_issued", "visit_reminder", "followup_due", "result_reviewed", "health_card"]),
  status: rand() > 0.85 ? "failed" : rand() > 0.9 ? "queued" : "delivered",
  at: new Date(Date.now() - i * 83 * 60000).toISOString(),
}));
