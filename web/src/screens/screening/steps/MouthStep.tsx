import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Camera, CheckCircle2, Crosshair, Hand, Loader2, Move, RotateCcw, Ruler, ScanFace, Undo2 } from "lucide-react";
import { useDraft } from "../state";
import { measureFromPoints, rollFromIrises, tiltDegrees, type Pt } from "@/utils/measurement";
import { detectMouthPoints } from "@/utils/faceLandmarks";
import { loadImage } from "@/utils/imageQuality";
import { Button } from "@/components/ui/button";
import { IRIS_DIAMETER_MM, TILT_WARN_DEGREES } from "@/config/constants";
import { StateView } from "@/components/common/StateView";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";
import type { MouthPoints } from "@/types";

/** Same limit as the server (rule set mouth_opening.max_head_angle_deg). */
const MAX_POSE_DEG = 12;
const MANUAL_STEPS = ["Left edge of one iris", "Right edge of the same iris", "Inner edge of the upper lip", "Inner edge of the lower lip"];
const IRIS_COLOR = "#D6EC8C";
const LIP_COLOR = "#F4E6AE";

type Phase = "detecting" | "ready" | "manual" | "failed";
type Handle = { kind: "iris"; i: number; j: 0 | 1 } | { kind: "lip"; j: 0 | 1 };

