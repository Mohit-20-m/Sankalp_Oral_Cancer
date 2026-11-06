import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Fingerprint, PenLine, Mic, Volume2, Square, Info } from "lucide-react";
import { useDraft } from "../state";
import { useI18n } from "@/i18n";
import { kn } from "@/i18n/kn";
import { en } from "@/i18n/en";
import { tcy } from "@/i18n/tcy";
import { SignaturePad } from "@/components/forms/SignaturePad";
import { Input, Label } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import type { ConsentMethod, Language } from "@/types";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";

const BODY: Record<Language, string> = { en: en["screen.consentBody"], kn: kn["screen.consentBody"] ?? en["screen.consentBody"], tcy: tcy["screen.consentBody"] ?? kn["screen.consentBody"] ?? en["screen.consentBody"] };
const VOICE_LANG: Record<Language, string> = { en: "en-IN", kn: "kn-IN", tcy: "kn-IN" };

function CheckRow({ checked, onChange, label, required }: { checked: boolean; onChange: (v: boolean) => void; label: string; required?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => {
        soundManager.play("click");
        onChange(!checked);
      }}
      className={cn("flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-colors", checked ? "bg-mint" : "bg-surface shadow-inset hover:bg-secondary/40")}
    >
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg border-2 transition-colors", checked ? "border-primary bg-primary text-white" : "border-ink/25")}>
        <AnimatePresence>{checked && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check className="size-4" strokeWidth={3} /></motion.span>}</AnimatePresence>
      </span>
      <span className="flex-1 text-[15px] font-medium text-ink">{label}</span>
      <span className={cn("text-xs font-semibold", required ? "text-[#A3301F]" : "text-ink-mute")}>{required ? "Required" : "Optional"}</span>
    </button>
  );
}

export function ConsentStep() {
  const { t } = useI18n();
  const { draft, dispatch } = useDraft();
  const c = draft.consent;
  const [lang, setLang] = useState<Language>(draft.patient?.preferredLanguage ?? "kn");
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function speak() {
    if (!canSpeak) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(BODY[lang]);
    u.lang = VOICE_LANG[lang];
    u.rate = 0.9;
    const v = window.speechSynthesis.getVoices().find((x) => x.lang === u.lang);
    if (v) u.voice = v;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  const methods: { id: ConsentMethod; icon: typeof Fingerprint; title: string; body: string; disabled?: boolean }[] = [
    { id: "signature", icon: PenLine, title: "Signature", body: "Patient signs on screen" },
    { id: "verbal_witness", icon: Mic, title: "Verbal + witness", body: "For patients who cannot sign" },
    { id: "fingerprint", icon: Fingerprint, title: "Thumbprint", body: "Mobile app or connected reader", disabled: true },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.1fr_1fr]">
      <div className="rounded-4xl bg-sand/70 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-white/70 p-1" role="radiogroup" aria-label="Consent language">
            {(["kn", "tcy", "en"] as Language[]).map((l) => (
              <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("h-9 rounded-full px-4 text-sm font-semibold", lang === l ? "bg-primary-deep text-white" : "text-ink-soft")}>
                {t(`lang.${l}`)}
              </button>
            ))}
          </div>
          <Button variant={speaking ? "primary" : "secondary"} size="sm" onClick={speak} disabled={!canSpeak} sound={null}>
            {speaking ? <Square /> : <Volume2 />} {speaking ? "Stop" : t("screen.readAloud")}
          </Button>
        </div>
        <p lang={lang === "tcy" ? "tcy" : lang} className="text-[17px] leading-[1.75] text-ink">
          {BODY[lang]}
        </p>
        {lang === "tcy" && !tcy["screen.consentBody"] && (
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-mute">
            <Info className="size-3.5" /> Tulu consent text pending native review — showing Kannada.
          </p>
        )}
      </div>

      <div className="space-y-6">
        <div className="space-y-2.5">
          <CheckRow checked={c.screening} onChange={(v) => dispatch({ type: "consent", consent: { screening: v } })} label={t("screen.consentScreening")} required />
          <CheckRow checked={c.photos} onChange={(v) => dispatch({ type: "consent", consent: { photos: v } })} label={t("screen.consentPhotos")} required />
          <CheckRow checked={c.research} onChange={(v) => dispatch({ type: "consent", consent: { research: v } })} label={t("screen.consentResearch")} />
        </div>

        <div>
          <p className="label-eyebrow mb-3">How is consent recorded?</p>
          <div className="grid grid-cols-3 gap-2.5">
            {methods.map((m) => {
              const I = m.icon;
              const sel = c.method === m.id;
              return (
                <button
                  key={m.id}
                  disabled={m.disabled}
                  onClick={() => {
                    soundManager.play("click");
                    dispatch({ type: "consent", consent: { method: m.id, capturedAt: new Date().toISOString() } });
                  }}
                  className={cn(
                    "flex flex-col items-start gap-3 rounded-3xl p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
                    sel ? "bg-primary-deep text-white shadow-lift" : "bg-surface shadow-inset hover:bg-secondary/40",
                  )}
                  aria-pressed={sel}
                >
                  <I className={cn("size-6", sel ? "text-accent" : "text-primary")} />
                  <span>
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className={cn("block text-xs", sel ? "text-white/60" : "text-ink-mute")}>{m.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {c.method === "signature" && (
            <motion.div key="sig" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SignaturePad onChange={(d) => dispatch({ type: "consent", consent: { signatureDataUrl: d } })} />
            </motion.div>
          )}
          {c.method === "verbal_witness" && (
            <motion.div key="wit" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Label htmlFor="witness">Witness full name</Label>
              <Input id="witness" value={c.witnessName ?? ""} onChange={(e) => dispatch({ type: "consent", consent: { witnessName: e.target.value } })} placeholder="Family member or second health worker" />
              <p className="mt-2 text-xs text-ink-mute">The witness confirms the consent text was read aloud and the patient agreed.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
