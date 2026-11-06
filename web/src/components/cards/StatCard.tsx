import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { CountUp } from "@/components/common/motion";
import type { Pastel } from "@/config/theme";
import { cn } from "@/utils/cn";

const BG: Record<Pastel | "white" | "deep", string> = {
  mint: "bg-mint",
  butter: "bg-butter",
  blush: "bg-blush",
  sky: "bg-sky",
  lilac: "bg-lilac",
  sand: "bg-sand",
  lime: "bg-lime",
  white: "bg-surface shadow-soft",
  deep: "bg-primary-deep text-white",
};

export interface StatCardProps {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  icon?: LucideIcon;
  tone?: Pastel | "white" | "deep";
  delta?: { value: string; up: boolean; good?: boolean };
  footer?: ReactNode;
  className?: string;
  decoration?: ReactNode;
}

/** Key figure with a soft pastel ground, count-up number and optional trend. */
export function StatCard({ label, value, suffix, decimals, icon: Icon, tone = "white", delta, footer, className, decoration }: StatCardProps) {
  const deep = tone === "deep";
  return (
    <div className={cn("relative isolate overflow-hidden rounded-3xl p-5", BG[tone], className)}>
      {decoration && <div className="pointer-events-none absolute -right-6 -top-6 -z-10 opacity-60">{decoration}</div>}
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-sm font-semibold", deep ? "text-white/75" : "text-ink-soft")}>{label}</p>
        {Icon && (
          <span className={cn("grid size-9 place-items-center rounded-full", deep ? "bg-white/10 text-accent" : "bg-white/70 text-primary-deep")}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        )}
      </div>
      <p className="num mt-3 text-[2.15rem] font-bold leading-none">
        <CountUp value={value} suffix={suffix} decimals={decimals} />
      </p>
      <div className="mt-3 flex min-h-[20px] items-center gap-2 text-xs">
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold",
              deep ? "bg-white/10 text-accent" : (delta.good ?? delta.up) ? "bg-white/70 text-[#1F7A4A]" : "bg-white/70 text-[#A3301F]",
            )}
          >
            {delta.up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {delta.value}
          </span>
        )}
        {footer && <span className={deep ? "text-white/60" : "text-ink-mute"}>{footer}</span>}
      </div>
    </div>
  );
}
