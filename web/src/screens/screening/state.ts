import { createContext, useContext } from "react";
import type { CapturedPhoto, ConsentRecord, HabitEntry, MouthMeasurement, Patient, ScreeningDraft, SiteId, SymptomAnswers } from "@/types";

export const emptyDraft = (): ScreeningDraft => ({
  consent: { screening: false, photos: false, research: false, method: null },
  habits: [
    { kind: "areca", status: "never" },
    { kind: "tobacco", status: "never" },
    { kind: "alcohol", status: "never" },
  ],
  symptoms: { burningSpicy: null, difficultyOpening: null, patches: null, pain: null, nonHealingUlcer: null, takingMedicines: null },
  photos: {},
  mouth: { attemptsMm: [], tiltWarning: false },
});

export type Action =
  | { type: "patient"; patient: Patient }
  | { type: "consent"; consent: Partial<ConsentRecord> }
  | { type: "habit"; habit: HabitEntry }
  | { type: "symptoms"; symptoms: Partial<SymptomAnswers> }
  | { type: "photo"; photo: CapturedPhoto }
  | { type: "removePhoto"; site: SiteId }
  | { type: "mouth"; mouth: Partial<MouthMeasurement> }
  | { type: "reset" };

export function reducer(s: ScreeningDraft, a: Action): ScreeningDraft {
  switch (a.type) {
    case "patient":
      return { ...s, patient: a.patient };
    case "consent":
      return { ...s, consent: { ...s.consent, ...a.consent } };
    case "habit":
      return { ...s, habits: s.habits.map((h) => (h.kind === a.habit.kind ? a.habit : h)) };
    case "symptoms":
      return { ...s, symptoms: { ...s.symptoms, ...a.symptoms } };
    case "photo":
      return { ...s, photos: { ...s.photos, [a.photo.site]: a.photo } };
    case "removePhoto": {
      const p = { ...s.photos };
      delete p[a.site];
      return { ...s, photos: p };
    }
    case "mouth":
      return { ...s, mouth: { ...s.mouth, ...a.mouth } };
    case "reset":
      return emptyDraft();
  }
}

export const DraftCtx = createContext<{ draft: ScreeningDraft; dispatch: (a: Action) => void } | null>(null);
export function useDraft() {
  const c = useContext(DraftCtx);
  if (!c) throw new Error("useDraft outside DraftCtx");
  return c;
}

/** Gating rules per step — "Continue" is disabled until these pass. */
export function stepComplete(id: string, d: ScreeningDraft): boolean {
  switch (id) {
    case "patient":
      return !!d.patient;
    case "consent":
      return d.consent.screening && d.consent.photos && !!d.consent.method && (d.consent.method !== "signature" || !!d.consent.signatureDataUrl) && (d.consent.method !== "verbal_witness" || (d.consent.witnessName?.trim().length ?? 0) > 2);
    case "habits":
      return d.habits.every((h) => h.status === "never" || (h.years ?? 0) > 0);
    case "symptoms": {
      const s = d.symptoms;
      return [s.burningSpicy, s.difficultyOpening, s.patches, s.pain, s.nonHealingUlcer, s.takingMedicines].every((v) => v !== null) && (s.patches === "none" || (s.patchWeeks ?? 0) > 0);
    }
    case "photos":
      return Object.values(d.photos).filter((p) => p?.quality.acceptable).length === 7;
    case "mouth":
      return d.mouth.finalMm !== undefined;
    default:
      return true;
  }
}
