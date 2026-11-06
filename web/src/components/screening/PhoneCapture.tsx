import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion } from "framer-motion";
import { Smartphone, RefreshCw, Link2, Timer, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { services, type CaptureSession } from "@/services";
import { isMockMode } from "@/services/api";
import { useCountdown } from "@/hooks";
import { Button } from "@/components/ui/button";
import { StateView } from "@/components/common/StateView";
import type { CapturedPhoto } from "@/types";
import { soundManager } from "@/utils/soundManager";
import { CAPTURE_SESSION_MINUTES } from "@/config/constants";
import { cn } from "@/utils/cn";

/**
 * "Use my phone": desktop shows a QR → nurse scans with any phone (incl. iPhone)
 * → /capture/:id opens a guided mobile capture page → photos stream back here.
 * Transport: WebSocket in http mode; BroadcastChannel (same-browser tabs) in demo mode.
 */
export function PhoneCapture({ onPhoto, captured }: { onPhoto: (p: CapturedPhoto) => void; captured: number }) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const cd = useCountdown(session?.expiresAt);
  const onPhotoRef = useRef(onPhoto);
  onPhotoRef.current = onPhoto;

  const start = useCallback(async () => {
    setDevice(null);
    setSession(await services.capture.createSession());
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!session) return;
    return services.capture.subscribe(session.id, (e) => {
      if (e.type === "connected") {
        setDevice(e.device);
        soundManager.play("notify");
      }
      if (e.type === "photo") {
        onPhotoRef.current(e.photo);
        soundManager.play("upload");
      }
      if (e.type === "disconnected") setDevice(null);
    });
  }, [session]);

  if (session && cd.expired)
    return (
      <StateView
        state="sessionExpired"
        title="QR session expired"
        body={`For privacy, phone capture links last ${CAPTURE_SESSION_MINUTES} minutes. Photos already received are kept.`}
        action={
          <Button onClick={start}>
            <RefreshCw /> New QR code
          </Button>
        }
      />
    );

  return (
    <div className="grid grid-cols-1 items-center gap-8 rounded-4xl bg-sky/50 p-8 xl:grid-cols-[auto_1fr]">
      <div className="relative mx-auto rounded-4xl bg-white p-5 shadow-lift">
        {session ? (
          <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}>
            <QRCodeSVG value={session.url} size={208} fgColor="#16352A" level="M" marginSize={0} />
          </motion.div>
        ) : (
          <div className="grid size-[208px] place-items-center">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        )}
      </div>
      <div>
        <h3 className="text-2xl font-bold">Scan with your phone camera</h3>
        <p className="mt-2 max-w-md text-[15px] text-ink-soft">Works with iPhone and Android — no app needed. The phone will guide you through all seven photos, and each one appears here instantly after its quality check.</p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <span className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold", device ? "bg-mint text-primary-deep" : "bg-white/80 text-ink-soft")} role="status">
            {device ? <CheckCircle2 className="size-4" /> : <span className="relative flex size-2.5"><span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary" /><span className="relative size-2.5 rounded-full bg-primary" /></span>}
            {device ? `Connected · ${device}` : "Waiting for phone…"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-2 text-sm font-semibold text-ink-soft">
            <Timer className="size-4" /> Expires in {cd.label}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-2 text-sm font-semibold text-ink-soft">
            <Smartphone className="size-4" /> {captured}/7 received
          </span>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={start}>
            <RefreshCw /> Regenerate
          </Button>
          {session && (
            <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(session.url)}>
              <Link2 /> Copy link
            </Button>
          )}
          {isMockMode && session && (
            <Button variant="ghost" size="sm" onClick={() => window.open(session.url, "_blank", "width=420,height=860")}>
              <ExternalLink /> Open phone view (demo)
            </Button>
          )}
        </div>
        {isMockMode && <p className="mt-3 text-xs text-ink-mute">Demo mode syncs between tabs of this browser. Real phone-to-desktop sync goes through the backend.</p>}
        {!isMockMode && session && /\/\/(localhost|127\.)/.test(session.url) && (
          <p className="mt-3 max-w-md rounded-2xl bg-butter/70 p-3 text-xs text-[#5A4500]">
            A phone cannot open “localhost”. Open this page on the computer using its Wi-Fi address (e.g. https://192.168.1.20), or set
            <b> CAPTURE_BASE_URL</b> in the backend .env — see README → Phone capture.
          </p>
        )}
        {!isMockMode && session && <p className="mt-2 break-all text-[11px] text-ink-mute">{session.url.replace(/\?t=.*/, "?t=…")}</p>}
      </div>
    </div>
  );
}
