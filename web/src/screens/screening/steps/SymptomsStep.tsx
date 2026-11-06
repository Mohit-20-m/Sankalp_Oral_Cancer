import { motion, AnimatePresence } from "framer-motion";
import { Flame, MoveVertical, Palette, Frown, CircleDot, Pill, Camera, X } from "lucide-react";
import { useRef } from "react";
import { useDraft } from "../state";
import { useI18n } from "@/i18n";
import { ChoiceGroup, NumberStepper } from "@/components/forms/ChoiceGroup";
import { Input, Label } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { compressFile } from "@/utils/imageQuality";
import type { SymptomAnswers } from "@/types";
import { cn } from "@/utils/cn";

type YN = "yes" | "no" | "unsure";

function Q({ n, icon: I, q, children, answered }: { n: number; icon: typeof Flame; q: string; children: React.ReactNode; answered: boolean }) {
  return (
    <motion.li layout className={cn("rounded-4xl p-5 transition-colors", answered ? "bg-surface shadow-soft" : "bg-surface shadow-soft ring-2 ring-accent")}>
      <div className="flex flex-wrap items-center gap-4">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", answered ? "bg-mint text-primary-deep" : "bg-accent text-primary-deep")}>
          <I className="size-6" strokeWidth={1.8} />
        </span>
        <p className="min-w-[240px] flex-1 text-[17px] font-semibold leading-snug">
          <span className="mr-2 text-ink-mute">{n}.</span>
          {q}
        </p>
        {children}
      </div>
    </motion.li>
  );
}

export function SymptomsStep() {
  const { t } = useI18n();
  const { draft, dispatch } = useDraft();
  const s = draft.symptoms;
  const set = (p: Partial<SymptomAnswers>) => dispatch({ type: "symptoms", symptoms: p });
  const fileRef = useRef<HTMLInputElement>(null);
  const yn = [
    { value: "yes" as YN, label: t("common.yes") },
    { value: "no" as YN, label: t("common.no") },
    { value: "unsure" as YN, label: t("common.notSure") },
  ];

  return (
    <ul className="space-y-3">
      <Q n={1} icon={Flame} q={t("sym.burning")} answered={s.burningSpicy !== null}>
        <ChoiceGroup name="burning" value={s.burningSpicy} onChange={(v: YN) => set({ burningSpicy: v })} options={yn} />
      </Q>
      <Q n={2} icon={MoveVertical} q={t("sym.opening")} answered={s.difficultyOpening !== null}>
        <ChoiceGroup name="opening" value={s.difficultyOpening} onChange={(v: YN) => set({ difficultyOpening: v })} options={yn} />
      </Q>
      <Q n={3} icon={Palette} q={t("sym.patches")} answered={s.patches !== null}>
        <ChoiceGroup
          name="patches"
          value={s.patches}
          onChange={(v) => set({ patches: v, patchWeeks: v === "none" ? undefined : s.patchWeeks })}
          options={[
            { value: "none", label: "None" },
            { value: "white", label: "White" },
            { value: "red", label: "Red" },
            { value: "both", label: "Both" },
          ]}
        />
        <AnimatePresence>
          {s.patches && s.patches !== "none" && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="w-full overflow-hidden">
              <div className="mt-2 flex flex-wrap items-center gap-4 rounded-3xl bg-butter/60 p-4">
                <p className="flex-1 text-sm font-semibold">{t("sym.patchWeeks")}</p>
                <NumberStepper label="Weeks" value={s.patchWeeks} onChange={(n) => set({ patchWeeks: n })} suffix="weeks" max={520} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Q>
      <Q n={4} icon={Frown} q={t("sym.pain")} answered={s.pain !== null}>
        <ChoiceGroup name="pain" value={s.pain} onChange={(v: YN) => set({ pain: v })} options={yn} />
      </Q>
      <Q n={5} icon={CircleDot} q={t("sym.ulcer")} answered={s.nonHealingUlcer !== null}>
        <ChoiceGroup name="ulcer" value={s.nonHealingUlcer} onChange={(v: YN) => set({ nonHealingUlcer: v })} options={yn} />
      </Q>
      <Q n={6} icon={Pill} q={t("sym.medicines")} answered={s.takingMedicines !== null}>
        <ChoiceGroup name="meds" value={s.takingMedicines} onChange={(v: YN) => set({ takingMedicines: v })} options={yn} />
        <AnimatePresence>
          {s.takingMedicines === "yes" && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="w-full overflow-hidden">
              <div className="mt-2 grid grid-cols-1 gap-4 rounded-3xl bg-sky/60 p-4 md:grid-cols-[1fr_auto]">
                <div>
                  <Label htmlFor="meds">Medicine names (if known)</Label>
                  <Input id="meds" value={s.medicineNames ?? ""} onChange={(e) => set({ medicineNames: e.target.value })} placeholder="e.g. Metformin, Amlodipine" />
                </div>
                <div className="flex items-end gap-3">
                  {s.medicinePhoto ? (
                    <div className="relative">
                      <img src={s.medicinePhoto} alt="Medicine strip" className="size-[72px] rounded-2xl object-cover" />
                      <button onClick={() => set({ medicinePhoto: undefined })} className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-ink text-white" aria-label="Remove photo">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                      <Camera /> Photo of medicine
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) set({ medicinePhoto: await compressFile(f) });
                    }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Q>
    </ul>
  );
}
