import { CheckCircle2, AlertTriangle, XCircle, Focus, Sun, Sparkles, Smile } from "lucide-react";
import type { QualityLevel, QualityReport } from "@/types";
import { useI18n } from "@/i18n";
import { cn } from "@/utils/cn";

const LV: Record<QualityLevel, { icon: typeof CheckCircle2; cls: string; dot: string }> = {
  good: { icon: CheckCircle2, cls: "bg-[#DDF1E3] text-[#1F7A4A]", dot: "bg-[#2F9E62]" },
  fair: { icon: AlertTriangle, cls: "bg-[#FBEBC4] text-[#8A5A00]", dot: "bg-[#D99A1E]" },
  poor: { icon: XCircle, cls: "bg-[#F8DAD3] text-[#A3301F]", dot: "bg-[#C2412D]" },
};

/** Green / amber / red quality with icon + words — never colour alone. */
export function QualityPill({ level, label }: { level: QualityLevel; label?: string }) {
  const { t } = useI18n();
  const l = LV[level];
  const I = l.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", l.cls)}>
      <I className="size-3.5" aria-hidden /> {label ?? t(`quality.${level}`)}
    </span>
  );
}

export function QualityMeter({ report, dark }: { report: QualityReport | null; dark?: boolean }) {
  const { t } = useI18n();
  const rows = [
    { k: "blur", icon: Focus, label: t("quality.blur"), r: report?.blur },
    { k: "lighting", icon: Sun, label: t("quality.lighting"), r: report?.lighting },
    { k: "glare", icon: Sparkles, label: t("quality.glare"), r: report?.glare },
    { k: "tissue", icon: Smile, label: "Mouth photo", r: report?.tissue },
  ] as const;
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", dark && "text-white")} aria-live="polite">
      {rows.map(({ k, icon: I, label, r }) => {
        const lv = r?.level;
        return (
          <div key={k} className={cn("flex items-center gap-2 rounded-2xl px-3 py-2.5", dark ? "bg-white/10" : "bg-bg")}>
            <I className="size-4 shrink-0 opacity-70" aria-hidden />
            <span className="flex-1 text-xs font-semibold">{label}</span>
            {lv ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold">
                <span className={cn("size-2.5 rounded-full", LV[lv].dot)} aria-hidden />
                {t(`quality.${lv}`)}
              </span>
            ) : (
              <span className="text-[11px] opacity-50">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
