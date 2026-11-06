import { Info, FlaskConical, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/utils/cn";
import { isMockMode } from "@/services/api";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="label-eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[2rem] font-bold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** "Screening aid only — not a diagnosis." Must appear on every AI result. */
export function Disclaimer({ preliminary, className }: { preliminary?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-ink/[0.045] px-4 py-2.5 text-[13px] font-medium text-ink-soft", className)} role="note">
      <span className="inline-flex items-center gap-2">
        <ShieldAlert className="size-4 text-primary" aria-hidden />
        {t("safety.disclaimer")}
      </span>
      {preliminary && (
        <span className="inline-flex items-center gap-2 text-[#8A5A00]">
          <Info className="size-4" aria-hidden />
          {t("safety.preliminary")}
        </span>
      )}
    </div>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  if (!isMockMode) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-butter px-2.5 py-1 text-[11px] font-semibold text-[#5A4500]", className)} title="Showing demo data from src/mocks — set VITE_API_MODE=http to use the real backend">
      <FlaskConical className="size-3.5" aria-hidden /> Demo data
    </span>
  );
}

export function KeyValue({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2", className)}>
      <dt className="text-sm text-ink-mute">{k}</dt>
      <dd className="text-right text-sm font-semibold text-ink">{v}</dd>
    </div>
  );
}
