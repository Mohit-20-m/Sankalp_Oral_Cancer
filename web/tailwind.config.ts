import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Brand colours are CSS variables written from src/config/branding.ts.
 * Fonts: change `fontFamily` below and the @fontsource imports in src/main.tsx.
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem" },
    extend: {
      colors: {
        primary: { DEFAULT: v("--c-primary"), deep: v("--c-primary-deep") },
        secondary: v("--c-secondary"),
        accent: v("--c-accent"),
        bg: v("--c-bg"),
        surface: v("--c-surface"),
        ink: { DEFAULT: v("--c-ink"), soft: "rgb(var(--c-ink) / 0.68)", mute: "rgb(var(--c-ink) / 0.5)" },
        line: "rgb(var(--c-ink) / 0.09)",
        mint: "#DCEBDD",
        butter: "#F4E6AE",
        blush: "#F2D4CC",
        sky: "#D3E2EC",
        lilac: "#E1DCEF",
        sand: "#ECE6D6",
        lime: "#D6EC8C",
        risk: {
          low: "#1F7A4A",
          medium: "#8A5A00",
          high: "#A3301F",
          na: "#4B5560",
          review: "#5340B5",
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans Variable"', '"Noto Sans Kannada"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', '"Noto Sans Kannada"', "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        display: ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" }],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.375rem",
        "3xl": "1.75rem",
        "4xl": "2.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(22 53 42 / 0.04), 0 8px 24px -12px rgb(22 53 42 / 0.12)",
        lift: "0 2px 4px rgb(22 53 42 / 0.05), 0 18px 40px -18px rgb(22 53 42 / 0.28)",
        inset: "inset 0 0 0 1px rgb(var(--c-ink) / 0.07)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulseRing: {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "pulse-ring": "pulseRing 1.8s cubic-bezier(0.22,1,0.36,1) infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
