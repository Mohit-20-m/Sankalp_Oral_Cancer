import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpDown, ChevronRight, Filter, RefreshCw } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { useI18n } from "@/i18n";
import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { SearchBar } from "@/components/common/SearchBar";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { StatCard } from "@/components/cards/StatCard";
import { Button } from "@/components/ui/button";
import type { CaseType, QueueCase, RiskLevel } from "@/types";
import { waitingDuration, pct, patientRef } from "@/utils/format";
import { cn } from "@/utils/cn";
import { AlertOctagon, ClipboardList, Timer } from "lucide-react";

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  first_screening: "First screening",
  follow_up: "Follow-up",
  second_opinion: "Second opinion",
  low_quality: "Low image quality",
};

const PRIORITY = {
  1: { label: "Urgent", cls: "bg-[#C2412D]", text: "text-[#A3301F]" },
  2: { label: "Soon", cls: "bg-[#D99A1E]", text: "text-[#8A5A00]" },
  3: { label: "Routine", cls: "bg-[#8FB09A]", text: "text-primary" },
} as const;

type SortKey = "priority" | "waiting" | "confidence";

export default function Queue() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useAsync(() => services.specialist.queue(), []);
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<RiskLevel | "ALL">("ALL");
  const [type, setType] = useState<CaseType | "ALL">("ALL");
  const [sort, setSort] = useState<SortKey>("priority");

  const rows = useMemo(() => {
    const list = (data ?? []).filter(
      (c) => (risk === "ALL" || c.risk === risk) && (type === "ALL" || c.caseType === type) && (!q || `${c.patient.name} ${c.id} ${c.patient.village}`.toLowerCase().includes(q.toLowerCase())),
    );
    const by: Record<SortKey, (a: QueueCase, b: QueueCase) => number> = {
      priority: (a, b) => a.priority - b.priority || a.submittedAt.localeCompare(b.submittedAt),
      waiting: (a, b) => a.submittedAt.localeCompare(b.submittedAt),
      confidence: (a, b) => a.aiConfidence - b.aiConfidence,
    };
    return [...list].sort(by[sort]);
  }, [data, q, risk, type, sort]);

  const urgent = data?.filter((c) => c.priority === 1).length ?? 0;
  const longest = data?.length ? Math.max(...data.map((c) => waitingDuration(c.submittedAt).hours)) : 0;

  return (
    <Page>
      <PageHeader eyebrow="Specialist console" title={t("nav.queue")} description="Cases from PHCs awaiting your clinical review, highest priority first." actions={<Button variant="secondary" onClick={reload}><RefreshCw /> Refresh</Button>} />
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="In queue" value={data?.length ?? 0} icon={ClipboardList} tone="deep" />
        <StatCard label="Urgent" value={urgent} icon={AlertOctagon} tone="blush" footer="Target: within 24 h" />
        <StatCard label="Longest wait" value={Math.round(longest)} suffix=" h" icon={Timer} tone="butter" />
      </div>
      <div className="card p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <SearchBar value={q} onValueChange={setQ} placeholder="Search patient, case ID or village" className="min-w-[260px] flex-1" />
          <div className="flex items-center gap-2 rounded-full bg-ink/5 p-1 pl-3">
            <Filter className="size-4 text-ink-mute" />
            <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel | "ALL")} className="h-9 rounded-full bg-transparent px-2 text-sm font-semibold focus:outline-none" aria-label="Filter by risk">
              <option value="ALL">All risks</option>
              {(["HIGH", "MEDIUM", "NEEDS_REVIEW", "CANNOT_ASSESS", "LOW"] as RiskLevel[]).map((r) => (
                <option key={r} value={r}>
                  {t(`risk.${r}`)}
                </option>
              ))}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value as CaseType | "ALL")} className="h-9 rounded-full bg-transparent px-2 text-sm font-semibold focus:outline-none" aria-label="Filter by case type">
              <option value="ALL">All case types</option>
              {Object.entries(CASE_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-ink/5 p-1" role="radiogroup" aria-label="Sort">
            <ArrowUpDown className="ml-2 size-4 text-ink-mute" />
            {(["priority", "waiting", "confidence"] as SortKey[]).map((k) => (
              <button key={k} role="radio" aria-checked={sort === k} onClick={() => setSort(k)} className={cn("h-9 rounded-full px-3.5 text-sm font-semibold capitalize", sort === k ? "bg-primary-deep text-white" : "text-ink-soft")}>
                {k === "confidence" ? "Low confidence" : k}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-[120px_minmax(220px,2fr)_1.2fr_1.2fr_1fr_90px_24px] gap-4 border-b border-line px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute lg:grid">
          <span>Priority</span>
          <span>Patient</span>
          <span>AI risk</span>
          <span>Case type</span>
          <span>AI confidence</span>
          <span>Waiting</span>
          <span />
        </div>
        {loading ? (
          <div className="pt-4"><LoadingSkeleton rows={7} /></div>
        ) : error ? (
          <StateView state="apiUnavailable" action={<Button onClick={reload}>Retry</Button>} />
        ) : rows.length === 0 ? (
          <StateView state={data?.length ? "noResults" : "success"} title={data?.length ? undefined : "Queue is clear"} body={data?.length ? undefined : "Every submitted case has been reviewed. Nice work."} />
        ) : (
          <Stagger className="divide-y divide-line">
            {rows.map((c) => {
              const w = waitingDuration(c.submittedAt);
              const pr = PRIORITY[c.priority];
              return (
                <StaggerItem key={c.id}>
                  <Link to={`/specialist/case/${c.id}`} className="group grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl px-3 py-3.5 transition-colors hover:bg-ink/[0.03] lg:grid-cols-[120px_minmax(220px,2fr)_1.2fr_1.2fr_1fr_90px_24px]">
                    <span className={cn("hidden items-center gap-2 text-sm font-bold lg:flex", pr.text)}>
                      <span className={cn("h-8 w-1.5 rounded-full", pr.cls)} aria-hidden /> P{c.priority} · {pr.label}
                    </span>
                    <span className="flex items-center gap-3">
                      <PatientAvatar name={c.patient.name} size={40} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.patient.name}</span>
                        <span className="block text-xs text-ink-mute">
                          {patientRef(c.patient)} · {c.patient.age} y · {c.patient.village}
                        </span>
                      </span>
                    </span>
                    <span className="hidden lg:block"><RiskIndicator risk={c.risk} size="sm" /></span>
                    <span className="hidden text-sm lg:block">{CASE_TYPE_LABEL[c.caseType]}</span>
                    <span className="hidden items-center gap-2 lg:flex">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/10"><span className="block h-full rounded-full bg-primary" style={{ width: pct(c.aiConfidence) }} /></span>
                      <span className="num text-sm font-semibold">{pct(c.aiConfidence)}</span>
                    </span>
                    <span className={cn("hidden text-sm font-bold lg:block", w.hours > 24 ? "text-[#A3301F]" : "text-ink")}>{w.label}</span>
                    <ChevronRight className="size-5 text-ink-mute transition group-hover:translate-x-0.5" />
                  </Link>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </div>
    </Page>
  );
}
