import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { motion } from "framer-motion";
import { ScanFace, AlertOctagon, Send, Footprints, CalendarX2, Download, ShieldCheck } from "lucide-react";
import { services, type DistrictFilters } from "@/services";
import { useAsync } from "@/hooks";
import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StatCard } from "@/components/cards/StatCard";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { ChartTooltip, CHART } from "@/components/charts/chartKit";
import { TALUKS } from "@/mocks/data";
import { MIN_GROUP_SIZE } from "@/config/constants";
import { cn } from "@/utils/cn";

/* Sequential scale for coverage (light → deep green). */
const SCALE = ["#EEF5E3", "#D6EC8C", "#A8CF86", "#5E9A6E", "#2F6B4F", "#16352A"];
const scaleColor = (v: number) => SCALE[Math.min(SCALE.length - 1, Math.floor(v * SCALE.length))];

function Funnel({ data }: { data: { stage: string; value: number }[] }) {
  const max = data[0]?.value || 1;
  return (
    <ol className="space-y-3">
      {data.map((d, i) => {
        const conv = i > 0 ? d.value / data[i - 1].value : null;
        return (
          <li key={d.stage}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-semibold">{d.stage}</span>
              <span className="flex items-baseline gap-2">
                <span className="num font-bold">{d.value.toLocaleString("en-IN")}</span>
                {conv !== null && <span className={cn("text-xs font-semibold", conv < 0.6 ? "text-[#A3301F]" : "text-ink-mute")}>{Math.round(conv * 100)}% of prev.</span>}
              </span>
            </div>
            <div className="h-9 overflow-hidden rounded-xl bg-ink/[0.05]">
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(4, (d.value / max) * 100)}%` }} transition={{ duration: 0.8, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }} className="h-full rounded-xl" style={{ background: ["#16352A", "#2F6B4F", "#5E9A6E", "#A8CF86", "#D6EC8C"][i] }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function VillageMap({ villages }: { villages: { name: string; taluk: string; screened: number | null; highRisk: number | null; coverage: number | null }[] }) {
  const taluks = [...new Set(villages.map((v) => v.taluk))];
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {taluks.map((t) => (
          <div key={t} className="rounded-3xl bg-bg p-3.5">
            <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-ink-mute">{t}</p>
            <div className="flex flex-wrap gap-1.5">
              {villages
                .filter((v) => v.taluk === t)
                .map((v) => {
                  const hidden = v.coverage === null;
                  return (
                    <button
                      key={v.name}
                      onMouseEnter={() => setHover(v.name)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(v.name)}
                      onBlur={() => setHover(null)}
                      className={cn("relative grid size-12 place-items-center rounded-2xl text-[10px] font-bold transition-transform hover:scale-110 focus-visible:scale-110", hidden && "text-ink-mute")}
                      style={
                        hidden
                          ? { background: "repeating-linear-gradient(45deg, rgba(26,38,32,0.06) 0 4px, transparent 4px 8px)", boxShadow: "inset 0 0 0 1px rgba(26,38,32,0.1)" }
                          : { background: scaleColor(v.coverage!), color: v.coverage! > 0.5 ? "#fff" : "#16352A" }
                      }
                      aria-label={hidden ? `${v.name}: suppressed, fewer than ${MIN_GROUP_SIZE}` : `${v.name}: ${v.screened} screened, coverage ${Math.round(v.coverage! * 100)}%`}
                    >
                      {v.name.slice(0, 3)}
                      {hover === v.name && (
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-44 -translate-x-1/2 rounded-2xl bg-primary-deep p-3 text-left text-xs font-medium text-white shadow-lift">
                          <span className="block text-sm font-bold">{v.name}</span>
                          {hidden ? (
                            <span className="text-white/70">Fewer than {MIN_GROUP_SIZE} — hidden for privacy</span>
                          ) : (
                            <>
                              <span className="block text-white/70">{v.screened} screened</span>
                              <span className="block text-white/70">High risk: {v.highRisk ?? `<${MIN_GROUP_SIZE}`}</span>
                              <span className="block text-accent">Coverage {Math.round(v.coverage! * 100)}%</span>
                            </>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-ink-mute">
        <span className="font-semibold">Coverage of eligible adults</span>
        <div className="flex items-center gap-1">
          <span>0%</span>
          {SCALE.map((c) => (
            <span key={c} className="h-3 w-7 first:rounded-l-full last:rounded-r-full" style={{ background: c }} />
          ))}
          <span>100%</span>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ background: "repeating-linear-gradient(45deg, rgba(26,38,32,0.15) 0 2px, transparent 2px 4px)" }} /> Suppressed (&lt;{MIN_GROUP_SIZE})
        </span>
      </div>
    </div>
  );
}

export default function District() {
  const [f, setF] = useState<DistrictFilters>({ taluk: "all", range: "12m" });
  const { data, loading, error, reload } = useAsync(() => services.district.analytics(f), [f.taluk, f.range]);

  return (
    <Page>
      <PageHeader
        eyebrow="Dakshina Kannada district"
        title="District insights"
        description="Aggregate screening and referral performance. No individual patient data is shown; groups under 5 are hidden."
        actions={
          <>
            <div className="w-44">
              <Select value={f.taluk} onChange={(e) => setF({ ...f, taluk: (e.target as unknown as HTMLSelectElement).value })} aria-label="Taluk" className="h-11 rounded-full">
                <option value="all">All taluks</option>
                {(data?.taluks ?? TALUKS).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex rounded-full bg-ink/5 p-1" role="radiogroup" aria-label="Date range">
              {(["30d", "90d", "12m"] as const).map((r) => (
                <button key={r} role="radio" aria-checked={f.range === r} onClick={() => setF({ ...f, range: r })} className={cn("h-9 rounded-full px-4 text-sm font-semibold", f.range === r ? "bg-primary-deep text-white" : "text-ink-soft")}>
                  {r === "30d" ? "30 days" : r === "90d" ? "90 days" : "12 months"}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => window.print()}>
              <Download /> Export
            </Button>
          </>
        }
      />
      {loading && !data ? (
        <LoadingSkeleton variant="page" />
      ) : error || !data ? (
        <StateView state="apiUnavailable" action={<Button onClick={reload}>Retry</Button>} />
      ) : (
        <Stagger className={cn("grid grid-cols-12 gap-5 transition-opacity", loading && "opacity-60")} key={`${f.taluk}${f.range}`}>
          <StaggerItem className="col-span-6 lg:col-span-4 2xl:col-span-2 2xl:col-start-1">
            <StatCard label="Total screened" value={data.totals.screened} icon={ScanFace} tone="deep" className="h-full" />
          </StaggerItem>
          <StaggerItem className="col-span-6 lg:col-span-4 2xl:col-span-2">
            <StatCard label="High-risk" value={data.totals.highRisk} icon={AlertOctagon} tone="blush" className="h-full" footer={`${((data.totals.highRisk / Math.max(1, data.totals.screened)) * 100).toFixed(1)}% of screened`} />
          </StaggerItem>
          <StaggerItem className="col-span-6 lg:col-span-4 2xl:col-span-3">
            <StatCard label="Referred" value={data.totals.referred} icon={Send} tone="sky" className="h-full" />
          </StaggerItem>
          <StaggerItem className="col-span-6 lg:col-span-6 2xl:col-span-3">
            <StatCard label="Visited" value={data.totals.visited} icon={Footprints} tone="lime" className="h-full" footer={`${Math.round((data.totals.visited / Math.max(1, data.totals.referred)) * 100)}% of referred`} />
          </StaggerItem>
          <StaggerItem className="col-span-12 lg:col-span-6 2xl:col-span-2">
            <StatCard label="Overdue" value={data.totals.overdue} icon={CalendarX2} tone="butter" className="h-full" />
          </StaggerItem>

          <StaggerItem className="col-span-12 xl:col-span-8">
            <DashboardCard title="Screening volume" subtitle="Screenings completed per month">
              <div className="h-72">
                <ResponsiveContainer>
                  <AreaChart data={data.volume}>
                    <defs>
                      <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#2F6B4F" stopOpacity={0.35} />
                        <stop offset="1" stopColor="#2F6B4F" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={CHART.tick} />
                    <YAxis axisLine={false} tickLine={false} tick={CHART.tick} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="screened" name="Screened" stroke="#16352A" strokeWidth={2.5} fill="url(#vol)" activeDot={{ r: 5, fill: "#D6EC8C", stroke: "#16352A", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>
          </StaggerItem>
          <StaggerItem className="col-span-12 xl:col-span-4">
            <DashboardCard title="Referral funnel" subtitle="From screening to completed care">
              <Funnel data={data.funnel} />
            </DashboardCard>
          </StaggerItem>

          <StaggerItem className="col-span-12 xl:col-span-8">
            <DashboardCard title="Village coverage map" subtitle="Tile map grouped by taluk · hover a village" action={<span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-xs font-semibold text-primary-deep"><ShieldCheck className="size-3.5" /> Aggregate only</span>}>
              <VillageMap villages={data.villages} />
            </DashboardCard>
          </StaggerItem>
          <StaggerItem className="col-span-12 xl:col-span-4">
            <DashboardCard title="Risk mix trend" subtitle="% of screenings by AI risk level">
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={data.riskTrend}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={CHART.tick} />
                    <YAxis axisLine={false} tickLine={false} tick={CHART.tick} width={30} unit="%" />
                    <Tooltip content={<ChartTooltip unit="%" />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="LOW" name="Low" stroke={CHART.series.primary} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="MEDIUM" name="Medium" stroke={CHART.series.amber} strokeWidth={2.5} strokeDasharray="6 4" dot={false} />
                    <Line type="monotone" dataKey="HIGH" name="High" stroke={CHART.series.red} strokeWidth={2.5} strokeDasharray="2 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>
          </StaggerItem>
        </Stagger>
      )}
    </Page>
  );
}
