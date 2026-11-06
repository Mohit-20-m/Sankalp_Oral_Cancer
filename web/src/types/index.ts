/* Shared domain types. Shapes mirror the backend contracts; adjust field names
   in src/services/http/*.ts adapters if the Python API differs. */

export type Language = "en" | "kn" | "tcy";

export type Role =
  | "asha"
  | "nurse"
  | "specialist"
  | "local_doctor"
  | "district_officer"
  | "clinical_lead"
  | "admin";

export interface User {
  id: string;
  name: string;
  displayName: string;
  role: Role;
  facility: string;
  initials: string;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CANNOT_ASSESS" | "NEEDS_REVIEW";

export type Sex = "female" | "male" | "other";

export interface Patient {
  id: string;
  /** Short human ID printed on cards and slips (e.g. DK-7F3K2Q); falls back to id. */
  displayId?: string;
  name: string;
  age: number;
  sex: Sex;
  phone: string;
  village: string;
  taluk: string;
  preferredLanguage: Language;
  registeredAt: string;
  lastScreeningAt?: string;
  lastRisk?: RiskLevel;
  reviewed?: boolean;
  referralStatus?: ReferralStatus;
  referralFacility?: string | null;
}

export type SiteId =
  | "left_cheek"
  | "right_cheek"
  | "tongue_top"
  | "tongue_under"
  | "gums"
  | "palate"
  | "open_mouth";

export interface PhotoSite {
  id: SiteId;
  index: number;
  labelKey: string;
  instructionKey: string;
}

export type QualityLevel = "good" | "fair" | "poor";

export interface QualityReport {
  blur: { score: number; level: QualityLevel };
  lighting: { score: number; level: QualityLevel };
  glare: { score: number; level: QualityLevel };
  /** Share of mouth-tissue-coloured pixels (the server's "not_mouth_tissue" check). */
  tissue?: { score: number; level: QualityLevel };
  overall: QualityLevel;
  acceptable: boolean;
}

export interface CapturedPhoto {
  site: SiteId;
  dataUrl: string;
  quality: QualityReport;
  capturedAt: string;
  source: "phone" | "webcam" | "upload";
}

export type HabitKind = "areca" | "tobacco" | "alcohol";
export type HabitStatus = "never" | "current" | "past";
export interface HabitEntry {
  kind: HabitKind;
  status: HabitStatus;
  years?: number;
  perDay?: number;
  form?: string;
}

export type YesNo = "yes" | "no" | "unsure" | null;
export interface SymptomAnswers {
  burningSpicy: YesNo;
  difficultyOpening: YesNo;
  patches: "none" | "white" | "red" | "both" | null;
  patchWeeks?: number;
  pain: YesNo;
  nonHealingUlcer: YesNo;
  takingMedicines: YesNo;
  medicineNames?: string;
  medicinePhoto?: string;
}

export type ConsentMethod = "fingerprint" | "signature" | "verbal_witness";
export interface ConsentRecord {
  screening: boolean;
  photos: boolean;
  research: boolean;
  method: ConsentMethod | null;
  signatureDataUrl?: string;
  witnessName?: string;
  capturedAt?: string;
}

export interface MouthMeasurement {
  attemptsMm: number[];
  finalMm?: number;
  tiltWarning: boolean;
  /** "auto" = points found by on-device face landmarks (MediaPipe), "manual" = tapped by the worker. */
  method?: "auto" | "manual";
  /** Raw photo-pixel readings sent to the server, which recomputes mm: iris width (scale) and lip gap. */
  readings?: { iris_px: number; tap_px: number }[];
  /** Head pose from the face landmarks (degrees); the server warns above 12° yaw/pitch. */
  headPose?: { yaw: number; pitch: number; roll: number };
  /** Marked points in photo pixels (kept so the step can be revisited). */
  points?: MouthPoints;
  /** capturedAt of the open-mouth photo the points belong to (a new photo means measuring again). */
  photoAt?: string;
}

export interface MouthPoints {
  /** One or two irises, each as [edge, edge] across its horizontal diameter. */
  irises: [{ x: number; y: number }, { x: number; y: number }][];
  /** Inner edge of the upper lip, inner edge of the lower lip. */
  lips?: [{ x: number; y: number }, { x: number; y: number }];
}

export interface SiteScore {
  site: SiteId;
  score: number; // 0..1 model output
  flagged: boolean;
}

export interface AiResult {
  risk: RiskLevel;
  confidence: number;
  modelVersion: string;
  reasons: string[];
  siteScores: SiteScore[];
  preliminary: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  /** AI flagged photo(s) but there are no other warning signs: retake these sites once before a doctor checks. */
  retake?: { sites: SiteId[]; deadline: string };
  /** AI-only flag (rule R1b): a doctor double-checks the photos; no referral and no travel needed yet. */
  aiOnlyFlag?: boolean;
}

export type ReferralStatus = "issued" | "booked" | "visited" | "completed" | "overdue";

export interface Referral {
  code: string;
  patientId: string;
  patientName: string;
  facility: string;
  visitBy: string;
  status: ReferralStatus;
  issuedAt: string;
  risk: RiskLevel;
  smsSent: boolean;
  /** Booked appointment (ISO date-time), if any. */
  bookedFor?: string | null;
}

export interface ScreeningDraft {
  patient?: Patient;
  consent: ConsentRecord;
  habits: HabitEntry[];
  symptoms: SymptomAnswers;
  photos: Partial<Record<SiteId, CapturedPhoto>>;
  mouth: MouthMeasurement;
}

export interface Screening {
  id: string;
  patientId: string;
  date: string;
  risk: RiskLevel;
  reviewed: boolean;
  reviewer?: string;
  reviewVerdict?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  summary: string;
}

/* Specialist */
export type CaseType = "first_screening" | "follow_up" | "second_opinion" | "low_quality";
export interface QueueCase {
  id: string;
  patient: Pick<Patient, "id" | "name" | "age" | "sex" | "village" | "displayId">;
  priority: 1 | 2 | 3;
  risk: RiskLevel;
  caseType: CaseType;
  submittedAt: string;
  submittedBy: string;
  aiConfidence: number;
}

export type ReviewDecision = "confirm_referral" | "not_suspicious" | "needs_biopsy" | "cannot_assess";

/* Notifications */
export type NotificationKind = "review" | "referral" | "followup" | "system";
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

/* Governance / models */
export type ModelStatus = "active" | "shadow" | "retired" | "candidate";
export interface ModelVersion {
  id: string;
  version: string;
  status: ModelStatus;
  createdAt: string;
  sensitivity: number;
  specificity: number;
  auc: number;
  datasetId: string;
  notes: string;
}

export interface RuleThreshold {
  id: string;
  name: string;
  description: string;
  current: number;
  unit: string;
}

export interface RuleProposal {
  id: string;
  ruleId: string;
  ruleName: string;
  oldValue: number;
  newValue: number;
  reason: string;
  proposedBy: string;
  proposedById: string;
  proposedAt: string;
  status: "pending" | "approved" | "rejected";
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: Role;
  action: string;
  resource: string;
  ip: string;
  hash: string;
  prevHash: string;
  tampered?: boolean;
}

export type ServiceState = "operational" | "degraded" | "down";
export interface ServiceHealth {
  id: string;
  name: string;
  state: ServiceState;
  latencyMs: number;
  uptime: number;
  description: string;
}

export interface FailedJob {
  id: string;
  type: string;
  error: string;
  attempts: number;
  lastTriedAt: string;
}

export interface MessageLog {
  id: string;
  channel: "sms" | "voice";
  to: string;
  template: string;
  status: "delivered" | "failed" | "queued";
  at: string;
}
