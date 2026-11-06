import { Pencil, BrainCircuit, ShieldCheck } from "lucide-react";
import { patientRef } from "@/utils/format";
import type { ReactNode } from "react";
import { useDraft } from "../state";
import { useI18n } from "@/i18n";
import { PHOTO_SITES } from "@/config/constants";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { QualityPill } from "@/components/screening/QualityMeter";
import { Button } from "@/components/ui/button";
import { Disclaimer } from "@/components/common/misc";

function Section({ title, onEdit, children, className }: { title: string; onEdit: () => void; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-surface p-5 shadow-soft ${className ?? ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${title}`}>
          <Pencil /> Edit
        </Button>
      </div>
      {children}
    </section>
  );
}

const yn = (v: string | null) => (v === "yes" ? "Yes" : v === "no" ? "No" : v === "unsure" ? "Not sure" : "—");

export function ReviewStep({ goTo }: { goTo: (i: number) => void }) {
  const { t } = useI18n();
  const { draft } = useDraft();
  const p = draft.patient!;
  const s = draft.symptoms;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Section title="Patient" onEdit={() => goTo(0)}>
        <div className="flex items-center gap-3">
          <PatientAvatar name={p.name} size={48} />
          <div>
            <p className="font-semibold">{p.name}</p>
            <p className="text-sm text-ink-mute">
              {patientRef(p)} · {p.age} y · {p.village}
            </p>
          </div>
        </div>
      </Section>
      <Section title="Consent" onEdit={() => goTo(1)}>
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-primary" /> Screening & photos agreed
          {draft.consent.research && " · research opt-in"}
        </p>
        <p className="mt-1 text-sm text-ink-mute">Recorded by {draft.consent.method === "signature" ? "signature" : draft.consent.method === "verbal_witness" ? `verbal consent, witness ${draft.consent.witnessName}` : "thumbprint"}</p>
      </Section>
      <Section title="Habits" onEdit={() => goTo(2)}>
        <ul className="space-y-1 text-sm">
          {draft.habits.map((h) => (
            <li key={h.kind} className="flex justify-between">
              <span className="text-ink-soft">{t(`habit.${h.kind}`)}</span>
              <span className="font-semibold">{h.status === "never" ? t("habit.never") : `${t(`habit.${h.status}`)} · ${h.years}y${h.perDay ? ` · ${h.perDay}/day` : ""}`}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Symptoms" onEdit={() => goTo(3)} className="xl:col-span-2">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm md:grid-cols-3">
          {[
            ["Burning (spicy)", yn(s.burningSpicy)],
            ["Difficulty opening", yn(s.difficultyOpening)],
            ["Patches", s.patches === "none" ? "None" : `${s.patches} · ${s.patchWeeks} wk`],
            ["Pain", yn(s.pain)],
            ["Non-healing ulcer", yn(s.nonHealingUlcer)],
            ["Medicines", s.takingMedicines === "yes" ? s.medicineNames || "Yes" : yn(s.takingMedicines)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line py-1.5">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="font-semibold capitalize">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Mouth opening" onEdit={() => goTo(5)}>
        <p className="num text-3xl font-bold">
          {draft.mouth.finalMm} <span className="text-base text-ink-mute">mm</span>
        </p>
        <p className="text-xs text-ink-mute">
          {draft.mouth.method === "auto" ? "Found automatically from the eyes and lips" : draft.mouth.method === "manual" ? "Points marked / adjusted by hand" : `Measurements: ${draft.mouth.attemptsMm.join(" · ")} mm`}
        </p>
        {draft.mouth.tiltWarning && <p className="mt-1 text-xs font-semibold text-[#8A5A00]">Head tilt detected — interpret with care</p>}
      </Section>
      <Section title="Photographs" onEdit={() => goTo(4)} className="xl:col-span-3">
        <div className="grid grid-cols-4 gap-3 md:grid-cols-7">
          {PHOTO_SITES.map((site) => {
            const ph = draft.photos[site.id];
            return (
              <figure key={site.id}>
                <img src={ph?.dataUrl} alt={t(site.labelKey)} className="aspect-square w-full rounded-2xl object-cover" />
                <figcaption className="mt-1.5 flex flex-col gap-1">
                  <span className="truncate text-xs font-semibold">{t(site.labelKey)}</span>
                  {ph && <QualityPill level={ph.quality.overall} />}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Section>
      <div className="flex items-start gap-4 rounded-3xl bg-lilac/70 p-5 xl:col-span-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/70 text-[#3D2F80]">
          <BrainCircuit className="size-6" />
        </span>
        <div className="flex-1">
          <p className="font-semibold">Preliminary AI screening runs when you submit</p>
          <p className="mt-0.5 text-sm text-ink-soft">The result is preliminary until reviewed by a specialist. Medium and high results are automatically referred and the patient receives an SMS.</p>
          <Disclaimer className="mt-3 bg-white/60" />
        </div>
      </div>
    </div>
  );
}
