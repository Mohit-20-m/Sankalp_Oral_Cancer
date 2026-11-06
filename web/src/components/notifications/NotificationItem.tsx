import { BellRing, ClipboardCheck, Send, Settings2, type LucideIcon } from "lucide-react";
import type { AppNotification, NotificationKind } from "@/types";
import { relativeTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const KIND: Record<NotificationKind, { icon: LucideIcon; bg: string; fg: string; label: string }> = {
  review: { icon: ClipboardCheck, bg: "bg-lilac", fg: "text-[#3D2F80]", label: "Specialist review" },
  referral: { icon: Send, bg: "bg-sky", fg: "text-[#1F4560]", label: "Referral" },
  followup: { icon: BellRing, bg: "bg-butter", fg: "text-[#5A4500]", label: "Follow-up" },
  system: { icon: Settings2, bg: "bg-sand", fg: "text-[#4A4030]", label: "System" },
};

export function NotificationItem({ n, compact }: { n: AppNotification; compact?: boolean }) {
  const k = KIND[n.kind];
  const Icon = k.icon;
  return (
    <div className={cn("relative flex gap-3 rounded-2xl p-3 transition-colors hover:bg-ink/[0.03]", !n.read && "bg-secondary/40")}>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", k.bg, k.fg)}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{n.title}</p>
          {!n.read && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </div>
        <p className={cn("mt-0.5 text-[13px] text-ink-soft", compact && "line-clamp-2")}>{n.body}</p>
        <p className="mt-1 text-[11px] font-medium text-ink-mute">
          {k.label} · {relativeTime(n.at)}
        </p>
      </div>
    </div>
  );
}

export const NOTIFICATION_KINDS = KIND;
