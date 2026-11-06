import type { Language } from "@/types";

/**
 * Non-sensitive UI preferences ONLY (language, sound, motion, text size).
 * Never store patient data or tokens here — localStorage is not secure.
 */
export interface Preferences {
  language: Language;
  soundEnabled: boolean;
  soundVolume: number; // 0..1
  reduceMotion: boolean | "system";
  highContrast: boolean;
  textScale: 1 | 1.125 | 1.25;
  voicePrompts: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULTS: Preferences = {
  language: "en",
  soundEnabled: true,
  soundVolume: 0.5,
  reduceMotion: "system",
  highContrast: false,
  textScale: 1,
  voicePrompts: true,
  sidebarCollapsed: false,
};

const KEY = "ui-prefs-v1";
type Listener = (p: Preferences) => void;
const listeners = new Set<Listener>();

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let cache: Preferences = typeof window === "undefined" ? { ...DEFAULTS } : read();

export const prefs = {
  all: (): Preferences => cache,
  get: <K extends keyof Preferences>(k: K): Preferences[K] => cache[k],
  set: <K extends keyof Preferences>(k: K, v: Preferences[K]) => {
    cache = { ...cache, [k]: v };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* storage blocked — keep in memory */
    }
    listeners.forEach((l) => l(cache));
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