export function MouthStep({ goToPhotos }: { goToPhotos: () => void }) {
  const { draft, dispatch } = useDraft();
  const photo = draft.photos.open_mouth;
  const saved = draft.mouth.points && draft.mouth.photoAt === photo?.capturedAt ? draft.mouth : undefined;
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints] = useState<MouthPoints | null>(saved?.points ?? null);
  const [method, setMethod] = useState<"auto" | "manual">(saved?.method ?? "auto");
  const [pose, setPose] = useState(saved?.headPose ?? null);
  const [phase, setPhase] = useState<Phase>(saved ? "ready" : "detecting");
  const [taps, setTaps] = useState<Pt[]>([]);
  const [drag, setDrag] = useState<Handle | null>(null);
  const [runId, setRunId] = useState(0);
  const confirmed = draft.mouth.finalMm !== undefined && !!saved;

  // automatic detection when the step opens (or the open-mouth photo changed, or "Detect again")
  useEffect(() => {
    if (!photo || (saved && runId === 0)) return;
    // a measurement that belongs to an earlier photo 7 (or an old-style one without points) is no longer valid
    if (draft.mouth.finalMm !== undefined && !saved) dispatch({ type: "mouth", mouth: { finalMm: undefined, attemptsMm: [] } });
    let cancelled = false;
    setPhase("detecting");
    (async () => {
      try {
        const det = await detectMouthPoints(await loadImage(photo.dataUrl));
        if (cancelled) return;
        if (det?.points.lips) {
          setPoints(det.points);
          setPose(det.headPose);
          setMethod("auto");
          setPhase("ready");
          soundManager.play("success");
        } else {
          setPhase("failed");
        }
      } catch {
        if (!cancelled) setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.dataUrl, runId]);

  if (!photo)
    return (
      <StateView
        state="empty"
        title="Open-mouth photo needed"
        body="Capture photo 7 (open-mouth face) first — it's used to measure mouth opening."
        action={
          <Button onClick={goToPhotos}>
            <Camera /> Go to photos
          </Button>
        }
      />
    );

  // ── measurement (live) ──
  const m = points?.lips ? measureFromPoints(points.irises, points.lips) : null;
  const roll = points ? (points.irises.length >= 2 ? rollFromIrises(points.irises) : (() => { const d = tiltDegrees(points.irises[0][0], points.irises[0][1]); return Math.min(d, 180 - d); })()) : null;
  const poseBad = !!pose && (Math.abs(pose.yaw) > MAX_POSE_DEG || Math.abs(pose.pitch) > MAX_POSE_DEG);
  const tilted = (roll ?? 0) > TILT_WARN_DEGREES || poseBad;
  const implausible = !!m && (m.mm < 5 || m.mm > 80);
  const irisMismatch = !!m && m.irisMismatch > 0.2;

  function update(next: MouthPoints | null) {
    setPoints(next);
    if (draft.mouth.finalMm !== undefined) dispatch({ type: "mouth", mouth: { finalMm: undefined, attemptsMm: [] } });
  }

  function confirm() {
    if (!m || !points || implausible) return;
    dispatch({
      type: "mouth",
      mouth: {
        attemptsMm: [m.mm],
        finalMm: m.mm,
        tiltWarning: tilted,
        method,
        readings: [{ iris_px: m.irisPx, tap_px: m.tapPx }],
        headPose: { yaw: pose?.yaw ?? 0, pitch: pose?.pitch ?? 0, roll: pose?.roll ?? roll ?? 0 },
        points,
        photoAt: photo!.capturedAt,
      },
    });
    soundManager.play("complete");
  }

  // ── pointer handling: everything in photo pixels, mapped from the RENDERED photo (not its box) ──
  function toNatural(e: React.PointerEvent): Pt | null {
    const el = imgRef.current;
    if (!el || !nat) return null;
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const cy = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    return { x: cx * nat.w, y: cy * nat.h };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (phase !== "manual") return;
    const p = toNatural(e);
    if (!p) return;
    const t = [...taps, p];
    soundManager.play("click");
    if (t.length === 4) {
      setTaps([]);
      update({ irises: [[t[0], t[1]]], lips: [t[2], t[3]] });
      setPose(null);
      setMethod("manual");
      setPhase("ready");
      return;
    }
    setTaps(t);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || !points) return;
    const p = toNatural(e);
    if (!p) return;
    const next: MouthPoints = { irises: points.irises.map((x) => [...x] as [Pt, Pt]), lips: points.lips ? ([...points.lips] as [Pt, Pt]) : undefined };
    if (drag.kind === "iris") next.irises[drag.i][drag.j] = p;
    else if (next.lips) next.lips[drag.j] = p;
    if (method === "auto") setMethod("manual"); // adjusted by hand → record as manual
    update(next);
  }

  const handles: { h: Handle; p: Pt; color: string; label: string }[] = points
    ? [
        ...points.irises.flatMap((pair, i) =>
          pair.map((p, j) => ({ h: { kind: "iris", i, j: j as 0 | 1 } as Handle, p, color: IRIS_COLOR, label: `Iris ${i + 1} ${j ? "right" : "left"} edge` })),
        ),
        ...(points.lips ?? []).map((p, j) => ({ h: { kind: "lip", j: j as 0 | 1 } as Handle, p, color: LIP_COLOR, label: j ? "Inner edge of lower lip" : "Inner edge of upper lip" })),
      ]
    : [];
  const pct = (p: Pt) => ({ left: `${(p.x / (nat?.w || 1)) * 100}%`, top: `${(p.y / (nat?.h || 1)) * 100}%` });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
      <div>
        <div className="rounded-4xl bg-primary-deep p-3">
          <div
            className={cn("relative mx-auto w-fit max-w-full touch-none select-none", phase === "manual" && "cursor-crosshair")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <img
              ref={imgRef}
              src={photo.dataUrl}
              alt="Open-mouth face photo for measurement"
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="block h-auto max-h-[560px] w-auto max-w-full rounded-3xl"
              draggable={false}
            />
            {nat && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none" aria-hidden>
                {points?.irises.map(([a, b], i) => (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={IRIS_COLOR} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                ))}
                {points?.lips && (
                  <line x1={points.lips[0].x} y1={points.lips[0].y} x2={points.lips[1].x} y2={points.lips[1].y} stroke={LIP_COLOR} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                )}
                {taps.length >= 2 && <line x1={taps[0].x} y1={taps[0].y} x2={taps[1].x} y2={taps[1].y} stroke={IRIS_COLOR} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
              </svg>
            )}
            {/* draggable points — centred exactly on the spot (plain CSS transform, no animation overriding it) */}
            {phase === "ready" &&
              handles.map(({ h, p, color, label }) => (
                <button
                  key={`${h.kind}-${h.kind === "iris" ? h.i : 0}-${h.j}`}
                  type="button"
                  aria-label={`${label} — drag to adjust`}
                  title={`${label} — drag to adjust`}
                  className="absolute size-4 cursor-grab rounded-full border-2 border-primary-deep shadow-soft active:cursor-grabbing"
                  style={{ ...pct(p), backgroundColor: color, transform: "translate(-50%, -50%)" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag(h);
                  }}
                />
              ))}
            {phase === "manual" &&
              taps.map((p, i) => (
                <span
                  key={i}
                  className="pointer-events-none absolute grid size-6 place-items-center rounded-full border-2 border-primary-deep text-[10px] font-bold text-primary-deep"
                  style={{ ...pct(p), backgroundColor: i < 2 ? IRIS_COLOR : LIP_COLOR, transform: "translate(-50%, -50%)" }}
                >
                  {i + 1}
                </span>
              ))}
            {phase === "manual" && (
              <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold shadow-soft" aria-live="polite">
                <Crosshair className="size-4 text-primary" /> Tap {taps.length + 1}/4: {MANUAL_STEPS[taps.length]}
              </div>
            )}
            {phase === "detecting" && (
              <div className="absolute inset-0 grid place-items-center rounded-3xl bg-primary-deep/50">
                <span className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold shadow-soft" aria-live="polite">
                  <Loader2 className="size-4 animate-spin text-primary" /> Finding eyes and lips…
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {phase === "manual" ? (
            <Button variant="secondary" size="sm" disabled={!taps.length} onClick={() => setTaps(taps.slice(0, -1))}>
              <Undo2 /> Undo point
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTaps([]);
                update(null);
                setPhase("manual");
              }}
            >
              <Hand /> Mark by hand
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={phase === "detecting"} onClick={() => { setTaps([]); update(null); setRunId((n) => n + 1); }}>
            <ScanFace /> Detect automatically
          </Button>
          {phase === "ready" && (
            <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-ink-mute">
              <Move className="size-3.5" /> Drag any point to adjust it
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-4xl bg-primary-deep p-6 text-white">
          <p className="text-sm font-semibold text-white/60">Mouth opening</p>
          <p className="num mt-2 text-5xl font-bold">
            {m && !implausible ? m.mm : "—"}
            <span className="ml-1 text-xl text-white/60">mm</span>
          </p>
          <p className="mt-2 text-xs text-white/50">
            {phase === "detecting"
              ? "Detecting…"
              : phase === "manual"
                ? "Marking by hand"
                : m
                  ? `${method === "auto" ? "Found automatically" : "Marked / adjusted by hand"} · ${points?.irises.length === 2 ? "both irises" : "one iris"} as the ruler`
                  : "Not measured yet"}
          </p>
          <Button className="mt-5 w-full" variant={confirmed ? "secondary" : "accent"} disabled={!m || implausible || phase !== "ready" || confirmed} onClick={confirm}>
            {confirmed ? (
              <>
                <CheckCircle2 /> Measurement saved
              </>
            ) : (
              <>
                <CheckCircle2 /> Use this measurement
              </>
            )}
          </Button>
        </div>

        <AnimatePresence>
          {phase === "failed" && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-3 rounded-3xl bg-butter p-4 text-sm text-[#5A3B00]" role="alert">
              <AlertTriangle className="size-5 shrink-0" />
              <span>
                <b>Couldn't find the face automatically.</b> Make sure both eyes and the open mouth are visible and the face is straight-on, or{" "}
                <button className="font-bold underline" onClick={() => { setTaps([]); update(null); setPhase("manual"); }}>
                  mark the points by hand
                </button>
                .
              </span>
            </motion.div>
          )}
          {phase === "ready" && tilted && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-3 rounded-3xl bg-butter p-4 text-sm text-[#5A3B00]" role="alert">
              <AlertTriangle className="size-5 shrink-0" />
              <span>
                <b>Head is turned or tilted</b>
                {pose ? ` (turn ${Math.abs(pose.yaw).toFixed(0)}°, nod ${Math.abs(pose.pitch).toFixed(0)}°, tilt ${Math.abs(pose.roll).toFixed(0)}°)` : ""}. This distorts the measurement — if possible, retake photo 7 with the phone at eye level and the face straight on.
              </span>
            </motion.div>
          )}
          {phase === "ready" && irisMismatch && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 rounded-3xl bg-butter p-4 text-sm text-[#5A3B00]" role="alert">
              <AlertTriangle className="size-5 shrink-0" /> The two irises look different in size — check the green points sit on the iris edges.
            </motion.div>
          )}
          {phase === "ready" && implausible && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 rounded-3xl bg-blush p-4 text-sm text-[#7A2418]" role="alert">
              <AlertTriangle className="size-5 shrink-0" /> {m!.mm} mm isn't a realistic mouth opening — adjust the points or mark by hand.
            </motion.div>
          )}
        </AnimatePresence>

        <div className="rounded-3xl bg-surface p-5 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Ruler className="size-4 text-primary" /> How it works
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            The iris is about {IRIS_DIAMETER_MM} mm wide in adults, so it's used as a ruler. The eyes and inner lips are found automatically on this
            device (green = iris edges, yellow = inner lips). Check the points, drag any that are off, then save. The photo needs both eyes visible,
            the mouth opened as wide as possible and the tongue inside (a tongue over the lower lip hides its edge). Below 35 mm counts as
            restricted opening.
          </p>
          <button className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary" onClick={goToPhotos}>
            <RotateCcw className="size-3.5" /> Retake photo 7
          </button>
        </div>
      </div>
    </div>
  );
}
