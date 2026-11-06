import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, ScanFace } from "lucide-react";
import { services } from "@/services";
import { useAsync, useDebounced } from "@/hooks";
import { useI18n } from "@/i18n";
import { useAuth } from "@/store/auth";
import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { SearchBar } from "@/components/common/SearchBar";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import type { RiskLevel } from "@/types";
import { formatDate, maskPhone, patientRef } from "@/utils/format";
import { cn } from "@/utils/cn";

const FILTERS: (RiskLevel | "ALL")[] = ["ALL", "HIGH", "MEDIUM", "NEEDS_REVIEW", "CANNOT_ASSESS", "LOW"];

export default function PatientList() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [risk, setRisk] = useState<RiskLevel | "ALL">("ALL");
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => services.patients.search(dq), [dq]);
  const rows = (data ?? []).filter((p) => risk === "ALL" || p.lastRisk === risk);

  return (
    <Page>
      <PageHeader
        eyebrow={`${user?.facility}`}
        title={t("nav.patients")}
        description="Everyone registered at your centre. Open a profile for history, referrals and photo comparison."
        actions={
          user?.role !== "specialist" && (
            <Button onClick={() => nav("/screening/new")}>
              <ScanFace /> {t("nav.newScreening")}
            </Button>
          )
        }
      />
      <div className="card p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <SearchBar value={q} onValueChange={setQ} placeholder={t("common.searchPatients")} className="min-w-[280px] flex-1" />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter by risk">
            {FILTERS.map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={risk === f}
                onClick={() => setRisk(f)}
                className={cn("h-9 rounded-full px-3.5 text-sm font-semibold transition-colors", risk === f ? "bg-primary-deep text-white" : "bg-ink/5 text-ink-soft hover:text-ink")}
              >
                {f === "ALL" ? "All" : t(`risk.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(240px,2fr)_1fr_1fr_1.2fr_1.2fr_32px] gap-4 border-b border-line px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute lg:grid">
          <span>Patient</span>
          <span>Village</span>
          <span>Last screened</span>
          <span>Risk</span>
          <span>Status</span>
          <span />
        </div>
        {loading ? (
          <div className="pt-4">
            <LoadingSkeleton rows={8} />
          </div>
        ) : error ? (
          <StateView state="apiUnavailable" action={<Button variant="secondary" onClick={reload}>{t("common.retry")}</Button>} />
        ) : rows.length === 0 ? (
          <StateView state="noResults" />
        ) : (
          <Stagger className="divide-y divide-line">
            {rows.map((p) => (
              <StaggerItem key={p.id} style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}>
                <Link to={`/patients/${p.id}`} className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl px-3 py-3.5 transition-colors hover:bg-ink/[0.03] lg:grid-cols-[minmax(240px,2fr)_1fr_1fr_1.2fr_1.2fr_32px]">
                  <span className="flex items-center gap-3">
                    <PatientAvatar name={p.name} size={42} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block text-xs text-ink-mute">
                        {patientRef(p)} · {p.age} y · {maskPhone(p.phone)}
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-sm lg:block">
                    {p.village}
                    <span className="block text-xs text-ink-mute">{p.taluk}</span>
                  </span>
                  <span className="hidden text-sm lg:block">{p.lastScreeningAt ? formatDate(p.lastScreeningAt) : "—"}</span>
                  <span className="hidden lg:block">{p.lastRisk && <RiskIndicator risk={p.lastRisk} size="sm" />}</span>
                  <span className="hidden lg:block">
                    {p.referralStatus ? <StatusBadge status={p.referralStatus} /> : <StatusBadge status={p.reviewed ? "reviewed" : "preliminary"} />}
                  </span>
                  <ChevronRight className="size-5 text-ink-mute" />
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </Page>
  );
}
