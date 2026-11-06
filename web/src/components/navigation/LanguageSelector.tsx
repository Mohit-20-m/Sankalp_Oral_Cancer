import { Check, Languages } from "lucide-react";
import { useI18n } from "@/i18n";
import type { Language } from "@/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { cn } from "@/utils/cn";

export const LANGUAGES: { code: Language; native: string; english: string }[] = [
  { code: "en", native: "English", english: "English" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada" },
  { code: "tcy", native: "ತುಳು", english: "Tulu" },
];

export function LanguageSelector({ variant = "pill" }: { variant?: "pill" | "segmented" }) {
  const { lang, setLang } = useI18n();
  if (variant === "segmented")
    return (
      <div className="inline-flex rounded-full bg-ink/5 p-1" role="radiogroup" aria-label="Language">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            role="radio"
            aria-checked={lang === l.code}
            onClick={() => setLang(l.code)}
            className={cn("h-9 rounded-full px-4 text-sm font-semibold transition-colors", lang === l.code ? "bg-primary-deep text-white" : "text-ink-soft hover:text-ink")}
          >
            {l.native}
          </button>
        ))}
      </div>
    );
  const cur = LANGUAGES.find((l) => l.code === lang)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink shadow-soft transition hover:shadow-lift" aria-label={`Language: ${cur.english}`}>
          <Languages className="size-[18px] text-primary" />
          {cur.native}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => setLang(l.code)}>
            <span className="flex-1">
              <span className="block font-semibold">{l.native}</span>
              <span className="block text-xs text-ink-mute">{l.english}</span>
            </span>
            {lang === l.code && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
