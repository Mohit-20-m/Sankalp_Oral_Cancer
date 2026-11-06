import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Check, CameraOff, Lightbulb } from "lucide-react";
import type { CapturedPhoto, PhotoSite, QualityReport } from "@/types";
import { analyseVideoFrame, analyseDataUrl, compressSource } from "@/utils/imageQuality";
import { soundManager } from "@/utils/soundManager";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { AnatomyIllustration } from "./AnatomyIllustration";
import { QualityMeter, QualityPill } from "./QualityMeter";

/**
 * Live webcam capture with real-time quality analysis.
 * The Capture button only enables when the live frame passes all checks,
 * and a captured photo can only be saved if it is acceptable.
 */
export function WebcamCapture({ site, onSave }: { site: PhotoSite; onSave: (p: CapturedPhoto) => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<QualityReport | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "denied">("starting");
  const [shot, setShot] = useState<{ url: string; q: QualityReport } | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus("ready");
        timer = window.setInterval(() => video.current && setLive(analyseVideoFrame(video.current)), 450);
      } catch {
        setStatus("denied");
      }
    })();
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  useEffect(() => setShot(null), [site.id]);

  async function capture() {
    const v = video.current;
    if (!v) return;
    soundManager.play("shutter");
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const url = compressSource(v, v.videoWidth, v.videoHeight);
    setShot({ url, q: await analyseDataUrl(url) });
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-4 rounded-4xl bg-mint/70 p-5">
        <div>
          <p className="label-eyebrow">
            Photo {site.index} {t("common.of")} 7
          </p>
          <h3 className="mt-1 text-xl font-bold">{t(site.labelKey)}</h3>
        </div>
        <div className="rounded-3xl bg-white/80 p-3">
          <AnatomyIllustration site={site.id} />
        </div>
        <p className="flex gap-2 text-sm leading-relaxed text-ink">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" /> {t(site.instructionKey)}
        </p>
      </div>

      <div>
        <div className="relative aspect-video overflow-hidden rounded-4xl bg-primary-deep">
          <video ref={video} muted playsInline className="h-full w-full object-cover" aria-label="Live camera preview" />
          {status === "ready" && !shot && (
            <>
              <div className="pointer-events-none absolute inset-[12%] rounded-[40%] border-2 border-dashed border-white/50" aria-hidden />
              <div className="absolute left-4 top-4">{live && <QualityPill level={live.overall} label={live.acceptable ? "Ready to capture" : "Adjust position / light"} />}</div>
            </>
          )}
          <AnimatePresence>
            {shot && (
              <motion.img key="shot" src={shot.url} alt={`Captured ${t(site.labelKey)}`} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 h-full w-full object-cover" />
            )}
            {flash && <motion.div initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white" />}
          </AnimatePresence>
          {status !== "ready" && (
            <div className="absolute inset-0 grid place-items-center text-center text-white">
              <div>
                {status === "starting" ? <Camera className="mx-auto size-10 animate-pulse text-accent" /> : <CameraOff className="mx-auto size-10 text-accent" />}
                <p className="mt-3 font-semibold">{status === "starting" ? "Starting webcam…" : "Webcam unavailable or permission denied"}</p>
                {status === "denied" && <p className="mt-1 text-sm text-white/60">Use "Upload files" or "Use my phone" instead.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <QualityMeter report={shot?.q ?? live} />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {shot ? (
            <>
              {!shot.q.acceptable && <p className="mr-auto text-sm font-semibold text-[#A3301F]">Photo didn't pass quality checks — please retake.</p>}
              <Button variant="secondary" onClick={() => setShot(null)}>
                <RotateCcw /> Retake
              </Button>
              <Button
                disabled={!shot.q.acceptable}
                sound="complete"
                onClick={() => {
                  onSave({ site: site.id, dataUrl: shot.url, quality: shot.q, capturedAt: new Date().toISOString(), source: "webcam" });
                  setShot(null);
                }}
              >
                <Check /> Save photo
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={capture} disabled={status !== "ready" || !live?.acceptable} sound={null}>
              <Camera /> Capture
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
