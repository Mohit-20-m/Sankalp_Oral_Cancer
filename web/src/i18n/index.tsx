import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language } from "@/types";
import { en, type TKey } from "./en";
import { kn } from "./kn";
import { tcy } from "./tcy";
import { prefs } from "@/utils/preferences";

const dictionaries: Record<Language, Partial<Record<TKey, string>>> = { en, kn, tcy };
const fallbackChain: Record<Language, Language[]> = { en: ["en"], kn: ["kn", "en"], tcy: ["tcy", "kn", "en"] };

interface I18nCtx {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TKey | string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => prefs.get("language"));

  useEffect(() => {
    document.documentElement.lang = lang === "tcy" ? "tcy" : lang;
  }, [lang]);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    prefs.set("language", l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let out: string = key;
      for (const l of fallbackChain[lang]) {
        const hit = dictionaries[l][key as TKey];
        if (hit) {
          out = hit;
          break;
        }
      }
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
      return out;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used inside I18nProvider");
  return c;
}

export type { TKey };
