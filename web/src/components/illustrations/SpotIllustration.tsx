import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Consistent spot-illustration system: organic pastel blob + floating card +
 * line icon + small accent marks. All state screens share this composition,
 * so empty/offline/error states feel like one family.
 * To use bespoke artwork, drop SVGs in src/assets/illustrations and render
 * them via the `art` prop instead.
 */
const BLOBS = [
  "M43 12c18-9 46-6 62 9s19 39 8 56-37 27-58 23S16 84 11 65 25 21 43 12Z",
  "M30 18c16-14 47-14 66 0s25 39 13 57-38 27-60 22S10 78 8 59s6-27 22-41Z",
  "M52 9c20 2 41 15 50 33s4 41-13 53-44 13-62 3S5 70 9 50s23-43 43-41Z",
];

export function SpotIllustration({
  icon: Icon,
  blob = "#DCEBDD",
  card = "#FFFFFF",
  accent = "#D6EC8C",
  ink = "#16352A",
  variant = 0,
  className,
  art,
  badge: Badge,
  badgeBg = "#16352A",
  badgeFg = "#D6EC8C",
}: {
  icon: LucideIcon;
  blob?: string;
  card?: string;
  accent?: string;
  ink?: string;
  variant?: 0 | 1 | 2;
  className?: string;
  art?: string;
  badge?: LucideIcon;
  badgeBg?: string;
  badgeFg?: string;
}) {
  if (art) return <img src={art} alt="" className={className} />;
  return (
    <div className={cn("relative h-[132px] w-[168px]", className)} aria-hidden>
      <svg viewBox="0 0 120 110" className="absolute inset-0 h-full w-full">
        <path d={BLOBS[variant]} fill={blob} />
        <circle cx="104" cy="18" r="5" fill={accent} />
        <circle cx="14" cy="88" r="3.5" fill={ink} opacity="0.15" />
        <path d="M18 22l3 3m0-3l-3 3" stroke={ink} strokeOpacity=".35" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M100 86c3 0 5-2 5-5" stroke={ink} strokeOpacity=".25" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
      <div
        className="absolute left-1/2 top-1/2 grid size-[72px] -translate-x-1/2 -translate-y-1/2 -rotate-6 place-items-center rounded-[22px] shadow-lift"
        style={{ backgroundColor: card }}
      >
        <Icon className="size-9" style={{ color: ink }} strokeWidth={1.6} />
      </div>
      {Badge && (
        <div className="absolute right-[34px] top-[22px] grid size-8 rotate-6 place-items-center rounded-full shadow-soft" style={{ backgroundColor: badgeBg }}>
          <Badge className="size-4" style={{ color: badgeFg }} strokeWidth={2.4} />
        </div>
      )}
    </div>
  );
}
