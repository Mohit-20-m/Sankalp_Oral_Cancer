import { IRIS_DIAMETER_MM, TILT_WARN_DEGREES } from "@/config/constants";

export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Mouth opening (inter-incisal / inter-lip distance) using the iris as a scale.
 * irisLeft / irisRight are the two horizontal edges of ONE iris;
 * lipTop / lipBottom are the inner edges of the upper and lower lip.
 * Points are in image pixel coordinates.
 */
export function mouthOpeningMm(irisLeft: Pt, irisRight: Pt, lipTop: Pt, lipBottom: Pt): number {
  const irisPx = dist(irisLeft, irisRight);
  if (irisPx < 1) return 0;
  const mmPerPx = IRIS_DIAMETER_MM / irisPx;
  return Number((dist(lipTop, lipBottom) * mmPerPx).toFixed(1));
}

/** Angle of the iris edge line from horizontal — a proxy for head roll. */
export function tiltDegrees(irisLeft: Pt, irisRight: Pt): number {
  return Math.abs((Math.atan2(irisRight.y - irisLeft.y, irisRight.x - irisLeft.x) * 180) / Math.PI);
}

export function isTilted(irisLeft: Pt, irisRight: Pt): boolean {
  const deg = tiltDegrees(irisLeft, irisRight);
  return Math.min(deg, 180 - deg) > TILT_WARN_DEGREES;
}

/**
 * Mouth opening from marked points: the iris (≈11.7 mm) is the ruler. With two irises their mean width is used,
 * which is steadier than one. Returns the raw pixel reading (for the server to recompute) and the mm value.
 */
export function measureFromPoints(irises: [Pt, Pt][], lips: [Pt, Pt]) {
  const widths = irises.map(([a, b]) => dist(a, b)).filter((w) => w > 1);
  if (!widths.length) return null;
  const irisPx = widths.reduce((s, w) => s + w, 0) / widths.length;
  const tapPx = dist(lips[0], lips[1]);
  const mm = Number(((IRIS_DIAMETER_MM / irisPx) * tapPx).toFixed(1));
  const irisMismatch = widths.length === 2 ? Math.abs(widths[0] - widths[1]) / Math.max(...widths) : 0;
  return { irisPx: Number(irisPx.toFixed(2)), tapPx: Number(tapPx.toFixed(2)), mm, irisMismatch };
}

/** Head roll from the line joining the two iris centres (degrees from horizontal). */
export function rollFromIrises(irises: [Pt, Pt][]): number | null {
  if (irises.length < 2) return null;
  const c = irises.map(([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  const deg = tiltDegrees(c[0], c[1]);
  return Math.min(deg, 180 - deg);
}

export function average(nums: number[]) {
  return nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)) : 0;
}
