import type { SiteId } from "@/types";

/**
 * DEMO ONLY. Generates abstract tissue-textured placeholder "photos" so the
 * specialist console can be demonstrated without real patient images.
 * Every placeholder carries a visible "SAMPLE" watermark.
 */
const TINTS: Record<SiteId, [string, string]> = {
  left_cheek: ["#E9A3A0", "#B9575E"],
  right_cheek: ["#EDAAA4", "#BE5F62"],
  tongue_top: ["#E89497", "#B04A55"],
  tongue_under: ["#E4A0B0", "#A84C67"],
  gums: ["#F0B2AE", "#C5616A"],
  palate: ["#EAB0AA", "#B8636B"],
  open_mouth: ["#E7C3A7", "#9C6E55"],
};

export function samplePhotoUrl(site: SiteId, seed = 1, w = 800, h = 600): string {
  const [a, b] = TINTS[site];
  const face = site === "open_mouth";
  const inner = face
    ? `<ellipse cx="400" cy="320" rx="230" ry="290" fill="${a}"/>
       <ellipse cx="320" cy="250" rx="42" ry="24" fill="#fff"/><circle cx="320" cy="250" r="20" fill="#4A3020"/>
       <ellipse cx="480" cy="250" rx="42" ry="24" fill="#fff"/><circle cx="480" cy="250" r="20" fill="#4A3020"/>
       <ellipse cx="400" cy="450" rx="70" ry="78" fill="#C9787A"/><ellipse cx="400" cy="452" rx="52" ry="62" fill="#5A2228"/>`
    : `<ellipse cx="${380 + seed * 13}" cy="${300 + seed * 7}" rx="${90 + seed * 5}" ry="${60 + seed * 3}" fill="${b}" opacity=".35" filter="url(#soft)"/>
       <path d="M0 ${430 + seed * 4} Q 400 ${360 - seed * 6} 800 ${450 + seed * 2} L800 600 L0 600Z" fill="${b}" opacity=".18"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
    <filter id="t"><feTurbulence type="fractalNoise" baseFrequency="${0.012 + seed * 0.001}" numOctaves="4" seed="${seed}"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.12  0 0 0 0 0.16  0 0 0 .55 0"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="24"/></filter>
  </defs>
  <rect width="800" height="600" fill="${face ? "#2B3A33" : "url(#g)"}"/>
  ${face ? "" : `<rect width="800" height="600" filter="url(#t)" opacity=".55"/>`}
  ${inner}
  <text x="770" y="580" font-family="Inter, sans-serif" font-size="18" font-weight="700" fill="#fff" fill-opacity=".55" text-anchor="end" letter-spacing="3">SAMPLE · NOT A PATIENT</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
