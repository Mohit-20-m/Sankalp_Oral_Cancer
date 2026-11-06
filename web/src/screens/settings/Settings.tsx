import type { ReactNode } from "react";
import { Languages, Type, Volume2, Accessibility, Mic, Cpu, LogOut, Contrast, Wind, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAsync, usePreferences } from "@/hooks";
import { services } from "@/services";
import { prefs } from "@/utils/preferences";
import { soundManager, SOUND_LIBRARY, type SoundName } from "@/utils/soundManager";
import { useI18n } from "@/i18n";
import { useAuth } from "@/store/auth";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { LanguageSelector } from "@/components/navigation/LanguageSelector";
import { Switch, Slider } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { branding } from "@/config/branding";
import { cn } from "@/utils/cn";

function Row({ icon: I, title, desc, children, tone = "bg-mint" }: { icon: typeof Type; title: string; desc?: string; children: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4 py-5">
      <span className={cn("grid size-11 place-items-center rounded-2xl text-primary-deep", tone)}>
        <I className="size-5" />
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="font-semibold">{title}</p>
        {desc && <p className="text-sm text-ink-mute">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const model = useAsync(() => services.reference.modelVersion(), []);
  const p = usePreferences();
  const { t } = useI18n();
  const { logout } = useAuth();
  const nav = useNavigate();
  return (
    <Page>
      <PageHeader title={t("settings.title")} description="Preferences are stored on this device only." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="card px-6 py-2">
          <h2 className="pt-5 text-lg font-bold">Language & reading</h2>
          <div className="divide-y divide-line">
            <Row icon={Languages} title={t("settings.language")} desc="Interface language. Patient-facing text follows the patient's preference.">
              <LanguageSelector variant="segmented" />
            </Row>
            <Row icon={Type} title={t("settings.textSize")} tone="bg-butter">
              <div className="flex rounded-full bg-ink/5 p-1">
                {([1, 1.125, 1.25] as const).map((s) => (
                  <button key={s} onClick={() => prefs.set("textScale", s)} aria-pressed={p.textScale === s} className={cn("h-9 rounded-full px-4 font-semibold", p.textScale === s ? "bg-primary-deep text-white" : "text-ink-soft")} style={{ fontSize: `${s * 13}px` }}>
                    A
                  </button>
                ))}
              </div>
            </Row>
            <Row icon={Mic} title={t("settings.voice")} desc="Read consent and instructions aloud." tone="bg-sky">
              <Switch checked={p.voicePrompts} onCheckedChange={(v) => prefs.set("voicePrompts", v)} aria-label="Voice prompts" />
            </Row>
          </div>
        </section>

        <section className="card px-6 py-2">
          <h2 className="pt-5 text-lg font-bold">Sound</h2>
          <div className="divide-y divide-line">
            <Row icon={Volume2} title={t("settings.sound")} desc="Subtle feedback for taps, captures and results. Never plays on page load." tone="bg-lilac">
              <Switch checked={p.soundEnabled} onCheckedChange={(v) => soundManager.setEnabled(v)} aria-label="Sound effects" />
            </Row>
            <Row icon={Volume2} title={t("settings.volume")} tone="bg-lilac">
              <div className={cn("flex w-56 items-center gap-3", !p.soundEnabled && "pointer-events-none opacity-40")}>
                <Slider value={[Math.round(p.soundVolume * 100)]} onValueChange={(v) => soundManager.setVolume(v[0] / 100)} max={100} step={5} aria-label="Volume" />
                <span className="num w-10 text-right text-sm font-bold">{Math.round(p.soundVolume * 100)}%</span>
              </div>
            </Row>
            <div className={cn("flex flex-wrap gap-2 py-5", !p.soundEnabled && "pointer-events-none opacity-40")}>
              {(Object.keys(SOUND_LIBRARY) as SoundName[]).map((s) => (
                <Button key={s} size="sm" variant="secondary" sound={null} onClick={() => soundManager.play(s)} className="capitalize">
                  <Play /> {s}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <section className="card px-6 py-2">
          <h2 className="pt-5 text-lg font-bold">{"Accessibility"}</h2>
          <div className="divide-y divide-line">
            <Row icon={Wind} title={t("settings.motion")} desc="Follow the system setting, or turn animations off entirely." tone="bg-sand">
              <div className="flex rounded-full bg-ink/5 p-1">
                {(["system", true, false] as const).map((v) => (
                  <button key={String(v)} onClick={() => prefs.set("reduceMotion", v)} aria-pressed={p.reduceMotion === v} className={cn("h-9 rounded-full px-3.5 text-sm font-semibold", p.reduceMotion === v ? "bg-primary-deep text-white" : "text-ink-soft")}>
                    {v === "system" ? "System" : v ? "Reduce" : "Full"}
                  </button>
                ))}
              </div>
            </Row>
            <Row icon={Contrast} title={t("settings.contrast")} desc="Stronger text and outlines for bright sunlight." tone="bg-sand">
              <Switch checked={p.highContrast} onCheckedChange={(v) => prefs.set("highContrast", v)} aria-label="High contrast" />
            </Row>
            <Row icon={Accessibility} title="Keyboard & screen readers" desc="All controls are reachable by Tab; risk is always shown with icon + text." tone="bg-sand">
              <span className="text-sm font-semibold text-primary">Enabled</span>
            </Row>
          </div>
        </section>

        <section className="card px-6 py-2">
          <h2 className="pt-5 text-lg font-bold">About</h2>
          <div className="divide-y divide-line">
            <Row icon={Cpu} title="Screening model" desc="Active model version served by the backend.">
              <span className="num rounded-full bg-mint px-3 py-1 text-sm font-bold text-primary-deep">{model.data ?? (model.error ? "unavailable" : "…")}</span>
            </Row>
            <Row icon={Cpu} title={branding.appName} desc={`Version ${branding.version} · ${branding.supportEmail}`}>
              <span />
            </Row>
            <Row icon={LogOut} title={t("common.signOut")} tone="bg-blush">
              <Button
                variant="danger"
                onClick={async () => {
                  await logout();
                  nav("/login");
                }}
              >
                <LogOut /> {t("common.signOut")}
              </Button>
            </Row>
          </div>
        </section>
      </div>
    </Page>
  );
}
