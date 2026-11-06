import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { UploadCloud, Loader2, XCircle } from "lucide-react";
import type { CapturedPhoto, PhotoSite } from "@/types";
import { analyseDataUrl, compressFile } from "@/utils/imageQuality";
import { useI18n } from "@/i18n";
import { AnatomyIllustration } from "./AnatomyIllustration";
import { QualityMeter } from "./QualityMeter";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";

/** Upload a file for the active site; poor-quality images are rejected with reasons. */
export function UploadCapture({ site, onSave }: { site: PhotoSite; onSave: (p: CapturedPhoto) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<CapturedPhoto | null>(null);
  const [drag, setDrag] = useState(false);

  async function handle(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    setBusy(true);
    setRejected(null);
    try {
      const url = await compressFile(file);
      const q = await analyseDataUrl(url);
      const photo: CapturedPhoto = { site: site.id, dataUrl: url, quality: q, capturedAt: new Date().toISOString(), source: "upload" };
      if (q.acceptable) {
        soundManager.play("upload");
        onSave(photo);
      } else {
        soundManager.play("error");
        setRejected(photo);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_1fr]">
      <div className="rounded-4xl bg-mint/70 p-5">
        <p className="label-eyebrow">Photo {site.index} of 7</p>
        <h3 className="mt-1 text-xl font-bold">{t(site.labelKey)}</h3>
        <div className="mt-4 rounded-3xl bg-white/80 p-3">
          <AnatomyIllustration site={site.id} />
        </div>
        <p className="mt-4 text-sm leading-relaxed">{t(site.instructionKey)}</p>
      </div>
      <div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void handle(e.dataTransfer.files[0]);
          }}
          className={cn(
            "flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-4xl border-2 border-dashed transition-colors",
            drag ? "border-primary bg-mint" : "border-ink/15 bg-surface hover:border-primary/50 hover:bg-secondary/30",
          )}
        >
          {busy ? <Loader2 className="size-10 animate-spin text-primary" /> : <UploadCloud className="size-10 text-primary" strokeWidth={1.6} />}
          <span className="text-base font-semibold">{busy ? "Checking quality…" : `Drop the ${t(site.labelKey).toLowerCase()} photo here`}</span>
          <span className="text-sm text-ink-mute">or click to browse · JPG / PNG · compressed automatically</span>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void handle(e.target.files?.[0])} />
        {rejected && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex gap-4 rounded-3xl bg-blush/70 p-4" role="alert">
            <img src={rejected.dataUrl} alt="" className="size-20 rounded-2xl object-cover" />
            <div className="flex-1">
              <p className="flex items-center gap-2 font-semibold text-[#7A2418]">
                <XCircle className="size-[18px]" /> Not saved — quality too low
              </p>
              <div className="mt-2">
                <QualityMeter report={rejected.quality} />
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
