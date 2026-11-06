/**
 * Service contracts. Screens depend ONLY on these interfaces.
 * Two implementations exist:
 *   • src/mocks/mockServices.ts   — demo data (VITE_API_MODE=mock)
 *   • src/services/http/index.ts  — real Python backend (VITE_API_MODE=http)
 */
import type {
  AiResult,
  AppNotification,
  AuditEntry,
  CapturedPhoto,
  FailedJob,
  HabitEntry,
  MessageLog,
  ModelVersion,
  Patient,
  QueueCase,
  Referral,
  ReferralStatus,
  ReviewDecision,
  RiskLevel,
  RuleProposal,
  RuleThreshold,
  Screening,
  ScreeningDraft,
  ServiceHealth,
  SiteId,
  SymptomAnswers,
  User,
} from "@/types";

export interface CaseDetail {
  case: QueueCase;
  patient: Patient;
  photos: { site: SiteId; url: string; heat: { x: number; y: number; r: number; w: number }[]; heatmapUrl?: string | null }[];
  ai: AiResult;
  habits: HabitEntry[];
  symptoms: SymptomAnswers;
  mouthOpeningMm: number;
  timeline: { at: string; label: string; detail?: string }[];
  previous?: { date: string; risk: RiskLevel; photos: { site: SiteId; url: string }[] };
  similar: { id: string; site: SiteId; url: string; similarity: number; finalLabel: string; risk: RiskLevel }[];
}

export interface ReviewInput {
  decision: ReviewDecision;
  diagnosis: string;
  siteDecisions: Partial<Record<SiteId, "refer" | "no_refer" | "unclear">>;
  overrideReason?: string;
  notes: string;
}

export interface SpecialistStats {
  reviewed: number;
  agreementRate: number;
  medianMinutes: number;
  thisWeek: number;
  byDay: { day: string; reviewed: number; agreed: number }[];
  byDecision: { name: string; value: number }[];
}

export interface DistrictFilters {
  taluk: string | "all";
  range: "30d" | "90d" | "12m";
}
export interface DistrictAnalytics {
  totals: { screened: number; highRisk: number; referred: number; visited: number; overdue: number };
  volume: { month: string; screened: number }[];
  riskTrend: { month: string; LOW: number; MEDIUM: number; HIGH: number }[];
  funnel: { stage: string; value: number }[];
  villages: { name: string; taluk: string; screened: number | null; highRisk: number | null; coverage: number | null }[];
  /** Taluk names for the filter (from the backend's village list). */
  taluks?: string[];
}

export interface Village {
  id: string;
  name: string;
  taluk: string;
}

export interface VisitPhotos {
  screeningId: string;
  date: string;
  risk: RiskLevel | null;
  mouthOpeningMm: number | null;
  photos: Partial<Record<SiteId, { url: string; heatmapUrl?: string | null; score?: number | null }>>;
}

export interface CareNote {
  at: string;
  by: string;
  text: string;
}

export interface CareRecord {
  notes: CareNote[];
  medicines: { name: string; detail: string; by: string; masksSymptoms: boolean }[];
  responses: { at: string; channel: string; text: string; ok: boolean }[];
}

export interface GovernanceData {
  datasets: { id: string; name: string; images: number | null; licence: string; commercialUse: boolean; issues?: string | null }[];
  snapshots: { id: string; createdAt: string; samples: number; labels: Record<string, number>; sources: Record<string, number>; usedBy?: string | null; sha256: string }[];
  drift: { id: string; createdAt: string; modelVersion: string; alert: boolean; psiProb: number | null; psiEmbedding: number | null; oodRate: number | null; reportUrl?: string | null }[];
  fairness: { createdAt: string; modelVersion: string; reviews: number; groups: { group: string; key: string; n: number; sensitivity: number | null; specificity: number | null; agreement: number | null; suppressed?: boolean }[] } | null;
  incidents: { id: string; kind: string; severity: string; status: string; description: string; createdAt: string; modelVersion?: string | null }[];
}

export interface CaptureSession {
  id: string;
  url: string;
  expiresAt: string;
}
export type CaptureEvent =
  | { type: "connected"; device: string }
  | { type: "photo"; photo: CapturedPhoto }
  | { type: "disconnected" }
  | { type: "expired" };

export interface ProviderSummary {
  patient: Pick<Patient, "id" | "name" | "age" | "sex" | "village">;
  risk: RiskLevel;
  reviewed: boolean;
  referral?: Referral;
  medicines: { name: string; dose: string; since: string; addedBy: string }[];
  history: { date: string; event: string }[];
  notes: { at: string; by: string; text: string }[];
  accessExpiresAt: string;
}

