import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Send, CheckCircle2, Wifi, Loader2, PartyPopper } from "lucide-react";
import { services } from "@/services";
import { PHOTO_SITES } from "@/config/constants";
import { useI18n } from "@/i18n";
import { LogoMark } from "@/components/brand/Logo";
import { AnatomyIllustration } from "@/components/screening/AnatomyIllustration";
import { QualityMeter, QualityPill } from "@/components/screening/QualityMeter";
import { StepPills } from "@/components/common/ProgressStepper";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import { analyseDataUrl, compressFile } from "@/utils/imageQuality";
import { soundManager } from "@/utils/soundManager";
import { branding } from "@/config/branding";
import type { QualityReport } from "@/types";

/**
 * Phone-side capture page opened from the desktop QR (works on iPhone Safari).
 * Uses the native camera via <input capture>, checks quality on the phone,
 * and only sends photos that pass.
 */
/* Inline, non-blocking message (no window.alert on the phone). */
function alertSoft(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.setAttribute("role", "alert");
  el.style.cssText = "position:fixed;left:16px;right:16px;bottom:24px;z-index:50;padding:14px 16px;border-radius:16px;background:#A3301F;color:#fff;font:600 14px Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2)";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

export default function MobileCapture() {
  const { sessionId = "" } = useParams();
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const [shot, setShot] = useState<{ url: string; q: QualityReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const file = useRef<HTMLInputElement>(null);
  const valid = /^[a-z0-9]{6,}$/i.test(sessionId);

  useEffect(() => {
    if (valid) services.capture.announce(sessionId, /iPhone/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Phone");
  }, [sessionId, valid]);

  if (!valid) return <StateView state="invalidQr" className="min-h-screen justify-center px-6" />;
  const site = PHOTO_SITES[i];
  const done = sent.size === 7;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-6 pt-4">
      <header className="flex items-center gap-3">
        <LogoMark size={34} />
        <div className="flex-1">
          <p className="font-display text-sm font-bold">{branding.appName}</p>
          <p className="flex items-center gap-1.5 text-xs text-primary">
            <Wifi className="size-3.5" /> Connected to desktop
          </p>
        </div>
        <span className="num text-sm font-bold">{sent.size}/7</span>
      </header>

      {done ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-accent text-primary-deep">
              <PartyPopper className="size-9" />
            </span>
            <h1 className="mt-5 text-2xl font-bold">All 7 photos sent</h1>
            <p className="mt-2 text-sm text-ink-soft">You can put the phone down and continue on the desktop.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <StepPills total={7} current={i} done={(n) => sent.has(n)} />
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-4 flex flex-1 flex-col">
              <p className="label-eyebrow">
                Photo {site.index} {t("common.of")} 7
              </p>
              <h1 className="mt-1 text-[1.7rem] font-bold leading-tight">{t(site.labelKey)}</h1>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{t(site.instructionKey)}</p>

              <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-4xl bg-mint">
                {shot ? (
                  <img src={shot.url} alt="Captured" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center p-6">
                    <AnatomyIllustration site={site.id} />
                  </div>
                )}
                {shot && (
                  <div className="absolute left-3 top-3">
                    <QualityPill level={shot.q.overall} />
                  </div>
                )}
                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-white/60 backdrop-blur-sm">
                    <Loader2 className="size-8 animate-spin text-primary" />
                  </div>
                )}
              </div>
              {shot && (
                <div className="mt-3">
                  <QualityMeter report={shot.q} />
                </div>
              )}

              <div className="mt-auto grid gap-2 pt-6">
                {shot ? (
                  <>
                    {!shot.q.acceptable && <p className="text-center text-sm font-semibold text-[#A3301F]">Quality too low — please retake.</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" size="lg" onClick={() => setShot(null)}>
                        <RotateCcw /> Retake
                      </Button>
                      <Button
                        size="lg"
                        disabled={!shot.q.acceptable}
                        loading={busy}
                        sound={null}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await services.capture.sendPhoto(sessionId, { site: site.id, dataUrl: shot.url, quality: shot.q, capturedAt: new Date().toISOString(), source: "phone" });
                          } catch (err) {
                            setBusy(false);
                            soundManager.play("error");
                            alertSoft(err instanceof Error && /expired|410/.test(err.message) ? "This QR code has expired — ask for a new one on the computer." : "Could not send — check Wi-Fi and tap Send again.");
                            return;
                          }
                          soundManager.play("upload");
                          setSent(new Set(sent).add(i));
                          setShot(null);
                          setBusy(false);
                          const nxt = PHOTO_SITES.findIndex((_, n) => n !== i && !sent.has(n));
                          if (nxt >= 0) setI(nxt);
                        }}
                      >
                        <Send /> Send
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button size="lg" className="h-16 text-lg" onClick={() => file.current?.click()} sound={null}>
                    <Camera /> {sent.has(i) ? "Retake photo" : "Open camera"}
                  </Button>
                )}
                {sent.has(i) && !shot && (
                  <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
                    <CheckCircle2 className="size-4" /> Sent
                  </p>
                )}
              </div>
              <input
                ref={file}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  soundManager.play("shutter");
                  setBusy(true);
                  const url = await compressFile(f);
                  setShot({ url, q: await analyseDataUrl(url) });
                  setBusy(false);
                }}
              />
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
