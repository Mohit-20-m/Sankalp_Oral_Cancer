import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
  side = "center",
}: {
  children: ReactNode;
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  side?: "center" | "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-primary-deep/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 bg-surface shadow-lift outline-none",
          side === "center" &&
            "left-1/2 top-1/2 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-4xl p-7 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          side === "right" &&
            "right-3 top-3 bottom-3 w-[min(94vw,460px)] overflow-y-auto rounded-4xl p-7 data-[state=open]:animate-in data-[state=open]:slide-in-from-right-10 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-10 data-[state=closed]:fade-out-0",
          className,
        )}
      >
        <div className="mb-5 pr-8">
          <DialogPrimitive.Title className="font-display text-xl font-bold text-ink">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1.5 text-sm text-ink-soft">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-5 top-5 grid size-9 place-items-center rounded-full text-ink-mute transition hover:bg-ink/5 hover:text-ink" aria-label="Close">
          <X className="size-[18px]" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
