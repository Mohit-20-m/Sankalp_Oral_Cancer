import { useEffect, useRef, useState } from "react";
import { CameraOff, ScanLine } from "lucide-react";
import { soundManager } from "@/utils/soundManager";

interface BarcodeDetectorLike {
  detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Webcam QR scanner using the browser's native BarcodeDetector (Chrome/Edge/Android).
 * Where unsupported, it says so and the caller offers manual code entry.
 */
export function QrScanner({ onResult, active = true }: { onResult: (text: string) => void; active?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "denied">("starting");

  useEffect(() => {
    if (!active) return;
    if (!window.BarcodeDetector) {
      setStatus("unsupported");
      return;
    }
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus("scanning");
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              soundManager.play("success");
              onResult(codes[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          raf = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setStatus("denied");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onResult]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-primary-deep">
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
      {status === "scanning" && (
        <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-accent/80">
          <div className="absolute inset-x-0 top-1/2 h-0.5 animate-pulse bg-accent shadow-[0_0_18px_4px_rgb(214_236_140/0.6)]" />
        </div>
      )}
      {status !== "scanning" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
          <div>
            {status === "starting" ? <ScanLine className="mx-auto size-10 animate-pulse text-accent" /> : <CameraOff className="mx-auto size-10 text-accent" />}
            <p className="mt-3 text-sm font-semibold">
              {status === "starting" && "Starting camera…"}
              {status === "unsupported" && "QR scanning isn't supported in this browser"}
              {status === "denied" && "Camera permission was denied"}
            </p>
            {status !== "starting" && <p className="mt-1 text-xs text-white/60">Enter the code manually instead.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
