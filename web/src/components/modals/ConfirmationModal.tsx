import { useState, type ReactNode } from "react";
import { AlertTriangle, ShieldQuestion } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/primitives";

/**
 * Required before every important clinical or administrative action.
 * Optionally requires a written reason (audited by the backend).
 */
export function ConfirmationModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "default",
  requireReason,
  onConfirm,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
  requireReason?: string;
  onConfirm: (reason?: string) => void | Promise<void>;
  children?: ReactNode;
  /** Keep the confirm button disabled (e.g. until a required field inside `children` is filled). */
  confirmDisabled?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const Icon = tone === "danger" ? AlertTriangle : ShieldQuestion;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent title={title} description={description}>
        <div className={tone === "danger" ? "mb-5 grid size-12 place-items-center rounded-2xl bg-blush text-[#A3301F]" : "mb-5 grid size-12 place-items-center rounded-2xl bg-mint text-primary-deep"}>
          <Icon className="size-6" aria-hidden />
        </div>
        {children}
        {requireReason && (
          <div className="mb-5">
            <Label htmlFor="confirm-reason">{requireReason}</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="This will be recorded in the audit log." />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            disabled={!!confirmDisabled || (!!requireReason && reason.trim().length < 5)}
            sound="complete"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason || undefined);
                onOpenChange(false);
                setReason("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
