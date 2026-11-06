import { CheckCircle2, Clock3, CalendarCheck, Footprints, AlertCircle, CircleDot, XCircle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

type Tone = "green" | "amber" | "red" | "slate" | "violet" | "lime" | "blue";
const TONE: Record<Tone, string> = {
  green: "bg-[#DDF1E3] text-[#1F7A4A]",
  amber: "bg-[#FBEBC4] text-[#8A5A00]",
  red: "bg-[#F8DAD3] text-[#A3301F]",
  slate: "bg-ink/[0.07] text-ink-soft",
  violet: "bg-[#E5E0FA] text-[#5340B5]",
  lime: "bg-accent text-primary-deep",
  blue: "bg-sky text-[#245170]",
};

const PRESETS: Record<string, { tone: Tone; icon: LucideIcon; label: string }> = {
  issued: { tone: "slate", icon: CircleDot, label: "Issued" },
  booked: { tone: "blue", icon: CalendarCheck, label: "Booked" },
  visited: { tone: "violet", icon: Footprints, label: "Visited" },
  completed: { tone: "green", icon: CheckCircle2, label: "Completed" },
  overdue: { tone: "red", icon: AlertCircle, label: "Overdue" },
  active: { tone: "lime", icon: CheckCircle2, label: "Active" },
  shadow: { tone: "violet", icon: CircleDot, label: "Shadow" },
  retired: { tone: "slate", icon: XCircle, label: "Retired" },
  candidate: { tone: "amber", icon: Clock3, label: "Candidate" },
  pending: { tone: "amber", icon: Clock3, label: "Pending" },
  approved: { tone: "green", icon: CheckCircle2, label: "Approved" },
  rejected: { tone: "red", icon: XCircle, label: "Rejected" },
  operational: { tone: "green", icon: CheckCircle2, label: "Operational" },
  degraded: { tone: "amber", icon: AlertCircle, label: "Degraded" },
  down: { tone: "red", icon: XCircle, label: "Down" },
  delivered: { tone: "green", icon: CheckCircle2, label: "Delivered" },
  failed: { tone: "red", icon: XCircle, label: "Failed" },
  queued: { tone: "slate", icon: Loader2, label: "Queued" },
  reviewed: { tone: "green", icon: CheckCircle2, label: "Specialist reviewed" },
  preliminary: { tone: "amber", icon: Clock3, label: "Preliminary (AI)" },
};

export function StatusBadge({ status, label, className }: { status: keyof typeof PRESETS | string; label?: string; className?: string }) {
  const p = PRESETS[status] ?? { tone: "slate" as Tone, icon: CircleDot, label: status };
  const Icon = p.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONE[p.tone], className)}>
      <Icon className="size-3.5" aria-hidden strokeWidth={2.25} />
      {label ?? p.label}
    </span>
  );
}
