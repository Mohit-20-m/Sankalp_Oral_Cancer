import { motion } from "framer-motion";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

/** Large, touch-friendly segmented choice (≥48px targets). */
export function ChoiceGroup<T extends string | boolean>({
  value,
  onChange,
  options,
  name,
  size = "md",
  className,
}: {
  value: T | null | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: "default" | "warn" }[];
  name: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn("inline-flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const sel = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => {
              soundManager.play("click");
              onChange(o.value);
            }}
            className={cn(
              "relative min-w-[84px] rounded-2xl px-5 font-semibold transition-colors",
              size === "lg" ? "h-14 text-base" : "h-12 text-sm",
              sel ? (o.tone === "warn" ? "text-white" : "text-white") : "bg-surface text-ink-soft shadow-inset hover:text-ink hover:bg-secondary/40",
            )}
          >
            {sel && <motion.span layoutId={`choice-${name}`} className={cn("absolute inset-0 rounded-2xl", o.tone === "warn" ? "bg-[#A3301F]" : "bg-primary-deep")} transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function NumberStepper({ value, onChange, min = 0, max = 99, label, suffix }: { value: number | undefined; onChange: (n: number) => void; min?: number; max?: number; label: string; suffix?: string }) {
  const v = value ?? 0;
  const set = (n: number) => {
    soundManager.play("click");
    onChange(Math.max(min, Math.min(max, n)));
  };
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" onClick={() => set(v - 1)} className="grid size-12 place-items-center rounded-2xl bg-surface text-xl font-bold shadow-inset hover:bg-secondary/50" aria-label={`Decrease ${label}`}>
        −
      </button>
      <div className="min-w-[88px] rounded-2xl bg-surface px-3 py-2 text-center shadow-inset">
        <input
          type="number"
          inputMode="numeric"
          value={value ?? ""}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
          className="num w-full bg-transparent text-center text-xl font-bold focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          aria-label={label}
        />
        {suffix && <span className="block text-[11px] text-ink-mute">{suffix}</span>}
      </div>
      <button type="button" onClick={() => set(v + 1)} className="grid size-12 place-items-center rounded-2xl bg-surface text-xl font-bold shadow-inset hover:bg-secondary/50" aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}
