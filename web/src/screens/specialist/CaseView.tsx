import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, BrainCircuit, CheckCircle2, CircleSlash, Microscope, HelpCircle, Leaf, Cigarette, Wine, Ruler, History, Sparkles, Send, AlertTriangle, ClipboardCheck, UserRound } from "lucide-react";
import { services, type ReviewInput } from "@/services";
import { useAsync } from "@/hooks";
import { useI18n } from "@/i18n";
import { Page } from "@/components/common/motion";
import { PhotoViewer } from "@/components/screening/PhotoViewer";
import { CompareSlider } from "@/components/screening/CompareSlider";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Disclaimer } from "@/components/common/misc";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { Tabs, TabsList, TabsTrigger, TabsContent, Input, Textarea, Label } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PHOTO_SITES } from "@/config/constants";
import { CASE_TYPE_LABEL } from "./Queue";
import type { ReviewDecision, SiteId } from "@/types";
import { formatDate, formatDateTime, pct, waitingDuration, patientRef } from "@/utils/format";
import { cn } from "@/utils/cn";

const DECISIONS: { id: ReviewDecision; label: string; body: string; icon: typeof CheckCircle2; tone: string }[] = [
  { id: "confirm_referral", label: "Confirm referral", body: "Patient should be examined", icon: Send, tone: "bg-[#F8DAD3] text-[#A3301F]" },
  { id: "needs_biopsy", label: "Needs biopsy", body: "Refer for biopsy urgently", icon: Microscope, tone: "bg-[#E5E0FA] text-[#5340B5]" },
  { id: "not_suspicious", label: "Not suspicious", body: "No referral needed", icon: CircleSlash, tone: "bg-[#DDF1E3] text-[#1F7A4A]" },
  { id: "cannot_assess", label: "Cannot assess", body: "Request new photos", icon: HelpCircle, tone: "bg-[#E7E9EC] text-[#4B5560]" },
];

const DX = ["Leukoplakia (homogeneous)", "Leukoplakia (non-homogeneous)", "Erythroplakia", "Oral submucous fibrosis", "Oral lichen planus", "Frictional keratosis", "Suspected oral squamous cell carcinoma", "Normal mucosa"];

/* Sites the AI does not score (e.g. the open-mouth face photo) have score NaN. */
const pctS = (n: number) => (Number.isFinite(n) ? pct(n) : "—");
function scoreTone(s: number) {
  if (!Number.isFinite(s)) return "bg-ink/20";
  return s >= 0.72 ? "bg-[#C2412D]" : s >= 0.45 ? "bg-[#D99A1E]" : "bg-[#2F9E62]";
}
function scoreWord(s: number) {
  if (!Number.isFinite(s)) return "Not scored";
  return s >= 0.72 ? "High" : s >= 0.45 ? "Medium" : "Low";
}

