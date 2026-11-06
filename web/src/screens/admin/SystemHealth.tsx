import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, RotateCw, Server, Gauge, Activity, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StatusBadge } from "@/components/common/StatusBadge";
import { StatCard } from "@/components/cards/StatCard";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { relativeTime } from "@/utils/format";
import type { FailedJob } from "@/types";
import { cn } from "@/utils/cn";

export default function SystemHealth() {
  const toast = useToast();
  const h = useAsync(() => services.admin.health(), []);
  const j = useAsync(() => services.admin.failedJobs(), []);
  const [retry, setRetry] = useState<FailedJob | "all" | null>(null);
  const ok = h.data?.filter((s) => s.state === "operational").length ?? 0;

  return (
    <Page>
      <PageHeader eyebrow="Administration" title="System health" description="Live status of every service the screening workflow depends on." actions={<Button variant="secondary" onClick={() => { h.reload(); j.reload(); }}><RefreshCw /> Refresh</Button>} />
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Services operational" value={ok} suffix={` / ${h.data?.length ?? 0}`} icon={Server} tone={ok === h.data?.length ? "lime" : "butter"} />
        <StatCard label="Failed jobs" value={j.data?.length ?? 0} icon={AlertTriangle} tone={(j.data?.length ?? 0) > 0 ? "blush" : "mint"} />
        <StatCard label="API p50 latency" value={h.data?.find((s) => s.id === "api")?.latencyMs ?? 0} suffix=" ms" icon={Gauge} tone="sky" />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <DashboardCard title="Services" className="col-span-12 xl:col-span-7">
          {h.loading ? (
            <LoadingSkeleton rows={6} />
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {h.data?.map((s) => (
                <li key={s.id} className={cn("rounded-3xl p-4", s.state === "operational" ? "bg-bg" : s.state === "degraded" ? "bg-butter/60" : "bg-blush/60")}>
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      {s.state !== "operational" && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-[#D99A1E]" />}
                      <span className={cn("relative size-2.5 rounded-full", s.state === "operational" ? "bg-[#2F9E62]" : s.state === "degraded" ? "bg-[#D99A1E]" : "bg-[#C2412D]")} />
                    </span>
                    <p className="flex-1 font-semibold">{s.name}</p>
                    <StatusBadge status={s.state} />
                  </div>
                  <p className="mt-1 text-xs text-ink-mute">{s.description}</p>
                  <div className="mt-3 flex gap-4 text-xs">
                    <span className="inline-flex items-center gap-1"><Activity className="size-3.5 text-primary" /> <b className="num">{s.latencyMs}</b> ms</span>
                    <span><b className="num">{s.uptime}%</b> uptime (30d)</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard title="Failed jobs" subtitle="Background tasks that exhausted automatic retries" className="col-span-12 xl:col-span-5" action={(j.data?.length ?? 0) > 1 && <Button size="sm" variant="secondary" onClick={() => setRetry("all")}><RotateCw /> Retry all</Button>}>
          {j.loading ? (
            <LoadingSkeleton rows={4} />
          ) : !j.data?.length ? (
            <StateView state="success" compact title="No failed jobs" body="Everything processed normally." />
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {j.data.map((job) => (
                  <motion.li key={job.id} layout exit={{ opacity: 0, x: 30 }} className="rounded-3xl bg-bg p-4">
                    <div className="flex items-center gap-3">
                      <code className="num flex-1 truncate text-sm font-bold">{job.type}</code>
                      <Button size="sm" variant="soft" onClick={() => setRetry(job)}>
                        <RotateCw /> Retry
                      </Button>
                    </div>
                    <p className="mt-1.5 text-sm text-[#A3301F]">{job.error}</p>
                    <p className="mt-1 text-xs text-ink-mute">
                      {job.id} · {job.attempts} attempts · last {relativeTime(job.lastTriedAt)}
                    </p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </DashboardCard>
      </div>

      {retry && (
        <ConfirmationModal
          open
          onOpenChange={(o) => !o && setRetry(null)}
          title={retry === "all" ? `Retry ${j.data?.length} failed jobs?` : `Retry ${retry.type}?`}
          description="Jobs are idempotent — retrying will not send duplicate SMS or double-score a screening."
          confirmLabel="Retry"
          onConfirm={async () => {
            const list = retry === "all" ? j.data ?? [] : [retry];
            for (const x of list) await services.admin.retryJob(x.id);
            toast({ tone: "success", title: `${list.length} job${list.length > 1 ? "s" : ""} re-queued` });
            setRetry(null);
            j.reload();
          }}
        />
      )}
    </Page>
  );
}
