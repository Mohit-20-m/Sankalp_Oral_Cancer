import { useState } from "react";
import { MessageSquareText, PhoneCall } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { StatCard } from "@/components/cards/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { formatDateTime } from "@/utils/format";
import { cn } from "@/utils/cn";

export default function Messages() {
  const { data, loading } = useAsync(() => services.admin.messages(), []);
  const [ch, setCh] = useState<"all" | "sms" | "voice">("all");
  const [st, setSt] = useState<"all" | "delivered" | "failed" | "queued">("all");
  const rows = (data ?? []).filter((m) => (ch === "all" || m.channel === ch) && (st === "all" || m.status === st));
  const delivered = data?.filter((m) => m.status === "delivered").length ?? 0;

  return (
    <Page>
      <PageHeader eyebrow="Administration" title="SMS & voice logs" description="Outbound patient messages. Phone numbers are masked." />
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Messages (24h)" value={data?.length ?? 0} icon={MessageSquareText} tone="sky" />
        <StatCard label="Delivery rate" value={data?.length ? (delivered / data.length) * 100 : 0} decimals={1} suffix="%" tone="lime" />
        <StatCard label="Failed" value={data?.filter((m) => m.status === "failed").length ?? 0} tone="blush" />
      </div>
      <DashboardCard>
        <div className="mb-4 flex flex-wrap gap-3">
          {[
            { v: ch, set: setCh, opts: ["all", "sms", "voice"] as const },
            { v: st, set: setSt, opts: ["all", "delivered", "failed", "queued"] as const },
          ].map((g, gi) => (
            <div key={gi} className="flex rounded-full bg-ink/5 p-1">
              {g.opts.map((o) => (
                <button key={o} onClick={() => (g.set as (x: string) => void)(o)} aria-pressed={g.v === o} className={cn("h-9 rounded-full px-4 text-sm font-semibold capitalize", g.v === o ? "bg-primary-deep text-white" : "text-ink-soft")}>
                  {o === "sms" ? "SMS" : o}
                </button>
              ))}
            </div>
          ))}
        </div>
        {loading ? (
          <LoadingSkeleton rows={8} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-mute">
                <th className="py-3 font-semibold">Channel</th>
                <th className="font-semibold">To</th>
                <th className="font-semibold">Template</th>
                <th className="font-semibold">Sent</th>
                <th className="font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      {m.channel === "sms" ? <MessageSquareText className="size-4 text-primary" /> : <PhoneCall className="size-4 text-[#5340B5]" />}
                      {m.channel === "sms" ? "SMS" : "Voice"}
                    </span>
                  </td>
                  <td className="num">{m.to}</td>
                  <td>
                    <code className="rounded-lg bg-ink/5 px-2 py-1 text-xs">{m.template}</code>
                  </td>
                  <td className="text-ink-soft">{formatDateTime(m.at)}</td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardCard>
    </Page>
  );
}