/** Real counts for each role's home page (fields present depend on the role). */
export interface HomeSummary {
  screenedToday?: number;
  screenedAvg?: number;
  followupsDue?: number;
  followupsOverdue?: number;
  pendingUploads?: number;
  activeReferrals?: number;
  visitedThisWeek?: number;
  facilities?: number;
  screened90d?: number;
  overdueReferrals?: number;
  worstTaluk?: string | null;
  candidateModels?: number;
  activeModel?: string | null;
  pendingRules?: number;
  openIncidents?: number;
  failedJobs?: number;
  failedMessages?: number;
}

export interface Services {
  home: { summary(): Promise<HomeSummary> };
  auth: {
    login(username: string, password: string): Promise<User>;
    logout(): Promise<void>;
    /** Re-open an existing session after a page reload (null when signed out). */
    restore?(): Promise<User | null>;
  };
  patients: {
    search(q: string): Promise<Patient[]>;
    get(id: string): Promise<Patient>;
    register(p: Omit<Patient, "id" | "registeredAt">): Promise<Patient>;
    history(id: string): Promise<Screening[]>;
    /** Same mouth sites across visits (oldest → newest) for the follow-up comparison. */
    visits(id: string): Promise<VisitPhotos[]>;
    /** Care notes, medicines and SMS / voice check-in replies from the patient's timeline. */
    care(id: string): Promise<CareRecord>;
    /** Issue (or re-issue) the patient's QR health card. The QR opens Provider Connect with the patient's OTP consent. */
    issueCard(id: string): Promise<{ link: string; displayId: string }>;
    addNote(id: string, text: string): Promise<void>;
  };
  reference: {
    villages(): Promise<Village[]>;
    /** Active screening model, e.g. "1.0.0" or "placeholder-0.1 (placeholder)". */
    modelVersion(): Promise<string>;
  };
  screening: {
    submit(d: ScreeningDraft): Promise<{ screeningId: string; result: AiResult; referral?: Referral }>;
    /** Send the retaken photo(s) the result asked for, then wait for the updated result. */
    retake(screeningId: string, photos: CapturedPhoto[]): Promise<{ screeningId: string; result: AiResult; referral?: Referral }>;
  };
  capture: {
    createSession(): Promise<CaptureSession>;
    subscribe(sessionId: string, cb: (e: CaptureEvent) => void): () => void;
    /** Called by the phone page. */
    sendPhoto(sessionId: string, photo: CapturedPhoto): Promise<void>;
    announce(sessionId: string, device: string): void;
  };
  specialist: {
    queue(): Promise<QueueCase[]>;
    getCase(id: string): Promise<CaseDetail>;
    submitReview(id: string, r: ReviewInput): Promise<void>;
    stats(): Promise<SpecialistStats>;
  };
  referrals: {
    list(): Promise<Referral[]>;
    lookup(code: string): Promise<Referral>;
    /** bookedFor (ISO date-time) is required when status is "booked" (also used to reschedule). */
    setStatus(code: string, status: ReferralStatus, bookedFor?: string): Promise<Referral>;
  };
  provider: {
    requestOtp(input: { qrToken: string; doctorName: string; phone: string; regNo: string }): Promise<{ requestId: string; maskedPhone: string; demoCode?: string }>;
    verifyOtp(requestId: string, otp: string): Promise<ProviderSummary>;
    addNote(text: string): Promise<void>;
    addMedicine(m: { name: string; dose: string }): Promise<void>;
  };
  district: { analytics(f: DistrictFilters): Promise<DistrictAnalytics> };
  lead: {
    models(): Promise<ModelVersion[]>;
    modelAction(id: string, action: "promote" | "shadow" | "rollback" | "retire" | "retrain"): Promise<void>;
    rules(): Promise<RuleThreshold[]>;
    proposals(): Promise<RuleProposal[]>;
    propose(ruleId: string, newValue: number, reason: string): Promise<RuleProposal>;
    decide(proposalId: string, approve: boolean): Promise<void>;
  };
  governance: {
    load(): Promise<GovernanceData>;
    runDrift(): Promise<{ status: string }>;
    runFairness(): Promise<{ status: string }>;
  };
  admin: {
    health(): Promise<ServiceHealth[]>;
    failedJobs(): Promise<FailedJob[]>;
    retryJob(id: string): Promise<void>;
    messages(): Promise<MessageLog[]>;
    audit(q: string): Promise<AuditEntry[]>;
    verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: string }>;
  };
  notifications: {
    list(): Promise<AppNotification[]>;
    markAllRead(): Promise<void>;
  };
}
