import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ScanFace,
  CalendarClock,
  CloudUpload,
  Send,
  ClipboardList,
  Timer,
  Activity,
  Cpu,
  SlidersHorizontal,
  Map as MapIcon,
  AlertOctagon,
  Users,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/i18n";
import { useAsync } from "@/hooks";
import { services } from "@/services";
import { Page, Stagger, StaggerItem, CountUp } from "@/components/common/motion";
import { StatCard } from "@/components/cards/StatCard";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { Button } from "@/components/ui/button";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { SearchBar } from "@/components/common/SearchBar";
import { greetingKey, relativeTime, waitingDuration, patientRef } from "@/utils/format";
import type { HomeSummary } from "@/services/contracts";
import { useState } from "react";
import type { User } from "@/types";
import { cn } from "@/utils/cn";

function Greeting({ user, line }: { user: User; line: string }) {
  const { t } = useI18n();
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="mb-8">
      <p className="label-eyebrow mb-2">{today}</p>
      <h1 className="text-display text-ink">
        {t(greetingKey())}, {user.displayName}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">{line}</p>
    </div>
  );
}

/* ── Screeners (ASHA / Nurse) ─────────────────────── */
function ScreenerHome({ user }: { user: User }) {
  const nav = useNavigate();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const patients = useAsync(() => services.patients.search(""), []);
  const notes = useAsync(() => services.notifications.list(), []);
  const followups = patients.data?.filter((p) => p.lastRisk === "MEDIUM" || p.referralStatus === "overdue").slice(0, 5) ?? [];
  const s: HomeSummary = useAsync(() => services.home.summary(), []).data ?? {};
  const line =
    s.followupsDue === undefined
      ? "Loading today's work…"
      : `${s.followupsDue ? `${s.followupsDue} follow-up${s.followupsDue === 1 ? "" : "s"} due this week` : "No follow-ups due this week"}${s.followupsOverdue ? ` (${s.followupsOverdue} overdue)` : ""}${s.pendingUploads ? `, and ${s.pendingUploads} screening${s.pendingUploads === 1 ? "" : "s"} still processing` : ""}.`;

  return (
    <Page>
      <Greeting user={user} line={line} />
      <Stagger className="grid grid-cols-12 gap-5">
        {/* Hero action */}
        <StaggerItem className="col-span-12 xl:col-span-7">
          <div className="relative isolate h-full overflow-hidden rounded-4xl bg-primary-deep p-8 text-white">
            <svg className="absolute -bottom-16 -right-12 -z-10 h-72 w-72" viewBox="0 0 200 200" aria-hidden>
              <circle cx="120" cy="80" r="80" fill="#2F6B4F" />
              <path d="M70 110c20 34 70 34 90 0" stroke="#D6EC8C" strokeWidth="12" strokeLinecap="round" fill="none" />
              <circle cx="115" cy="70" r="13" fill="#D6EC8C" />
            </svg>
            <p className="label-eyebrow !text-accent/80">Ready when you are</p>
            <h2 className="mt-2 max-w-sm text-[1.85rem] font-bold leading-tight">Start a new oral screening</h2>
            <p className="mt-2 max-w-[55%] text-sm text-white/65">Patient → consent → habits → symptoms → 7 guided photos → result. Takes about 6 minutes.</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="accent" size="lg" onClick={() => nav("/screening/new")} sound="transition">
                <ScanFace /> {t("nav.newScreening")}
              </Button>
              <Button variant="ghost" size="lg" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => nav("/patients")}>
                Find a patient
              </Button>
            </div>
          </div>
        </StaggerItem>
        <StaggerItem className="col-span-12 grid grid-cols-2 gap-5 xl:col-span-5">
          <StatCard label="Screened today" value={s.screenedToday ?? 0} icon={ScanFace} tone="lime" footer={s.screenedAvg !== undefined ? `30-day average ${s.screenedAvg}/day` : undefined} />
          <StatCard label="Follow-ups due" value={s.followupsDue ?? 0} icon={CalendarClock} tone="butter" footer={`${s.followupsOverdue ?? 0} overdue`} />
          <StatCard label="Processing" value={s.pendingUploads ?? 0} icon={CloudUpload} tone="sky" footer="Waiting for the AI result" />
          <StatCard label="Active referrals" value={s.activeReferrals ?? 0} icon={Send} tone="blush" footer={`${s.visitedThisWeek ?? 0} visited this week`} />
        </StaggerItem>

        <StaggerItem className="col-span-12 xl:col-span-8">
          <DashboardCard
            title="Recent patients"
            subtitle="Your latest screenings"
            action={
              <Link to="/patients" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                {t("common.viewAll")} <ArrowRight className="size-4" />
              </Link>
            }
          >
            <SearchBar value={q} onValueChange={setQ} placeholder={t("common.searchPatients")} className="mb-4" onKeyDown={(e) => e.key === "Enter" && nav(`/patients?q=${encodeURIComponent(q)}`)} />
            {patients.loading ? (
              <LoadingSkeleton rows={5} />
            ) : (
              <ul className="divide-y divide-line">
                {patients.data?.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <Link to={`/patients/${p.id}`} className="-mx-2 flex items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-ink/[0.03]">
                      <PatientAvatar name={p.name} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-ink">{p.name}</p>
                        <p className="text-xs text-ink-mute">
                          {patientRef(p)} · {p.age} y · {p.village}
                        </p>
                      </div>
                      <span className="hidden text-xs text-ink-mute md:block">{p.lastScreeningAt && relativeTime(p.lastScreeningAt)}</span>
                      {p.lastRisk && <RiskIndicator risk={p.lastRisk} size="sm" />}
                      <StatusBadge status={p.reviewed ? "reviewed" : "preliminary"} className="hidden lg:inline-flex" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </StaggerItem>

        <StaggerItem className="col-span-12 flex flex-col gap-5 xl:col-span-4">
          <DashboardCard title="Follow-ups due" subtitle="Grouped by village">
            {followups.length === 0 ? (
              <LoadingSkeleton rows={3} />
            ) : (
              <ul className="space-y-2">
                {followups.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-sand/60 p-3">
                    <span className={cn("h-9 w-1.5 rounded-full", p.referralStatus === "overdue" ? "bg-[#C2412D]" : "bg-[#D99A1E]")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-ink-mute">{p.village}</p>
                    </div>
                    <StatusBadge status={p.referralStatus === "overdue" ? "overdue" : "pending"} label={p.referralStatus === "overdue" ? "Overdue" : "Due"} />
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
          <DashboardCard title="Latest updates">
            <div className="-mx-3 space-y-1">{notes.data?.slice(0, 3).map((n) => <NotificationItem key={n.id} n={n} compact />)}</div>
          </DashboardCard>
        </StaggerItem>
      </Stagger>
    </Page>
  );
}

/* ── Specialist ───────────────────────────────────── */
function SpecialistHome({ user }: { user: User }) {
  const nav = useNavigate();
  const q = useAsync(() => services.specialist.queue(), []);
  const high = q.data?.filter((c) => c.priority === 1) ?? [];
  const oldest = q.data?.length ? Math.max(...q.data.map((c) => waitingDuration(c.submittedAt).hours)) : 0;
  return (
    <Page>
      <Greeting user={user} line={`${q.data?.length ?? "…"} cases are waiting for your review. ${high.length} are high priority.`} />
      <Stagger className="grid grid-cols-12 gap-5">
        <StaggerItem className="col-span-12 lg:col-span-4">
          <StatCard label="Awaiting review" value={q.data?.length ?? 0} icon={ClipboardList} tone="deep" footer="across your referral PHCs" className="h-full" />
        </StaggerItem>
        <StaggerItem className="col-span-6 lg:col-span-4">
          <StatCard label="High priority" value={high.length} icon={AlertOctagon} tone="blush" footer="review within 24 h" className="h-full" />
        </StaggerItem>
        <StaggerItem className="col-span-6 lg:col-span-4">
          <StatCard label="Longest wait" value={Math.round(oldest)} suffix=" h" icon={Timer} tone="butter" className="h-full" />
        </StaggerItem>
        <StaggerItem className="col-span-12">
          <DashboardCard title="Next up" subtitle="Highest priority first" action={<Button onClick={() => nav("/specialist/queue")}>Open queue <ArrowRight /></Button>}>
            {q.loading ? (
              <LoadingSkeleton rows={4} />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {q.data?.sort((a, b) => a.priority - b.priority).slice(0, 4).map((c) => (
                  <Link key={c.id} to={`/specialist/case/${c.id}`} className="group rounded-3xl bg-bg p-4 transition hover:-translate-y-0.5 hover:shadow-soft">
                    <div className="flex items-center justify-between">
                      <RiskIndicator risk={c.risk} size="sm" />
                      <span className="text-xs font-semibold text-ink-mute">{waitingDuration(c.submittedAt).label} waiting</span>
                    </div>
                    <p className="mt-4 font-display text-base font-bold">{c.patient.name}</p>
                    <p className="text-xs text-ink-mute">
                      {c.patient.age} y · {c.patient.village} · {patientRef(c.patient)}
                    </p>
                    <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                      Review <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </DashboardCard>
        </StaggerItem>
      </Stagger>
    </Page>
  );
}

/* ── Other roles: concise launchpads ──────────────── */
function Launchpad({ user, line, tiles }: { user: User; line: string; tiles: { to: string; title: string; body: string; icon: typeof Cpu; tone: string; metric?: { v: number; l: string } }[] }) {
  return (
    <Page>
      <Greeting user={user} line={line} />
      <Stagger className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tl) => {
          const I = tl.icon;
          return (
            <StaggerItem key={tl.title}>
              <Link to={tl.to} className={cn("group relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-4xl p-7 transition hover:-translate-y-1 hover:shadow-lift", tl.tone)}>
                <span className="grid size-12 place-items-center rounded-2xl bg-white/70 text-primary-deep">
                  <I className="size-6" />
                </span>
                {tl.metric && (
                  <p className="num mt-6 text-4xl font-bold">
                    <CountUp value={tl.metric.v} />
                    <span className="ml-2 text-sm font-semibold opacity-60">{tl.metric.l}</span>
                  </p>
                )}
                <h3 className="mt-auto pt-6 text-xl font-bold">{tl.title}</h3>
                <p className="mt-1 text-sm opacity-70">{tl.body}</p>
                <ArrowRight className="absolute right-6 top-7 size-5 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100" />
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Page>
  );
}

export default function Home() {
  const { user } = useAuth();
  const s: HomeSummary = useAsync<HomeSummary>(() => (user && !["asha", "nurse"].includes(user.role) ? services.home.summary() : Promise.resolve({})), [user?.role]).data ?? {};
  if (!user) return null;
  switch (user.role) {
    case "asha":
    case "nurse":
      return <ScreenerHome user={user} />;
    case "specialist":
      return <SpecialistHome user={user} />;
    case "district_officer":
      return (
        <Launchpad
          user={user}
          line={s.screened90d === undefined ? "Loading…" : `${s.screened90d} people screened in the last 90 days.${s.overdueReferrals ? ` ${s.overdueReferrals} referrals are overdue${s.worstTaluk ? ` — most in ${s.worstTaluk}` : ""}.` : " No overdue referrals."}`}
          tiles={[
            { to: "/district", title: "District insights", body: "Coverage, risk trends and the referral funnel by taluk.", icon: MapIcon, tone: "bg-mint", metric: { v: s.screened90d ?? 0, l: "screened (90 days)" } },
            { to: "/district", title: "Overdue referrals", body: "High-risk patients who haven't visited yet.", icon: CalendarClock, tone: "bg-blush", metric: { v: s.overdueReferrals ?? 0, l: "overdue" } },
            { to: "/notifications", title: "Updates", body: "Programme notices and system announcements.", icon: Users, tone: "bg-sky" },
          ]}
        />
      );
    case "clinical_lead":
      return (
        <Launchpad
          user={user}
          line={s.activeModel === undefined ? "Loading…" : `Active model ${s.activeModel ?? "—"}. ${s.candidateModels ? `${s.candidateModels} candidate model${s.candidateModels === 1 ? " is" : "s are"} waiting for review` : "No candidate models waiting"}, ${s.pendingRules ? `${s.pendingRules} rule change${s.pendingRules === 1 ? "" : "s"} await approval` : "no rule changes pending"}, ${s.openIncidents ?? 0} open incident${s.openIncidents === 1 ? "" : "s"}.`}
          tiles={[
            { to: "/lead/models", title: "Models", body: "Benchmarks, shadow mode, promotion and rollback.", icon: Cpu, tone: "bg-lime", metric: { v: s.candidateModels ?? 0, l: "candidate" } },
            { to: "/lead/rules", title: "Rules", body: "Thresholds and the four-eyes approval queue.", icon: SlidersHorizontal, tone: "bg-butter", metric: { v: s.pendingRules ?? 0, l: "pending" } },
            { to: "/lead/governance", title: "Governance", body: "Datasets, lineage, drift, fairness and incidents.", icon: CheckCircle2, tone: "bg-lilac" },
          ]}
        />
      );
    case "admin":
      return (
        <Launchpad
          user={user}
          line={s.failedJobs === undefined ? "Loading…" : `${s.failedJobs ? `${s.failedJobs} failed background job${s.failedJobs === 1 ? " needs" : "s need"} attention` : "No failed background jobs"}${s.failedMessages ? `; ${s.failedMessages} SMS/voice messages failed this week` : ""}. Open System health for live service status.`}
          tiles={[
            { to: "/admin/health", title: "System health", body: "Service status, latency and failed jobs.", icon: Activity, tone: "bg-mint", metric: { v: s.failedJobs ?? 0, l: "failed jobs" } },
            { to: "/admin/audit", title: "Audit log", body: "Hash-chained record of every access and change.", icon: ClipboardList, tone: "bg-sand" },
            { to: "/admin/messages", title: "SMS & voice", body: "Delivery logs for referrals and reminders.", icon: Send, tone: "bg-sky" },
          ]}
        />
      );
    default:
      return (
        <Launchpad user={user} line="Use Provider Connect with your patient's QR card." tiles={[{ to: "/connect", title: "Provider Connect", body: "Temporary 24-hour access to a patient summary.", icon: Users, tone: "bg-mint" }]} />
      );
  }
}

