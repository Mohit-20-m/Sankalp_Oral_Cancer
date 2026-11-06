import { motion } from "framer-motion";
import { Camera, Check } from "lucide-react";
import type { CapturedPhoto, PhotoSite } from "@/types";
import { useI18n } from "@/i18n";
import { AnatomyIllustration } from "./AnatomyIllustration";
import { QualityPill } from "./QualityMeter";
import { cn } from "@/utils/cn";

export function PhotoCaptureCard({ site, photo, active, onSelect }: { site: PhotoSite; photo?: CapturedPhoto; active?: boolean; onSelect?: () => void }) {
  const { t } = useI18n();
  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl text-left transition-all",
        active ? "bg-primary-deep text-white shadow-lift ring-4 ring-accent/70" : "bg-surface shadow-soft hover:-translate-y-0.5",
      )}
      aria-pressed={active}
      aria-label={`${site.index}. ${t(site.labelKey)} — ${photo ? "captured" : "not captured"}`}
    >
      <div className={cn("relative aspect-[4/3] overflow-hidden", !photo && (active ? "bg-white/5" : "bg-bg"))}>
        {photo ? (
          <motion.img initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} src={photo.dataUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center p-3 opacity-90">
            <AnatomyIllustration site={site.id} className="max-h-full" />
          </div>
        )}
        <span className={cn("absolute left-2.5 top-2.5 grid size-7 place-items-center rounded-full text-xs font-bold", photo ? "bg-accent text-primary-deep" : active ? "bg-white text-primary-deep" : "bg-primary-deep text-white")}>
          {photo ? <Check className="size-4" strokeWidth={3} /> : site.index}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        <span className="truncate text-[13px] font-semibold">{t(site.labelKey)}</span>
        {photo ? <QualityPill level={photo.quality.overall} /> : <Camera className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-mute")} />}
      </div>
    </motion.button>
  );
}
