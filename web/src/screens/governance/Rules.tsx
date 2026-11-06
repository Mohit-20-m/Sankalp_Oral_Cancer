import { useState } from "react";
import { ArrowRight, Check, X, PencilLine, UserCheck, ShieldAlert } from "lucide-react";
import { services } from "@/services";
import { ApiError } from "@/services/api";
import { useAsync } from "@/hooks";
import { useAuth } from "@/store/auth";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { RuleProposal, RuleThreshold } from "@/types";
import { formatDate } from "@/utils/format";

export default function Rules() {
  const { user } = useAuth();
  const toast = useToast();
  const rules = useAsync(() => services.lead.rules(), []);
  const props = useAsync(() => services.lead.proposals(), []);
  const [edit, setEdit] = useState<RuleThreshold | null>(null);
  const [nv, setNv] = useState("");
  const [why, setWhy] = useState("");
  const [decide, setDecide] = useState<{ p: RuleProposal; approve: boolean } | null>(null);

  const pending = props.data?.filter((p) => p.status === "pending") ?? [];
  const past = props.data?.filter((p) => p.status !== "pending") ?? [];

  return (
    <Page>
      <PageHeader eyebrow="Clinical lead" title="Rules & thresholds" description="Any change needs a written reason and approval by a different clinical lead (four-eyes principle)." />
      <div className="grid grid-cols-12 gap-5">
        <DashboardCard title="Current thresholds" className="col-span-12 xl:col-span-7">
          {rules.loading ? (
            <LoadingSkeleton rows={5} />
          ) : (
            <ul className="divide-y divide-line">
              {rules.data?.map((r) => (
                <li key={r.id} className="flex items-center gap-4 py-4">
                  <div className="flex-1">
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-sm text-ink-mute">{r.description}</p>
                  </div>
                  <span className="num rounded-2xl bg-mint px-4 py-2 text-lg font-bold text-primary-deep">
                    {r.current}
                    <span className="ml-1 text-xs font-semibold text-ink-mute">{r.unit}</span>
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => { setEdit(r); setNv(String(r.current)); setWhy(""); }}>
                    <PencilLine /> Propose
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <div className="col-span-12 space-y-5 xl:col-span-5">
          <DashboardCard title="Pending approvals" subtitle={`${pending.length} waiting`}>
            {pending.length === 0 ? (
              <p className="text-sm text-ink-mute">Nothing waiting for approval.</p>
            ) : (
              <ul className="space-y-3">
                {pending.map((p) => {
                  const mine = p.proposedById === user?.id;
                  return (
                    <li key={p.id} className="rounded-3xl bg-butter/60 p-5">
                      <p className="font-semibold">{p.ruleName}</p>
                      <div className="my-3 flex items-center gap-3">
                        <span className="num rounded-xl bg-white/70 px-3 py-1.5 font-bold line-through decoration-ink/30">{p.oldValue}</span>
                        <ArrowRight className="size-4 text-ink-mute" />
                        <span className="num rounded-xl bg-primary-deep px-3 py-1.5 font-bold text-accent">{p.newValue}</span>
                      </div>
                      <p className="text-sm text-ink-soft">"{p.reason}"</p>
                      <p className="mt-2 text-xs font-semibold text-ink-mute">
                        {p.proposedBy} · {formatDate(p.proposedAt)}
                      </p>
                      <div className="mt-4 flex gap-2">
                        {mine ? (
                          <Tooltip content="Another clinical lead must approve your proposal" side="top">
                            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-ink-soft">
                              <ShieldAlert className="size-4" /> You proposed this — awaiting a second approver
                            </span>
                          </Tooltip>
                        ) : (
                          <>
                            <Button size="sm" onClick={() => setDecide({ p, approve: true })}>
                              <Check /> Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDecide({ p, approve: false })}>
                              <X /> Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardCard>
          <DashboardCard title="Decision history">
            <ul className="space-y-2">
              {past.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-bg p-3 text-sm">
                  <UserCheck className="size-4 text-primary" />
                  <span className="flex-1">
                    {p.ruleName}: <b className="num">{p.oldValue} → {p.newValue}</b>
                  </span>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          </DashboardCard>
        </div>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={`Propose change: ${edit?.name}`} description="Your proposal goes to another clinical lead for approval.">
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label>Current</Label>
                <p className="num flex h-12 items-center rounded-2xl bg-bg px-4 text-lg font-bold">{edit?.current}</p>
              </div>
              <ArrowRight className="mb-3.5 size-5 text-ink-mute" />
              <div className="flex-1">
                <Label htmlFor="nv">New value</Label>
                <Input id="nv" inputMode="decimal" value={nv} onChange={(e) => setNv(e.target.value)} className="num text-lg font-bold" />
              </div>
            </div>
            <div>
              <Label htmlFor="why">Clinical justification</Label>
              <Textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Evidence, expected impact on sensitivity/specificity…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              <Button
                disabled={!edit || Number(nv) === edit.current || isNaN(Number(nv)) || why.trim().length < 10}
                sound="complete"
                onClick={async () => {
                  await services.lead.propose(edit!.id, Number(nv), why);
                  toast({ tone: "success", title: "Proposal submitted", body: "Awaiting a second clinical lead." });
                  setEdit(null);
                  props.reload();
                }}
              >
                Submit proposal
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {decide && (
        <ConfirmationModal
          open
          onOpenChange={(o) => !o && setDecide(null)}
          title={`${decide.approve ? "Approve" : "Reject"} change to ${decide.p.ruleName}?`}
          description={decide.approve ? `The threshold changes from ${decide.p.oldValue} to ${decide.p.newValue} for all new screenings immediately.` : "The proposer will be notified."}
          tone={decide.approve ? "default" : "danger"}
          requireReason={decide.approve ? undefined : "Reason for rejecting"}
          confirmLabel={decide.approve ? "Approve" : "Reject"}
          onConfirm={async () => {
            try {
              await services.lead.decide(decide.p.id, decide.approve);
              toast({ tone: "success", title: decide.approve ? "Change approved" : "Change rejected" });
              props.reload();
              rules.reload();
            } catch (e) {
              toast({ tone: "error", title: "Not allowed", body: e instanceof ApiError ? e.message : "Action failed" });
            }
            setDecide(null);
          }}
        />
      )}
    </Page>
  );
}
