import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Phone, MapPin, Languages, CalendarDays, ScanFace, Pill, MessageSquareText, Stethoscope, NotebookPen, ClipboardCheck, Send, History, Images, Plus } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { useI18n } from "@/i18n";
import { useAuth } from "@/store/auth";
import { Page } from "@/components/common/motion";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Disclaimer } from "@/components/common/misc";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { CompareSlider } from "@/components/screening/CompareSlider";
import { Tabs, TabsList, TabsTrigger, TabsContent, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PHOTO_SITES } from "@/config/constants";
import { formatDate, maskPhone, patientRef } from "@/utils/format";
import type { SiteId } from "@/types";
import { cn } from "@/utils/cn";

const REF_STEPS = ["issued", "booked", "visited", "completed"] as const;

export default function PatientProfile() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const p = useAsync(() => services.patients.get(id), [id]);
  const h = useAsync(() => services.patients.history(id), [id]);
  const [site, setSite] = useState<SiteId>("left_cheek");
  const [note, setNote] = useState("");
  const visits = useAsync(() => services.patients.visits(id), [id]);
  const care = useAsync(() => services.patients.care(id), [id]);
  const notes = care.data?.notes ?? [];

  if (p.loading) return <LoadingSkeleton variant="page" />;
  if (p.error || !p.data) return <StateView state="noResults" title="Patient not found" action={<Button variant="secondary" onClick={() => nav("/patients")}>Back to patients</Button>} />;
  const pt = p.data;
  const refIdx = pt.referralStatus ? REF_STEPS.indexOf(pt.referralStatus as (typeof REF_STEPS)[number]) : -1;

  return (
    <Page>
      <button onClick={() => nav(-1)} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </button>

      {/* Header */}
      <motion.section layoutId={`patient-${pt.id}`} className="relative mb-6 overflow-hidden rounded-4xl bg-mint p-7">
        <svg className="absolute -right-8 -top-12 size-64 text-primary/10" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="50" fill="currentColor" />
        </svg>
        <div className="relative flex flex-wrap items-center gap-6">
          <PatientAvatar name={pt.name} size={84} className="!rounded-3xl bg-white" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[2rem] font-bold leading-tight">{pt.name}</h1>
              {pt.lastRisk && <RiskIndicator risk={pt.lastRisk} />}
              <StatusBadge status={pt.reviewed ? "reviewed" : "preliminary"} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              <span>
                {patientRef(pt)} · {pt.age} y · <span className="capitalize">{pt.sex}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" /> {pt.village}, {pt.taluk}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-4" /> {maskPhone(pt.phone)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Languages className="size-4" /> {t(`lang.${pt.preferredLanguage}`)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" /> Registered {formatDate(pt.registeredAt)}
              </span>
            </div>
          </div>
          {(user?.role === "asha" || user?.role === "nurse") && (
            <Button onClick={() => nav("/screening/new")}>
              <ScanFace /> Screen again
            </Button>
          )}
        </div>
      </motion.section>

      <Tabs defaultValue="overview">
        <TabsList className="mb-5">
          <TabsTrigger value="overview">
            <History /> Overview
          </TabsTrigger>
          <TabsTrigger value="photos">
            <Images /> Photo comparison
          </TabsTrigger>
          <TabsTrigger value="meds">
            <Pill /> Medicines & follow-up
          </TabsTrigger>
          <TabsTrigger value="notes">
            <NotebookPen /> Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-12 gap-5">
            <DashboardCard title="Screening history" className="col-span-12 xl:col-span-7">
              {h.loading ? (
                <LoadingSkeleton rows={3} />
              ) : (
                <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-0.5 before:bg-line">
                  {h.data?.map((s, i) => (
                    <li key={s.id} className="relative flex gap-4">
                      <span className={cn("relative z-10 grid size-10 shrink-0 place-items-center rounded-full", i === 0 ? "bg-primary-deep text-accent" : "bg-sand text-ink-soft")}>
                        <ScanFace className="size-[18px]" />
                      </span>
                      <div className="flex-1 rounded-3xl bg-bg p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{formatDate(s.date)}</p>
                          <RiskIndicator risk={s.risk} size="sm" />
                          <StatusBadge status={s.reviewed ? "reviewed" : "preliminary"} />
                        </div>
                        <p className="mt-1 text-sm text-ink-soft">{s.summary}</p>
                        {s.reviewer && (
                          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#3D2F80]">
                            <Stethoscope className="size-3.5" /> Reviewed by {s.reviewer}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <Disclaimer className="mt-5" />
            </DashboardCard>

            <div className="col-span-12 flex flex-col gap-5 xl:col-span-5">
              <DashboardCard title="Referral status">
                {refIdx < 0 && pt.referralStatus !== "overdue" ? (
                  <p className="text-sm text-ink-mute">No active referral.</p>
                ) : (
                  <>
                    {pt.referralStatus === "overdue" && <StatusBadge status="overdue" className="mb-4" label="Overdue — patient hasn't visited" />}
                    <ol className="flex items-center">
                      {REF_STEPS.map((s, i) => {
                        const done = i <= refIdx;
                        return (
                          <li key={s} className="flex flex-1 items-center last:flex-none">
                            <div className="flex flex-col items-center gap-1.5">
                              <span className={cn("grid size-9 place-items-center rounded-full text-xs font-bold", done ? "bg-primary text-white" : "bg-ink/10 text-ink-mute")}>{i + 1}</span>
                              <span className={cn("text-xs font-semibold capitalize", done ? "text-ink" : "text-ink-mute")}>{s}</span>
                            </div>
                            {i < REF_STEPS.length - 1 && <span className={cn("mx-2 mb-5 h-0.5 flex-1 rounded", i < refIdx ? "bg-primary" : "bg-ink/10")} />}
                          </li>
                        );
                      })}
                    </ol>
                    <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
                      <Send className="size-4 text-primary" /> {pt.referralFacility ?? "Referral centre"}
                    </p>
                  </>
                )}
              </DashboardCard>
              <DashboardCard title="Specialist reviews">
                {(() => {
                  const rv = (h.data ?? []).filter((x) => x.reviewed);
                  if (!rv.length) return <p className="text-sm text-ink-mute">No specialist review yet.</p>;
                  return (
                    <div className="flex flex-col gap-3">
                      {rv.map((x) => (
                        <div key={x.id} className="flex gap-3 rounded-3xl bg-lilac/60 p-4">
                          <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-[#3D2F80]" />
                          <div>
                            <p className="text-sm font-semibold">
                              {x.reviewer ?? "Specialist"} · {formatDate(x.reviewedAt ?? x.date)}
                            </p>
                            {x.reviewVerdict && (
                              <p className="mt-0.5 text-xs font-semibold capitalize text-[#3D2F80]">{x.reviewVerdict.replace(/_/g, " ")}</p>
                            )}
                            <p className="mt-1 text-sm text-ink-soft">{x.reviewNote || "No note added."}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </DashboardCard>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="photos">
          <div className="grid grid-cols-12 gap-5">
            <div className="col-span-12 xl:col-span-8">
              {(() => {
                const withSite = (visits.data ?? []).filter((v) => v.photos[site]?.url);
                const latest = withSite[withSite.length - 1];
                const before = withSite[withSite.length - 2];
                if (visits.loading) return <LoadingSkeleton variant="cards" />;
                if (!latest) return <StateView state="empty" title="No photo of this site yet" body="Photos appear here after a screening is uploaded." />;
                if (!before)
                  return (
                    <div className="overflow-hidden rounded-4xl">
                      <img src={latest.photos[site]!.url} alt="" className="aspect-[4/3] w-full object-cover" />
                      <p className="mt-2 text-xs text-ink-mute">Only one visit so far ({formatDate(latest.date)}). The comparison slider appears after the follow-up screening.</p>
                    </div>
                  );
                return <CompareSlider before={before.photos[site]!.url} after={latest.photos[site]!.url} beforeLabel={formatDate(before.date)} afterLabel={formatDate(latest.date)} />;
              })()}
            </div>
            <div className="col-span-12 xl:col-span-4">
              <DashboardCard title="Choose site" subtitle="Drag the divider to compare">
                <div className="grid grid-cols-2 gap-2">
                  {PHOTO_SITES.map((s) => (
                    <button key={s.id} onClick={() => setSite(s.id)} className={cn("rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition", site === s.id ? "bg-primary-deep text-white" : "bg-bg hover:bg-secondary/50")} aria-pressed={site === s.id}>
                      <span className="mr-1.5 opacity-50">{s.index}</span>
                      {t(s.labelKey)}
                    </button>
                  ))}
                </div>
              </DashboardCard>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="meds">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <DashboardCard title="Medicines">
              <ul className="space-y-2">
                {(care.data?.medicines ?? []).length === 0 && <p className="text-sm text-ink-mute">No medicines recorded.</p>}
                {(care.data?.medicines ?? []).map((med, k) => ({ n: med.name, d: med.detail + (med.masksSymptoms ? " · can hide pain" : ""), by: med.by, key: k })).map((m) => (
                  <li key={m.key} className="flex items-center gap-3 rounded-2xl bg-bg p-3.5">
                    <span className="grid size-10 place-items-center rounded-2xl bg-butter text-[#5A4500]">
                      <Pill className="size-5" />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{m.n}</p>
                      <p className="text-xs text-ink-mute">
                        {m.d} · added by {m.by}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </DashboardCard>
            <DashboardCard title="Follow-up responses">
              <ul className="space-y-2">
                {(care.data?.responses ?? []).length === 0 && <p className="text-sm text-ink-mute">No SMS or voice check-in replies yet.</p>}
                {(care.data?.responses ?? []).map((x) => ({ at: x.at, ch: x.channel, r: x.text, ok: x.ok })).map((f) => (
                  <li key={f.at} className="flex items-center gap-3 rounded-2xl bg-bg p-3.5">
                    <MessageSquareText className={cn("size-5", f.ok ? "text-primary" : "text-ink-mute")} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{f.r}</p>
                      <p className="text-xs text-ink-mute">
                        {f.ch} · {formatDate(f.at)}
                      </p>
                    </div>
                    <StatusBadge status={f.ok ? "delivered" : "failed"} label={f.ok ? "Answered" : "No response"} />
                  </li>
                ))}
              </ul>
            </DashboardCard>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <DashboardCard title="Care notes" subtitle="Visible to the care team. Do not include unnecessary personal details.">
            <div className="flex gap-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="min-h-[72px]" />
              <Button
                className="self-end"
                disabled={note.trim().length < 3}
                onClick={async () => {
                  try {
                    await services.patients.addNote(id, note.trim());
                    setNote("");
                    care.reload();
                    toast({ tone: "success", title: "Note added" });
                  } catch {
                    toast({ tone: "error", title: "Could not save the note" });
                  }
                }}
                sound={null}
              >
                <Plus /> Add
              </Button>
            </div>
            <ul className="mt-5 space-y-3">
              {notes.map((n) => (
                <motion.li layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} key={n.at} className="rounded-3xl bg-sand/60 p-4">
                  <p className="text-sm">{n.text}</p>
                  <p className="mt-2 text-xs font-semibold text-ink-mute">
                    {n.by} · {formatDate(n.at)}
                  </p>
                </motion.li>
              ))}
            </ul>
          </DashboardCard>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
