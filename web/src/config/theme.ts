import { branding } from "./branding";
import type { RiskLevel } from "@/types";

/**
 * Design tokens that are NOT brand-specific (pastels, clinical risk colours,
 * radii, motion). Brand colours come from branding.ts.
 */

/** Pastel tints used to keep cards varied — never all the same. */
export const pastels = {
  mint: "#DCEBDD",
  butter: "#F4E6AE",
  blush: "#F2D4CC",
  sky: "#D3E2EC",
  lilac: "#E1DCEF",
  sand: "#ECE6D6",
  lime: "#D6EC8C",
} as const;
export type Pastel = keyof typeof pastels;

/**
 * Clinical risk palette. Every risk is ALWAYS shown with colour + icon + text
 * (see components/common/RiskIndicator.tsx) — colour is never the only signal.
 */
export const riskTokens: Record<
  RiskLevel,
  { fg: string; bg: string; ring: string; labelKey: string }
> = {
  LOW: { fg: "#1F7A4A", bg: "#DDF1E3", ring: "#7CC79A", labelKey: "risk.LOW" },
  MEDIUM: { fg: "#8A5A00", bg: "#FBEBC4", ring: "#E7B755", labelKey: "risk.MEDIUM" },
  HIGH: { fg: "#A3301F", bg: "#F8DAD3", ring: "#E28B78", labelKey: "risk.HIGH" },
  CANNOT_ASSESS: { fg: "#4B5560", bg: "#E7E9EC", ring: "#A9B0B8", labelKey: "risk.CANNOT_ASSESS" },
  NEEDS_REVIEW: { fg: "#5340B5", bg: "#E5E0FA", ring: "#A99BEA", labelKey: "risk.NEEDS_REVIEW" },
};

/** Motion presets — edit here to retune every animation in the app. */
export const motionTokens = {
  fast: 0.16,
  base: 0.24,
  slow: 0.38,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  spring: { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.8 },
};

function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Writes brand colours into CSS variables, sets the title & favicon. */
export function applyBrandingToDocument(): void {
  const root = document.documentElement;
  const c = branding.colors;
  const vars: Record<string, string> = {
    "--c-primary": c.primary,
    "--c-primary-deep": c.primaryDeep,
    "--c-secondary": c.secondary,
    "--c-accent": c.accent,
    "--c-bg": c.background,
    "--c-surface": c.surface,
    "--c-ink": c.text,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, hexToRgbTriplet(v));
  document.title = `${branding.appName} - ${branding.tagline.replace(/\.$/, "")}`;
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) link.href = branding.favicon;
}
