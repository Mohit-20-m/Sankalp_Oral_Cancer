import { useReducer, useState } from "react";
import { patientRef } from "@/utils/format";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Send, X } from "lucide-react";
import { DraftCtx, emptyDraft, reducer, stepComplete } from "./state";
import { SCREENING_STEPS } from "@/config/constants";
import { useI18n } from "@/i18n";
import { Page } from "@/components/common/motion";
import { ProgressStepper } from "@/components/common/ProgressStepper";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { StateView } from "@/components/common/StateView";
import { PatientStep } from "./steps/PatientStep";
import { ConsentStep } from "./steps/ConsentStep";
import { HabitsStep } from "./steps/HabitsStep";
import { SymptomsStep } from "./steps/SymptomsStep";
import { PhotosStep } from "./steps/PhotosStep";
import { MouthStep } from "./steps/MouthStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ResultView } from "./ResultView";
import { services } from "@/services";
import { soundManager } from "@/utils/soundManager";
import { useOnline } from "@/hooks";
import type { AiResult, CapturedPhoto, Referral } from "@/types";
import { useToast } from "@/components/ui/toast";

const SUBTITLE: Record<string, string> = {
  patient: "Search for the patient or register someone new.",
  consent: "Read the consent aloud in the patient's language and record agreement.",
  habits: "Ask about areca nut, tobacco and alcohol use.",
  symptoms: "Ask each question simply. 'Not sure' is a valid answer.",
  photos: "Capture all seven sites. Each photo must pass the quality checks.",
  mouth: "Measure how wide the mouth opens using the open-mouth photo.",
  review: "Check everything once before submitting.",
};

type Phase = { kind: "form" } | { kind: "submitting" } | { kind: "failed" } | { kind: "result"; screeningId: string; result: AiResult; referral?: Referral };

export default function NewScreening() {
  const { t } = useI18n();
  const nav = useNavigate();
  const online = useOnline();
  const toast = useToast();
  const [draft, dispatch] = useReducer(reducer, undefined, emptyDraft);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [maxReached, setMax] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const cur = SCREENING_STEPS[step];
  const canNext = stepComplete(cur.id, draft);

  const go = (i: number) => {
    setDir(i > step ? 1 : -1);
    setStep(i);
    setMax((m) => Math.max(m, i));
    soundManager.play("transition");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function submit() {
    setPhase({ kind: "submitting" });
    try {
      const r = await services.screening.submit(draft);
      soundManager.play("success");
      setPhase({ kind: "result", screeningId: r.screeningId, result: r.result, referral: r.referral });
    } catch {
      soundManager.play("error");
      setPhase({ kind: "failed" });
    }
  }

  async function sendRetake(screeningId: string, photos: CapturedPhoto[]) {
    try {
      const r = await services.screening.retake(screeningId, photos);
      soundManager.play("success");
      setPhase({ kind: "result", screeningId: r.screeningId, result: r.result, referral: r.referral });
    } catch {
      soundManager.play("error");
      toast({ tone: "error", title: "Could not send the retake", body: "Check the connection and try again." });
    }
  }

  if (phase.kind === "submitting") return <StateView state="waitingAi" className="min-h-[60vh] justify-center" />;
  if (phase.kind === "failed")
    return (
      <StateView
        state="uploadFailed"
        className="min-h-[60vh] justify-center"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPhase({ kind: "form" })}>
              Back to review
            </Button>
            <Button onClick={submit}>Retry upload</Button>
          </div>
        }
      />
    );
  if (phase.kind === "result")
    return (
      <Page>
        <ResultView
          result={phase.result}
          referral={phase.referral}
          patient={draft.patient!}
          offline={!online || phase.result.preliminary}
          onNew={() => {
            dispatch({ type: "reset" });
            setStep(0);
            setMax(0);
            setPhase({ kind: "form" });
          }}
          onProfile={() => nav(`/patients/${draft.patient!.id}`)}
          onRetake={(photos) => sendRetake(phase.screeningId, photos)}
        />
      </Page>
    );

  return (
    <DraftCtx.Provider value={{ draft, dispatch }}>
      <Page className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_1fr]">
        {/* Progress rail */}
        <aside className="lg:sticky lg:top-[88px] lg:self-start">
          <div className="card p-4">
            <div className="mb-4 flex items-center justify-between px-1.5">
              <p className="label-eyebrow">{t("nav.newScreening")}</p>
              <button onClick={() => nav("/")} className="grid size-8 place-items-center rounded-full text-ink-mute hover:bg-ink/5" aria-label="Exit screening">
                <X className="size-4" />
              </button>
            </div>
            <ProgressStepper steps={SCREENING_STEPS.map((s) => ({ id: s.id, label: t(s.labelKey) }))} current={step} maxReached={maxReached} onSelect={go} />
            <AnimatePresence>
              {draft.patient && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 overflow-hidden">
                  <div className="flex items-center gap-3 rounded-2xl bg-mint p-3">
                    <PatientAvatar name={draft.patient.name} size={36} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{draft.patient.name}</p>
                      <p className="text-[11px] text-ink-mute">{patientRef(draft.patient)}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>

        {/* Step content */}
        <section className="min-w-0">
          <div className="mb-6">
            <p className="label-eyebrow">
              Step {step + 1} {t("common.of")} {SCREENING_STEPS.length}
            </p>
            <h1 className="mt-1 text-[2rem] font-bold">{t(cur.labelKey)}</h1>
            <p className="mt-1 text-[15px] text-ink-soft">{SUBTITLE[cur.id]}</p>
          </div>

          {/* Enter-only transition: an exit animation with mode="wait" can stall when the old step still has
              animations running (e.g. right after registering a patient), leaving the next step blank. */}
          <>
            <motion.div
              key={cur.id}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {cur.id === "patient" && <PatientStep />}
              {cur.id === "consent" && <ConsentStep />}
              {cur.id === "habits" && <HabitsStep />}
              {cur.id === "symptoms" && <SymptomsStep />}
              {cur.id === "photos" && <PhotosStep />}
              {cur.id === "mouth" && <MouthStep goToPhotos={() => go(4)} />}
              {cur.id === "review" && <ReviewStep goTo={go} />}
            </motion.div>
          </>

          {/* Action bar */}
          <div className="sticky bottom-4 z-10 mt-8 flex items-center gap-3 rounded-full bg-surface/90 p-2 pl-5 shadow-lift backdrop-blur">
            <p className="hidden text-sm text-ink-mute md:block">{canNext ? "Looks good — continue when ready." : "Complete this step to continue."}</p>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" disabled={step === 0} onClick={() => go(step - 1)}>
                <ArrowLeft /> {t("common.back")}
              </Button>
              {cur.id === "review" ? (
                <Button size="lg" className="rounded-full" onClick={() => setConfirm(true)}>
                  <Send /> Submit screening
                </Button>
              ) : (
                <Button size="lg" className="rounded-full" disabled={!canNext} onClick={() => go(step + 1)} sound={null}>
                  {t("common.continue")} <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </section>
      </Page>

      <ConfirmationModal
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit this screening?"
        description={`Photos and answers for ${draft.patient?.name} will be uploaded securely and analysed. You can't edit after submitting.`}
        confirmLabel="Submit"
        onConfirm={() => void submit()}
      />
    </DraftCtx.Provider>
  );
}
