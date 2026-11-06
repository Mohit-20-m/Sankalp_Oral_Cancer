import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/utils/cn";

export interface Step {
  id: string;
  label: string;
}

/** Vertical rail stepper (desktop) — mirrors the mobile progress pills. */
export function ProgressStepper({ steps, current, onSelect, maxReached }: { steps: Step[]; current: number; onSelect?: (i: number) => void; maxReached: number }) {
  return (
    <ol className="relative flex flex-col gap-1" aria-label="Screening progress">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReached;
        return (
          <li key={s.id} className="relative">
            {i < steps.length - 1 && (
              <span className="absolute left-[22px] top-[42px] h-[calc(100%-30px)] w-0.5 rounded bg-ink/10" aria-hidden>
                <motion.span className="block w-full rounded bg-primary" initial={false} animate={{ height: done ? "100%" : "0%" }} transition={{ duration: 0.35 }} />
              </span>
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect?.(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-1.5 py-1.5 text-left transition-colors",
                reachable && !active && "hover:bg-ink/[0.04]",
                !reachable && "cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "relative grid size-[34px] shrink-0 place-items-center rounded-full text-sm font-bold transition-colors",
                  done && "bg-primary text-white",
                  active && "bg-primary-deep text-accent ring-4 ring-accent/60",
                  !done && !active && "bg-surface text-ink-mute shadow-inset",
                )}
              >
                {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-sm font-semibold", active ? "text-ink" : done ? "text-ink-soft" : "text-ink-mute")}>{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact horizontal pills (used on narrow layouts & the phone capture page). */
export function StepPills({ total, current, done }: { total: number; current: number; done?: (i: number) => boolean }) {
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === current ? "w-7 bg-primary-deep" : done?.(i) ? "w-3 bg-primary" : "w-3 bg-ink/15",
          )}
        />
      ))}
    </div>
  );
}