export default function CaseView() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const c = useAsync(() => services.specialist.getCase(id), [id]);
  const [active, setActive] = useState<SiteId>("left_cheek");
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [dx, setDx] = useState("");
  const [sites, setSites] = useState<ReviewInput["siteDecisions"]>({});
  const [override, setOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);

  const aiRefers = c.data ? ["HIGH", "MEDIUM"].includes(c.data.ai.risk) : false;
  const isOverride = useMemo(() => {
    if (!decision || !c.data) return false;
    const humanRefers = decision === "confirm_referral" || decision === "needs_biopsy";
    return decision !== "cannot_assess" && humanRefers !== aiRefers;
  }, [decision, aiRefers, c.data]);

  if (c.loading) return <LoadingSkeleton variant="page" />;
  if (c.error || !c.data) return <StateView state="noResults" title="Case not found" body="It may already have been reviewed." action={<Button onClick={() => nav("/specialist/queue")}>Back to queue</Button>} />;
  const d = c.data;
  const photo = d.photos.find((p) => p.site === active) ?? { site: active, url: "", heat: [], heatmapUrl: null };
  const score = d.ai.siteScores.find((s) => s.site === active) ?? { site: active, score: NaN, flagged: false };
  const canSubmit = decision && dx.trim().length > 2 && (!isOverride || override.trim().length >= 10);
  const habitIcon = { areca: Leaf, tobacco: Cigarette, alcohol: Wine };

  return (
    <Page>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Button variant="secondary" size="icon" onClick={() => nav("/specialist/queue")} aria-label="Back to queue">
          <ArrowLeft />
        </Button>
        <PatientAvatar name={d.patient.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{d.patient.name}</h1>
            <RiskIndicator risk={d.ai.risk} />
            <StatusBadge status="preliminary" label="AI pre-screen" />
          </div>
          <p className="mt-0.5 text-sm text-ink-mute">
            {patientRef(d.patient)} · {d.patient.age} y · <span className="capitalize">{d.patient.sex}</span> · {d.patient.village} · {CASE_TYPE_LABEL[d.case.caseType]} · submitted by {d.case.submittedBy} · waiting {waitingDuration(d.case.submittedAt).label}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_440px] xl:grid-cols-[1fr_400px]">
        {/* LEFT — images */}
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_200px]">
            <PhotoViewer key={active} src={photo.url} alt={`${t(`site.${active}`)} photograph`} heat={photo.heat} heatmapUrl={photo.heatmapUrl} />
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-1 lg:content-start">
              {PHOTO_SITES.map((s) => {
                const sc = d.ai.siteScores.find((x) => x.site === s.id) ?? { site: s.id, score: NaN, flagged: false };
                const ph = d.photos.find((p) => p.site === s.id) ?? { site: s.id, url: "", heat: [] };
                const sel = active === s.id;
                return (
                  <button key={s.id} onClick={() => setActive(s.id)} className={cn("group flex items-center gap-2.5 rounded-2xl p-1.5 text-left transition", sel ? "bg-primary-deep text-white shadow-lift" : "bg-surface shadow-soft hover:bg-secondary/40")} aria-pressed={sel}>
                    <img src={ph.url} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                    <span className="hidden min-w-0 flex-1 lg:block">
                      <span className="block truncate text-xs font-semibold">{t(s.labelKey)}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", scoreTone(sc.score))} aria-hidden />
                        <span className={cn("num text-[11px] font-bold", sel ? "text-white/80" : "text-ink-soft")}>
                          {scoreWord(sc.score)} {pctS(sc.score)}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <DashboardCard title="Per-site AI scores" subtitle={`Model ${d.ai.modelVersion} · overall confidence ${pct(d.ai.confidence)}`}>
              <ul className="space-y-2.5">
                {d.ai.siteScores.map((s) => (
                  <li key={s.site}>
                    <button onClick={() => setActive(s.site)} className="flex w-full items-center gap-3 text-left">
                      <span className={cn("w-32 shrink-0 truncate text-sm", s.site === active ? "font-bold" : "text-ink-soft")}>{t(`site.${s.site}`)}</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]">
                        <motion.span initial={{ width: 0 }} animate={{ width: Number.isFinite(s.score) ? pct(s.score) : "0%" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className={cn("block h-full rounded-full", scoreTone(s.score))} />
                      </span>
                      <span className="num w-20 text-right text-xs font-bold">
                        {scoreWord(s.score)} · {pctS(s.score)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </DashboardCard>
            <DashboardCard title="AI reasoning">
              <ul className="space-y-2.5">
                {d.ai.reasons.map((r) => (
                  <li key={r} className="flex gap-3 rounded-2xl bg-lilac/50 p-3 text-sm">
                    <BrainCircuit className="mt-0.5 size-4 shrink-0 text-[#5340B5]" /> {r}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-mute">Selected site: {t(`site.${active}`)} scored {pctS(score.score)}.</p>
              <Disclaimer className="mt-4" />
            </DashboardCard>
          </div>

          {d.previous && (
            <DashboardCard title="Previous screening comparison" subtitle={`${formatDate(d.previous.date)} → today · ${t(`site.${active}`)}`} action={<RiskIndicator risk={d.previous.risk} size="sm" />}>
              <div className="mx-auto max-w-xl">
                {d.previous.photos.find((p) => p.site === active) ? (
                  <CompareSlider before={d.previous.photos.find((p) => p.site === active)!.url} after={photo.url} beforeLabel={formatDate(d.previous.date)} afterLabel="Today" />
                ) : (
                  <p className="rounded-3xl bg-bg p-4 text-sm text-ink-mute">The previous visit has no photo of this site.</p>
                )}
              </div>
            </DashboardCard>
          )}

          <DashboardCard title="Similar past cases" subtitle="Nearest neighbours from reviewed cases, with their confirmed final labels">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {d.similar.map((s) => (
                <figure key={s.id} className="overflow-hidden rounded-3xl bg-bg">
                  <img src={s.url} alt={`Similar case ${s.id}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  <figcaption className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
                        <Sparkles className="size-3.5" /> {pct(s.similarity)} similar
                      </span>
                      <RiskIndicator risk={s.risk} size="sm" />
                    </div>
                    <p className="mt-2 text-sm font-semibold">{s.finalLabel}</p>
                    <p className="text-xs text-ink-mute">
                      {t(`site.${s.site}`)} · similarity {Math.round(s.similarity * 100)}%
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </DashboardCard>
        </div>

        {/* RIGHT — review */}
        <aside className="xl:sticky xl:top-[88px] xl:self-start">
          <Tabs defaultValue="review">
            <TabsList className="mb-4 w-full justify-between">
              <TabsTrigger value="review" className="flex-1 justify-center">
                <ClipboardCheck /> Review
              </TabsTrigger>
              <TabsTrigger value="patient" className="flex-1 justify-center">
                <UserRound /> Patient
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex-1 justify-center">
                <History /> Timeline
              </TabsTrigger>
            </TabsList>

            <TabsContent value="review" className="scroll-thin card max-h-[calc(100vh-170px)] space-y-5 overflow-y-auto p-6">
              <div>
                <p className="label-eyebrow mb-3">Decision</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Review decision">
                  {DECISIONS.map((o) => {
                    const I = o.icon;
                    const sel = decision === o.id;
                    return (
                      <button key={o.id} role="radio" aria-checked={sel} onClick={() => setDecision(o.id)} className={cn("flex flex-col gap-2 rounded-3xl p-3.5 text-left transition-all", sel ? "bg-primary-deep text-white shadow-lift" : "bg-bg hover:bg-secondary/50")}>
                        <span className={cn("grid size-9 place-items-center rounded-xl", sel ? "bg-white/10 text-accent" : o.tone)}>
                          <I className="size-[18px]" />
                        </span>
                        <span>
                          <span className="block text-sm font-bold">{o.label}</span>
                          <span className={cn("block text-[11px]", sel ? "text-white/60" : "text-ink-mute")}>{o.body}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label htmlFor="dx">Provisional diagnosis</Label>
                <Input id="dx" list="dx-list" value={dx} onChange={(e) => setDx(e.target.value)} placeholder="Start typing…" />
                <datalist id="dx-list">
                  {DX.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </div>

              <div>
                <p className="label-eyebrow mb-2">Site-wise referral</p>
                <ul className="space-y-1.5">
                  {PHOTO_SITES.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <button onClick={() => setActive(s.id)} className={cn("flex-1 truncate text-left text-[13px]", active === s.id ? "font-bold" : "text-ink-soft")}>
                        {t(s.labelKey)}
                      </button>
                      <div className="flex gap-1 rounded-full bg-ink/5 p-0.5">
                        {(["refer", "no_refer", "unclear"] as const).map((v) => (
                          <button key={v} onClick={() => setSites({ ...sites, [s.id]: v })} className={cn("h-7 rounded-full px-2.5 text-[11px] font-bold", sites[s.id] === v ? (v === "refer" ? "bg-[#A3301F] text-white" : v === "no_refer" ? "bg-primary text-white" : "bg-ink/60 text-white") : "text-ink-mute")} aria-pressed={sites[s.id] === v} aria-label={`${t(s.labelKey)}: ${v}`}>
                            {v === "refer" ? "Refer" : v === "no_refer" ? "No" : "?"}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {isOverride && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <div className="mb-2 flex items-center gap-2 rounded-2xl bg-butter px-3 py-2 text-[13px] font-semibold text-[#5A3B00]">
                    <AlertTriangle className="size-4" /> Your decision differs from the AI ({t(`risk.${d.ai.risk}`)})
                  </div>
                  <Label htmlFor="ovr">Override reason (required)</Label>
                  <Textarea id="ovr" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="What did you see that the model didn't? (min. 10 characters)" className="min-h-[72px]" />
                </motion.div>
              )}

              <div>
                <Label htmlFor="notes">Specialist notes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Advice for the health worker and patient…" />
              </div>

              <Button size="lg" className="w-full" disabled={!canSubmit} onClick={() => setConfirm(true)}>
                <CheckCircle2 /> Submit review
              </Button>
            </TabsContent>

            <TabsContent value="patient" className="card space-y-5 p-6">
              <div>
                <p className="label-eyebrow mb-3">Habits</p>
                <ul className="space-y-2">
                  {d.habits.map((h) => {
                    const I = habitIcon[h.kind];
                    return (
                      <li key={h.kind} className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                        <I className="size-5 text-primary" />
                        <span className="flex-1 text-sm font-semibold">{t(`habit.${h.kind}`)}</span>
                        <span className="text-sm text-ink-soft">
                          {t(`habit.${h.status}`)}
                          {h.years ? ` · ${h.years} y` : ""}
                          {h.perDay ? ` · ${h.perDay}/day` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex items-center gap-4 rounded-3xl bg-sky/60 p-4">
                <Ruler className="size-6 text-[#1F4560]" />
                <div>
                  <p className="text-xs font-semibold text-ink-mute">Mouth opening</p>
                  <p className="num text-2xl font-bold">
                    {d.mouthOpeningMm} <span className="text-sm text-ink-mute">mm</span>
                  </p>
                </div>
                <span className="ml-auto text-xs text-ink-soft">Typical adult ≥ 35 mm</span>
              </div>
              <div>
                <p className="label-eyebrow mb-3">Symptoms</p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries({ "Burning (spicy)": d.symptoms.burningSpicy, "Difficulty opening": d.symptoms.difficultyOpening, Pain: d.symptoms.pain, "Non-healing ulcer": d.symptoms.nonHealingUlcer }).map(([k, v]) => (
                    <div key={k} className="rounded-2xl bg-bg px-3 py-2">
                      <dt className="text-xs text-ink-mute">{k}</dt>
                      <dd className="font-semibold capitalize">{v ?? "—"}</dd>
                    </div>
                  ))}
                  <div className="col-span-2 rounded-2xl bg-bg px-3 py-2">
                    <dt className="text-xs text-ink-mute">Patches</dt>
                    <dd className="font-semibold capitalize">
                      {d.symptoms.patches} {d.symptoms.patchWeeks ? `· ${d.symptoms.patchWeeks} weeks` : ""}
                    </dd>
                  </div>
                </dl>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="card p-6">
              <ol className="relative space-y-5 before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-0.5 before:bg-line">
                {d.timeline.map((e, i) => (
                  <li key={i} className="relative pl-7">
                    <span className={cn("absolute left-0 top-1 size-4 rounded-full border-[3px] border-surface", i === 0 ? "bg-primary" : "bg-ink/25")} />
                    <p className="text-sm font-semibold">{e.label}</p>
                    <p className="text-xs text-ink-mute">
                      {formatDateTime(e.at)}
                      {e.detail ? ` · ${e.detail}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <ConfirmationModal
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit specialist review?"
        description={`Your decision (${DECISIONS.find((x) => x.id === decision)?.label}) will replace the preliminary AI result for ${d.patient.name}. The health worker and patient will be notified.`}
        confirmLabel="Submit review"
        onConfirm={async () => {
          await services.specialist.submitReview(d.case.id, { decision: decision!, diagnosis: dx, siteDecisions: sites, overrideReason: isOverride ? override : undefined, notes });
          toast({ tone: "success", title: "Review submitted", body: `${d.patient.name} — ${DECISIONS.find((x) => x.id === decision)?.label}` });
          const q = await services.specialist.queue();
          nav(q.length ? `/specialist/case/${q.sort((a, b) => a.priority - b.priority)[0].id}` : "/specialist/queue");
        }}
      />
    </Page>
  );
}
