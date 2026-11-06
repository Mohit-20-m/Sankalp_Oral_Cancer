import { QUALITY } from "@/config/constants";
import type { QualityLevel, QualityReport } from "@/types";

/** OpenCV-style HSV (H 0..180, S/V 0..255) — same convention as the server's cv2.COLOR_RGB2HSV. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = (60 * (g - b)) / d;
    else if (max === g) h = 120 + (60 * (b - r)) / d;
    else h = 240 + (60 * (r - g)) / d;
    if (h < 0) h += 360;
  }
  return [h / 2, max === 0 ? 0 : (255 * d) / max, max];
}

/**
 * In-browser photo quality checks — the SAME algorithm and thresholds as the server
 * (services/app/domain/clinical.py → image_quality), so a photo accepted here is accepted there:
 *  • Sharpness — variance of the 4-neighbour Laplacian on the centre region of the 640 px greyscale image.
 *  • Lighting  — mean luminance of the centre region.
 *  • Glare     — fraction of centre pixels >= 250.
 *  • Mouth     — fraction of reddish/pink (mouth-tissue) pixels in the whole image.
 * Thresholds live in src/config/constants.ts → QUALITY.
 */
export function analyseImageData(img: ImageData): QualityReport {
  const { data, width, height } = img;
  const gray = new Float32Array(width * height);
  let tissue = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const [h, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
    if ((h <= 12 || h >= 160) && s >= 40 && v >= 60) tissue++;
  }
  const tissueFrac = tissue / gray.length;

  // centre region, exactly like the server: rows ch//6 .. ch-ch//6, cols cw//6 .. cw-cw//6
  const y0 = Math.floor(height / 6), y1 = height - Math.floor(height / 6);
  const x0 = Math.floor(width / 6), x1 = width - Math.floor(width / 6);
  let sum = 0, clipped = 0, cnt = 0, lapSum = 0, lapSq = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      sum += gray[i];
      if (gray[i] >= 250) clipped++;
      cnt++;
      if (y > y0 && y < y1 - 1 && x > x0 && x < x1 - 1) {
        const l = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        lapSum += l;
        lapSq += l * l;
        n++;
      }
    }
  }
  const mean = sum / Math.max(cnt, 1);
  const lapMean = lapSum / Math.max(n, 1);
  const variance = lapSq / Math.max(n, 1) - lapMean * lapMean;
  const glareFrac = clipped / Math.max(cnt, 1);

  const Q = QUALITY;
  const blurLevel: QualityLevel = variance < Q.blurMin ? "poor" : variance < Q.blurFair ? "fair" : "good";
  const lightLevel: QualityLevel =
    mean < Q.brightMin || mean > Q.brightMax ? "poor" : mean < Q.brightFairLow || mean > Q.brightFairHigh ? "fair" : "good";
  const glareLevel: QualityLevel = glareFrac > Q.glareMax ? "poor" : glareFrac > Q.glareFair ? "fair" : "good";
  const tissueLevel: QualityLevel = tissueFrac < Q.tissueMin ? "poor" : tissueFrac < Q.tissueFair ? "fair" : "good";

  const levels = [blurLevel, lightLevel, glareLevel, tissueLevel];
  const overall: QualityLevel = levels.includes("poor") ? "poor" : levels.includes("fair") ? "fair" : "good";

  return {
    blur: { score: Math.round(variance), level: blurLevel },
    lighting: { score: Math.round(mean), level: lightLevel },
    glare: { score: Number((glareFrac * 100).toFixed(1)), level: glareLevel },
    tissue: { score: Number((tissueFrac * 100).toFixed(0)), level: tissueLevel },
    overall,
    acceptable: overall !== "poor",
  };
}

function sampleCanvas(source: CanvasImageSource, sw: number, sh: number, target: number = QUALITY.sampleSize) {
  // like the server's PIL thumbnail(640): only ever shrink
  const scale = Math.min(1, target / Math.max(sw, sh));
  const w = Math.max(32, Math.round(sw * scale));
  const h = Math.max(32, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function analyseVideoFrame(video: HTMLVideoElement): QualityReport | null {
  if (!video.videoWidth) return null;
  return analyseImageData(sampleCanvas(video, video.videoWidth, video.videoHeight));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function analyseDataUrl(src: string): Promise<QualityReport> {
  const img = await loadImage(src);
  return analyseImageData(sampleCanvas(img, img.naturalWidth, img.naturalHeight));
}

/** Downscale + JPEG-compress before keeping a photo in memory or uploading. */
export function compressSource(source: CanvasImageSource, sw: number, sh: number, maxEdge = 1600, quality = 0.86): string {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export async function compressFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return compressSource(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
