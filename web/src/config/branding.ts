/**
 * ─────────────────────────────────────────────────────────────
 *  BRANDING — the single source of truth for name, logo & colours
 * ─────────────────────────────────────────────────────────────
 *  Change the app name, tagline, logo or brand colours HERE ONLY.
 *  Every screen, the browser tab title, the favicon, the sidebar,
 *  notifications and the login page read from this object.
 *
 *  Colours are written into CSS variables at startup
 *  (see `applyBrandingToDocument` in src/config/theme.ts), so Tailwind
 *  classes such as `bg-primary` or `text-ink` update automatically.
 *
 *  The mobile app has an identical file at mobile/src/config/branding.ts —
 *  keep both in sync when you rebrand.
 */
export const branding = {
  appName: "Arogya",
  /** Short form used in tight spaces (collapsed sidebar, favicon fallback). */
  appShortName: "AR",
  tagline: "AI-Powered Oral Pre-Cancer Screening. Early Detection.",
  description:
    "AI-assisted oral cancer screening and referral platform for primary health centres.",

  /** Files live in /public/brand. Replace the SVGs to change the logo everywhere. */
  logo: "/brand/logo-full.png", // full logo with name + tagline, transparent background (light surfaces)
  logoMark: "/brand/logo-mark.png", // the symbol on its own, transparent background
  favicon: "/brand/favicon.png",
  appIcon: "/brand/app-icon.png",

  /**
   * Set to true once you drop a real logo into /public/brand.
   * While false, a code-drawn mark + the appName text is shown
   * (src/components/brand/Logo.tsx), so renaming needs no new artwork.
   */
  useImageLogo: true,

  colors: {
    primary: "#2F6B4F", // forest green — primary actions
    primaryDeep: "#16352A", // deep forest — navigation, hero surfaces
    secondary: "#DCEBDD", // soft mint — secondary surfaces
    accent: "#D6EC8C", // light lime — highlights, active states
    background: "#F6F3EA", // warm off-white
    surface: "#FFFFFF",
    text: "#1A2620", // charcoal-green ink
  },

  supportEmail: "support@example.org",
  version: "1.0.0",
  copyrightHolder: "Arogya",
} as const;

export type Branding = typeof branding;
