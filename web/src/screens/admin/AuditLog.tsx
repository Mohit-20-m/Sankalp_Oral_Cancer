import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ShieldAlert, Link2, Loader2, Eye, FileClock } from "lucide-react";
import { services } from "@/services";
import { useAsync, useDebounced } from "@/hooks";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { SearchBar } from "@/components/common/SearchBar";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "@/mocks/data";
import type { AuditEntry } from "@/types";
import { formatDateTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const ACTION_TONE: Record<string, string> = {
  VIEW: "bg-sky text-[#1F4560]",
  CREATE: "bg-mint text-primary-deep",
  UPDATE: "bg-butter text-[#5A4500]",
  REVIEW: "bg-lilac text-[#3D2F80]",
  LOGIN: "bg-sand text-ink-soft",
  EXPORT: "bg-blush text-[#7A2418]",
  APPROVE: "bg-lime text-primary-deep",
};

export default function AuditLog() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("ALL");
  const dq = useDebounced(q);
  const { data, loading } = useAsync(() => services.admin.audit(dq), [dq]);
  const [verify, setVerify] = useState<"idle" | "running" | { ok: boolean; checked: number; brokenAt?: string }>("idle");
  const [access, setAccess] = useState<string | null>(null);
  const rows = (data ?? []).filter((a) => action === "ALL" || a.action === action);
  const accessRows = (data ?? []).filter((a) => access && a.resource.endsWith(access));

  return (
    <Page>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Append-only, hash-chained record of every access and change. Each entry includes the hash of the one before it."
        actions={
          <Button
            loading={verify === "running"}
            onClick={async () => {
              setVerify("running");
              setVerify(await services.admin.verifyChain());
            }}
          >
            <Link2 /> Verify chain
          </Button>
        }
      />

      <AnimatePresence>
        {typeof verify === "object" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
            <div className={cn("flex items-center gap-4 rounded-4xl p-5", verify.ok ? "bg-mint" : "bg-blush")} role="status">
              {verify.ok ? <ShieldCheck className="size-8 text-primary" /> : <ShieldAlert className="size-8 text-[#A3301F]" />}
              <div>
                <p className="font-bold">{verify.ok ? "Chain intact" : "Tampering detected"}</p>
                <p className="text-sm text-ink-soft">
                  {verify.checked} entries checked.{" "}
                  {!verify.ok && (
                    <>
                      Hash mismatch at <b className="num">{verify.brokenAt}</b>. The incident has been logged and admins notified.
                    </>
                  )}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DashboardCard>
        <div className="mb-4 flex flex-wrap gap-3">
          <SearchBar value={q} onValueChange={setQ} placeholder="Search actor, action, resource or entry ID" className="min-w-[280px] flex-1" />
          <div className="flex flex-wrap gap-1.5">
            {["ALL", "VIEW", "CREATE", "UPDATE", "REVIEW", "EXPORT", "APPROVE", "LOGIN"].map((a) => (
              <button key={a} onClick={() => setAction(a)} aria-pressed={action === a} className={cn("h-9 rounded-full px-3.5 text-xs font-bold", action === a ? "bg-primary-deep text-white" : "bg-ink/5 text-ink-soft")}>
                {a === "ALL" ? "All" : a}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <LoadingSkeleton rows={8} />
        ) : !rows.length ? (
          <StateView state="noResults" compact />
        ) : (
          <div className="scroll-thin max-h-[620px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-mute">
                  <th className="py-3 pr-4 font-semibold">Time</th>
                  <th className="pr-4 font-semibold">Actor</th>
                  <th className="pr-4 font-semibold">Action</th>
                  <th className="pr-4 font-semibold">Resource</th>
                  <th className="pr-4 font-semibold">Hash</th>
                  <th className="font-semibold">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a: AuditEntry) => (
                  <tr key={a.id} className={cn("transition-colors hover:bg-ink/[0.02]", a.tampered && "bg-blush/40")} style={{ contentVisibility: "auto", containIntrinsicSize: "56px" }}>
                    <td className="whitespace-nowrap py-3 pr-4 text-ink-soft">{formatDateTime(a.at)}</td>
                    <td className="pr-4">
                      <p className="font-semibold">{a.actor}</p>
                      <p className="text-xs text-ink-mute">{ROLE_LABEL[a.role]}</p>
                    </td>
                    <td className="pr-4">
                      <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", ACTION_TONE[a.action])}>{a.action}</span>
                    </td>
                    <td className="pr-4">
                      <button onClick={() => setAccess(a.resource.split("/")[1])} className="num inline-flex items-center gap-1.5 text-left font-medium text-primary hover:underline" title="Show access history for this record">
                        <Eye className="size-3.5" /> {a.resource}
                      </button>
                    </td>
                    <td className="pr-4">
                      <code className="num text-xs text-ink-mute">{a.hash.slice(0, 10)}…</code>
                    </td>
                    <td>
                      {a.tampered && typeof verify === "object" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#A3301F]"><ShieldAlert className="size-4" /> Mismatch</span>
                      ) : typeof verify === "object" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-primary"><ShieldCheck className="size-4" /> Verified</span>
                      ) : verify === "running" ? (
                        <Loader2 className="size-4 animate-spin text-ink-mute" />
                      ) : (
                        <span className="text-xs text-ink-mute">Not checked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>

      <Dialog open={!!access} onOpenChange={(o) => !o && setAccess(null)}>
        <DialogContent side="right" title="Record access history" description={`Every view or change of ${access}`}>
          <ol className="space-y-3">
            {accessRows.length ? (
              accessRows.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-2xl bg-bg p-3">
                  <FileClock className="mt-0.5 size-4 text-primary" />
                  <div className="text-sm">
                    <p className="font-semibold">
                      {a.actor} · {a.action}
                    </p>
                    <p className="text-xs text-ink-mute">
                      {formatDateTime(a.at)} · {a.ip}
                    </p>
                  </div>
                </li>
              ))
            ) : (
              <p className="text-sm text-ink-mute">No other entries in the current view.</p>
            )}
          </ol>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
