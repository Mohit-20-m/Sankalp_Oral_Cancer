import type { PhotoSite } from "@/types";

export const PHOTO_SITES: PhotoSite[] = [
  { id: "left_cheek", index: 1, labelKey: "site.left_cheek", instructionKey: "siteHint.left_cheek" },
  { id: "right_cheek", index: 2, labelKey: "site.right_cheek", instructionKey: "siteHint.right_cheek" },
  { id: "tongue_top", index: 3, labelKey: "site.tongue_top", instructionKey: "siteHint.tongue_top" },
  { id: "tongue_under", index: 4, labelKey: "site.tongue_under", instructionKey: "siteHint.tongue_under" },
  { id: "gums", index: 5, labelKey: "site.gums", instructionKey: "siteHint.gums" },
  { id: "palate", index: 6, labelKey: "site.palate", instructionKey: "siteHint.palate" },
  { id: "open_mouth", index: 7, labelKey: "site.open_mouth", instructionKey: "siteHint.open_mouth" },
];

/** Average human iris diameter, used as the scale reference for mouth opening. */
export const IRIS_DIAMETER_MM = 11.7;
/** Head tilt (degrees between iris points) above which we warn. */
export const TILT_WARN_DEGREES = 5;
/** QR phone-capture session lifetime. */
export const CAPTURE_SESSION_MINUTES = 15;
/** Provider Connect temporary access window. */
export const PROVIDER_ACCESS_HOURS = 24;
/** District dashboard hides any group smaller than this (privacy). */
export const MIN_GROUP_SIZE = 5;

/** Image-quality thresholds for the in-browser photo checks. */
/**
 * Photo quality gate — MUST match the server (services/app/domain/clinical.py → image_quality), so a photo that
 * passes here also passes there. Measured on the photo shrunk to 640 px, centre region (drop 1/6 at each edge).
 * "poor" = what the server rejects; "fair" = close to the limit (still accepted).
 * Blur cut-off 15 was calibrated on the model's held-out clinical benchmark (rejects ~3.5% of real photos;
 * the old 60 rejected 24%, and 31% of lesion photos, because mucosa and lesions are smooth).
 */
export const QUALITY = {
  sampleSize: 640,
  blurMin: 15, // Laplacian variance (centre region)
  blurFair: 30,
  brightMin: 45, // mean luma 0..255 (centre region)
  brightMax: 215,
  brightFairLow: 60,
  brightFairHigh: 200,
  glareMax: 0.06, // fraction of centre pixels >= 250
  glareFair: 0.03,
  tissueMin: 0.12, // fraction of reddish/pink pixels (OpenCV HSV: H<=12 or H>=160, S>=40, V>=60)
  tissueFair: 0.2,
};

export const SCREENING_STEPS = [
  { id: "patient", labelKey: "step.patient" },
  { id: "consent", labelKey: "step.consent" },
  { id: "habits", labelKey: "step.habits" },
  { id: "symptoms", labelKey: "step.symptoms" },
  { id: "photos", labelKey: "step.photos" },
  { id: "mouth", labelKey: "step.mouth" },
  { id: "review", labelKey: "step.review" },
] as const;
export type ScreeningStepId = (typeof SCREENING_STEPS)[number]["id"];

export const DISCLAIMER_KEY = "safety.disclaimer";
