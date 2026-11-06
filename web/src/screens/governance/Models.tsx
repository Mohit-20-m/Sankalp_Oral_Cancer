import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { Cpu, RefreshCcw, Rocket, Ghost, Undo2, Archive, Database, CalendarDays } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ChartTooltip, CHART } from "@/components/charts/chartKit";
import type { ModelVersion } from "@/types";
import { formatDate, pct } from "@/utils/format";
import { cn } from "@/utils/cn";

type Act = "promote" | "shadow" | "rollback" | "retire" | "retrain";
const ACT: Record<Act, { label: string; icon: typeof Rocket; danger?: boolean; desc: (m?: ModelVersion) => string }> = {
  promote: { label: "Approve & promote", icon: Rocket, desc: (m) => `${m?.version} will become the active model for all new screenings. The current active model will be retired.` },
  shadow: { label: "Run in shadow mode", icon: Ghost, desc: (m) => `${m?.version} will score every screening silently. Results are logged but never shown to health workers.` },
  rollback: { label: "Roll back to this", icon: Undo2, danger: true, desc: (m) => `Production will immediately switch back to ${m?.version}. Use only if the active model is misbehaving.` },
  retire: { label: "Retire", icon: Archive, danger: true, desc: (m) => `${m?.version} will stop running.` },
  retrain: { label: "Start retraining", icon: RefreshCcw, desc: () => "A new candidate will be trained on the latest approved dataset. This takes several hours and does not affect production." },
};

function Metric({ label, v, best }: { label: string; v: number; best?: boolean }) {
  return (
    <div className={cn("rounded-2xl px-3 py-2.5", best ? "bg-accent" : "bg-white/60")}>
      <p className="text-[11px] font-semibold text-ink-mute">{label}</p>
      <p className="num text-lg font-bold">{pct(v, 1)}</p>
    </div>
  );
}

export default function Models() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => services.lead.models(), []);
  const [pending, setPending] = useState<{ act: Act; m?: ModelVersion } | null>(null);
  if (loading || !data) return <LoadingSkeleton variant="page" />;
  const bestAuc = Math.max(...data.map((m) => m.auc));
  const chart = [...data].reverse().map((m) => ({ v: m.version, Sensitivity: m.sensitivity * 100, Specificity: m.specificity * 100, AUC: m.auc * 100 }));
  const toneFor: Record<string, string> = { active: "bg-mint", shadow: "bg-lilac/70", candidate: "bg-butter/80", retired: "bg-surface shadow-soft" };

  return (
    <Page>
      <PageHeader eyebrow="Clinical lead" title="Models" description="Every model change is approved, logged and reversible. Benchmarks are on the locked validation set." actions={<Button onClick={() => setPending({ act: "retrain" })}><RefreshCcw /> Retrain</Button>} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {data.map((m) => (
          <motion.article layout key={m.id} className={cn("flex flex-col rounded-4xl p-6", toneFor[m.status])}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-white/70 text-primary-deep">
                  <Cpu className="size-5" />
                </span>
                <div>
                  <h3 className="num text-lg font-bold">v{m.version}</h3>
                  <p className="flex items-center gap-1.5 text-xs text-ink-mute">
                    <CalendarDays className="size-3.5" /> {formatDate(m.createdAt)} · <Database className="size-3.5" /> {m.datasetId}
                  </p>
                </div>
              </div>
              <StatusBadge status={m.status} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Metric label="Sensitivity" v={m.sensitivity} />
              <Metric label="Specificity" v={m.specificity} />
              <Metric label="AUC" v={m.auc} best={m.auc === bestAuc} />
            </div>
            <p className="mt-4 flex-1 text-sm text-ink-soft">{m.notes}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {m.status === "candidate" && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setPending({ act: "shadow", m })}><Ghost /> Shadow</Button>
                  <Button size="sm" onClick={() => setPending({ act: "promote", m })}><Rocket /> Approve & promote</Button>
                </>
              )}
              {m.status === "shadow" && (
                <>
                  <Button size="sm" onClick={() => setPending({ act: "promote", m })}><Rocket /> Promote</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending({ act: "retire", m })}><Archive /> Retire</Button>
                </>
              )}
              {m.status === "retired" && <Button size="sm" variant="secondary" onClick={() => setPending({ act: "rollback", m })}><Undo2 /> Roll back to this</Button>}
              {m.status === "active" && <span className="text-xs font-semibold text-primary">Serving all PHCs</span>}
            </div>
          </motion.article>
        ))}
      </div>

      <DashboardCard title="Benchmark comparison" subtitle="Locked validation set · higher is better" className="mt-6">
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chart} barGap={3}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="v" axisLine={false} tickLine={false} tick={CHART.tick} />
              <YAxis domain={[(min: number) => Math.max(0, Math.floor(min / 5) * 5 - 5), 100]} axisLine={false} tickLine={false} tick={CHART.tick} width={34} unit="%" />
              <Tooltip content={<ChartTooltip unit="%" />} cursor={{ fill: "rgba(26,38,32,0.04)" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sensitivity" fill={CHART.series.deep} radius={[6, 6, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Specificity" fill={CHART.series.sage} radius={[6, 6, 0, 0]} maxBarSize={18} />
              <Bar dataKey="AUC" fill={CHART.series.lime} radius={[6, 6, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </DashboardCard>

      {pending && (
        <ConfirmationModal
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={`${ACT[pending.act].label}${pending.m ? ` — v${pending.m.version}` : ""}?`}
          description={ACT[pending.act].desc(pending.m)}
          tone={ACT[pending.act].danger ? "danger" : "default"}
          requireReason={pending.act === "retrain" ? undefined : "Reason (recorded in the governance log)"}
          confirmLabel={ACT[pending.act].label}
          onConfirm={async () => {
            await services.lead.modelAction(pending.m?.id ?? "", pending.act);
            toast({ tone: "success", title: pending.act === "retrain" ? "Retraining queued" : "Model updated", body: pending.m ? `v${pending.m.version}` : undefined });
            setPending(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}
