import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Smartphone, Webcam, UploadCloud, Wand2 } from "lucide-react";
import { useDraft } from "../state";
import { PHOTO_SITES } from "@/config/constants";
import { PhotoCaptureCard } from "@/components/screening/PhotoCaptureCard";
import { WebcamCapture } from "@/components/screening/WebcamCapture";
import { UploadCapture } from "@/components/screening/UploadCapture";
import { PhoneCapture } from "@/components/screening/PhoneCapture";
import { Tabs, TabsList, TabsTrigger, Progress } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { isMockMode } from "@/services/api";
import { samplePhotoUrl } from "@/mocks/samplePhotos";
import type { CapturedPhoto } from "@/types";

type Method = "phone" | "webcam" | "upload";

export function PhotosStep() {
  const { draft, dispatch } = useDraft();
  const [method, setMethod] = useState<Method>("phone");
  const [active, setActive] = useState(0);
  const count = Object.values(draft.photos).filter((p) => p?.quality.acceptable).length;

  const save = useCallback(
    (p: CapturedPhoto) => {
      dispatch({ type: "photo", photo: p });
      // Advance to the next site still missing a photo.
      const next = PHOTO_SITES.findIndex((s) => s.id !== p.site && !draft.photos[s.id]);
      if (next >= 0) setActive(next);
    },
    [dispatch, draft.photos],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
          <TabsList>
            <TabsTrigger value="phone">
              <Smartphone /> Use my phone
            </TabsTrigger>
            <TabsTrigger value="webcam">
              <Webcam /> Webcam
            </TabsTrigger>
            <TabsTrigger value="upload">
              <UploadCloud /> Upload files
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-w-[220px] items-center gap-3">
          <Progress value={(count / 7) * 100} className="flex-1" />
          <span className="num text-sm font-bold">{count}/7</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={method} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {method === "phone" && <PhoneCapture onPhoto={save} captured={count} />}
          {method === "webcam" && <WebcamCapture site={PHOTO_SITES[active]} onSave={save} />}
          {method === "upload" && <UploadCapture site={PHOTO_SITES[active]} onSave={save} />}
        </motion.div>
      </AnimatePresence>

      <div className="mt-7 flex items-center justify-between">
        <p className="label-eyebrow">Seven guided sites</p>
        {isMockMode && count < 7 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              PHOTO_SITES.forEach((s, i) =>
                dispatch({
                  type: "photo",
                  photo: {
                    site: s.id,
                    dataUrl: samplePhotoUrl(s.id, i + 2),
                    capturedAt: new Date().toISOString(),
                    source: "upload",
                    quality: { blur: { score: 180, level: "good" }, lighting: { score: 130, level: "good" }, glare: { score: 0.4, level: "good" }, overall: "good", acceptable: true },
                  },
                }),
              )
            }
          >
            <Wand2 /> Fill with sample images (demo)
          </Button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {PHOTO_SITES.map((s, i) => (
          <PhotoCaptureCard key={s.id} site={s} photo={draft.photos[s.id]} active={method !== "phone" && i === active} onSelect={() => setActive(i)} />
        ))}
      </div>
    </div>
  );
}
