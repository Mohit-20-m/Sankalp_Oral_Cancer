import { motion, AnimatePresence } from "framer-motion";
import { Leaf, Cigarette, Wine, type LucideIcon } from "lucide-react";
import { useDraft } from "../state";
import { useI18n } from "@/i18n";
import { ChoiceGroup, NumberStepper } from "@/components/forms/ChoiceGroup";
import type { HabitEntry, HabitKind, HabitStatus } from "@/types";
import { cn } from "@/utils/cn";

const META: Record<HabitKind, { icon: LucideIcon; tone: string; deep: string; hint: string; forms?: string[] }> = {
  areca: { icon: Leaf, tone: "bg-mint", deep: "text-primary-deep", hint: "Supari / paan / gutka with areca" },
  tobacco: { icon: Cigarette, tone: "bg-butter", deep: "text-[#5A4500]", hint: "Chewing, beedi, cigarette, snuff", forms: ["Chewing", "Beedi", "Cigarette", "Snuff", "Mixed"] },
  alcohol: { icon: Wine, tone: "bg-lilac", deep: "text-[#3D2F80]", hint: "Toddy, arrack, beer, spirits" },
};

function HabitCard({ h }: { h: HabitEntry }) {
  const { t } = useI18n();
  const { dispatch } = useDraft();
  const m = META[h.kind];
  const I = m.icon;
  const set = (patch: Partial<HabitEntry>) => dispatch({ type: "habit", habit: { ...h, ...patch } });
  const active = h.status !== "never";
  return (
    <motion.div layout className={cn("overflow-hidden rounded-4xl p-6 transition-colors", active ? m.tone : "bg-surface shadow-soft")}>
      <div className="flex items-center gap-4">
        <span className={cn("grid size-14 place-items-center rounded-3xl", active ? "bg-white/70" : m.tone, m.deep)}>
          <I className="size-7" strokeWidth={1.8} />
        </span>
        <div className="flex-1">
          <h3 className="text-xl font-bold">{t(`habit.${h.kind}`)}</h3>
          <p className="text-sm text-ink-mute">{m.hint}</p>
        </div>
      </div>
      <ChoiceGroup
        name={`habit-${h.kind}`}
        size="lg"
        className="mt-5"
        value={h.status}
        onChange={(v: HabitStatus) => set({ status: v, years: v === "never" ? undefined : h.years })}
        options={[
          { value: "never", label: t("habit.never") },
          { value: "current", label: t("habit.current") },
          { value: "past", label: t("habit.past") },
        ]}
      />
      <AnimatePresence initial={false}>
        {active && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="mt-5 flex flex-wrap gap-6 border-t border-ink/10 pt-5">
              <div>
                <p className="mb-2 text-sm font-semibold text-ink-soft">{t("habit.years")}</p>
                <NumberStepper label="Years" value={h.years} onChange={(n) => set({ years: n })} suffix="years" max={80} />
              </div>
              {h.status === "current" && (
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink-soft">{t("habit.perDay")}</p>
                  <NumberStepper label="Times per day" value={h.perDay} onChange={(n) => set({ perDay: n })} suffix="per day" max={60} />
                </div>
              )}
              {m.forms && (
                <div className="w-full">
                  <p className="mb-2 text-sm font-semibold text-ink-soft">Form</p>
                  <div className="flex flex-wrap gap-2">
                    {m.forms.map((f) => (
                      <button key={f} type="button" onClick={() => set({ form: f })} className={cn("h-10 rounded-full px-4 text-sm font-semibold transition", h.form === f ? "bg-primary-deep text-white" : "bg-white/70 text-ink-soft hover:text-ink")} aria-pressed={h.form === f}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function HabitsStep() {
  const { draft } = useDraft();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {draft.habits.map((h) => (
        <HabitCard key={h.kind} h={h} />
      ))}
    </div>
  );
}
