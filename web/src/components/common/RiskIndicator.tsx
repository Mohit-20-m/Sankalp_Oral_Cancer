import { ShieldCheck, AlertTriangle, AlertOctagon, HelpCircle, Eye, type LucideIcon } from "lucide-react";
import { riskTokens } from "@/config/theme";
import { useI18n } from "@/i18n";
import type { RiskLevel } from "@/types";
import { cn } from "@/utils/cn";

/** Risk ALWAYS = colour + distinct icon shape + text label. Never colour alone. */
export const RISK_ICON: Record<RiskLevel, LucideIcon> = {
  LOW: ShieldCheck,
  MEDIUM: AlertTriangle,
  HIGH: AlertOctagon,
  CANNOT_ASSESS: HelpCircle,
  NEEDS_REVIEW: Eye,
};

export function RiskIndicator({ risk, size = "md", className }: { risk: RiskLevel; size?: "sm" | "md" | "lg"; className?: string }) {
  const { t } = useI18n();
  const tok = riskTokens[risk];
  const Icon = RISK_ICON[risk];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold",
        size === "sm" && "px-2 py-0.5 text-xs [&_svg]:size-3.5",
        size === "md" && "px-2.5 py-1 text-xs [&_svg]:size-4",
        size === "lg" && "px-4 py-2 text-sm [&_svg]:size-5",
        className,
      )}
      style={{ color: tok.fg, backgroundColor: tok.bg, boxShadow: `inset 0 0 0 1px ${tok.ring}66` }}
    >
      <Icon aria-hidden strokeWidth={2.25} />
      {t(tok.labelKey)}
    </span>
  );
}
