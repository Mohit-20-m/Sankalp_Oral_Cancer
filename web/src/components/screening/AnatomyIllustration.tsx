import type { SiteId } from "@/types";
import { cn } from "@/utils/cn";

/**
 * Anatomical guidance drawings for the seven photo sites (front view, as the
 * health worker sees the patient). The target region is highlighted in lime
 * with a dashed outline; everything else is muted. Note: the patient's LEFT
 * cheek appears on the viewer's RIGHT — this is labelled on the drawing.
 */
const HI = "#D6EC8C";
const HI_STROKE = "#16352A";

export function AnatomyIllustration({ site, className }: { site: SiteId; className?: string }) {
  if (site === "open_mouth") return <FaceIllustration className={className} />;
  const on = (s: SiteId | SiteId[]) => (Array.isArray(s) ? s.includes(site) : s === site);
  const dim = (s: SiteId | SiteId[]) => (on(s) ? 1 : 0.55);
  const raised = site === "tongue_under";

  return (
    <svg viewBox="0 0 220 170" className={cn("h-auto w-full", className)} role="img" aria-label={`Guide: ${site.replace("_", " ")}`}>
      <defs>
        <clipPath id={`cav-${site}`}>
          <ellipse cx="110" cy="86" rx="76" ry="54" />
        </clipPath>
        <pattern id={`hatch-${site}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={HI} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#B7D45E" strokeWidth="2" />
        </pattern>
      </defs>

      {/* lips */}
      <ellipse cx="110" cy="86" rx="98" ry="74" fill="#F1C9BE" />
      <ellipse cx="110" cy="86" rx="88" ry="64" fill="#E39C92" />
      {/* cavity */}
      <ellipse cx="110" cy="86" rx="76" ry="54" fill="#6E2A31" />

      <g clipPath={`url(#cav-${site})`}>
        {/* palate */}
        <ellipse cx="110" cy="60" rx="58" ry="26" fill={on("palate") ? `url(#hatch-${site})` : "#B85A62"} opacity={dim("palate")} />
        {!on("palate") && <path d="M110 40v34" stroke="#9D4950" strokeWidth="2" opacity=".6" />}

        {/* cheeks (patient's right = viewer's left) */}
        <path d="M34 50c14 16 18 56 2 78l-10-20 0-50z" fill={on("right_cheek") ? `url(#hatch-${site})` : "#A44C55"} opacity={dim("right_cheek")} />
        <path d="M186 50c-14 16-18 56-2 78l10-20 0-50z" fill={on("left_cheek") ? `url(#hatch-${site})` : "#A44C55"} opacity={dim("left_cheek")} />

        {/* floor of mouth / under tongue */}
        {raised && <ellipse cx="110" cy="120" rx="44" ry="20" fill={`url(#hatch-${site})`} />}

        {/* tongue */}
        {raised ? (
          <path d="M70 140c0-40 14-70 40-74 26 4 40 34 40 74z" fill="#D86D73" opacity=".8" />
        ) : (
          <path d="M58 140c4-34 24-54 52-54s48 20 52 54z" fill={on("tongue_top") ? `url(#hatch-${site})` : "#D86D73"} opacity={dim("tongue_top")} />
        )}
        {!raised && !on("tongue_top") && <path d="M110 96v34" stroke="#B85860" strokeWidth="2" opacity=".6" />}
        {raised && <path d="M96 118c6 8 22 8 28 0" stroke="#7A2E36" strokeWidth="2" fill="none" />}

        {/* gums */}
        <path d="M44 34h132v12H44z" fill={on("gums") ? `url(#hatch-${site})` : "#E58A8E"} opacity={dim("gums")} />
        <path d="M44 128h132v14H44z" fill={on("gums") ? `url(#hatch-${site})` : "#E58A8E"} opacity={dim("gums")} />
        {/* teeth */}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect key={`u${i}`} x={52 + i * 11.6} y={42} width="10" height="13" rx="3" fill="#FBF7EE" />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <rect key={`l${i}`} x={52 + i * 11.6} y={118} width="10" height="12" rx="3" fill="#FBF7EE" />
        ))}
      </g>

      {/* highlight outline */}
      {on("palate") && <ellipse cx="110" cy="62" rx="56" ry="22" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />}
      {on("tongue_top") && <path d="M60 138c4-32 24-50 50-50s46 18 50 50" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />}
      {on("tongue_under") && <ellipse cx="110" cy="120" rx="44" ry="18" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />}
      {on("gums") && (
        <>
          <rect x="44" y="34" width="132" height="12" rx="6" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />
          <rect x="44" y="128" width="132" height="14" rx="6" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />
        </>
      )}
      {on("right_cheek") && <path d="M36 50c14 16 18 56 2 78" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />}
      {on("left_cheek") && <path d="M184 50c-14 16-18 56-2 78" fill="none" stroke={HI_STROKE} strokeWidth="2" strokeDasharray="5 4" />}

      {/* orientation labels */}
      <text x="8" y="164" fontSize="9" fontWeight="600" fill="#1A2620" opacity=".55">PATIENT'S RIGHT</text>
      <text x="212" y="164" fontSize="9" fontWeight="600" fill="#1A2620" opacity=".55" textAnchor="end">PATIENT'S LEFT</text>
    </svg>
  );
}

function FaceIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 170" className={cn("h-auto w-full", className)} role="img" aria-label="Guide: open mouth face photo">
      <ellipse cx="110" cy="88" rx="62" ry="78" fill="#E9C3A6" />
      <path d="M52 66c0-44 26-62 58-62s58 18 58 62c-8-20-30-30-58-30S60 46 52 66z" fill="#3B2A22" />
      {[84, 136].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="78" rx="13" ry="7.5" fill="#fff" />
          <circle cx={cx} cy="78" r="6" fill="#5A3B2A" />
          <circle cx={cx} cy="78" r="9" fill="none" stroke="#16352A" strokeWidth="1.8" strokeDasharray="3 2.5" />
          <circle cx={cx - 6} cy="78" r="2" fill={HI} stroke="#16352A" />
          <circle cx={cx + 6} cy="78" r="2" fill={HI} stroke="#16352A" />
        </g>
      ))}
      <path d="M110 86v18l-6 4" stroke="#C99A7E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="110" cy="132" rx="22" ry="20" fill="#E39C92" />
      <ellipse cx="110" cy="132" rx="16" ry="15" fill="#6E2A31" />
      <path d="M110 115v34" stroke="#16352A" strokeWidth="1.8" strokeDasharray="3 2.5" />
      <circle cx="110" cy="117" r="2.6" fill={HI} stroke="#16352A" />
      <circle cx="110" cy="147" r="2.6" fill={HI} stroke="#16352A" />
      <text x="110" y="168" fontSize="9" fontWeight="600" fill="#1A2620" opacity=".55" textAnchor="middle">FACE CAMERA · EYES LEVEL</text>
    </svg>
  );
}
