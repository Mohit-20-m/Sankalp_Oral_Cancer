import { useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, Flame } from "lucide-react";
import { Slider, Switch } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

export interface HeatSpot {
  x: number;
  y: number;
  r: number;
  w: number;
}

/**
 * Clinical photo viewer: wheel / button zoom (1–5×), drag to pan, and a
 * model-attention heatmap overlay with toggle + opacity control.
 */
export function PhotoViewer({ src, alt, heat = [], heatmapUrl }: { src: string; alt: string; heat?: HeatSpot[]; heatmapUrl?: string | null }) {
  const [scale, setScale] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [showHeat, setShowHeat] = useState(true);
  const [opacity, setOpacity] = useState(55);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const zoom = (d: number) =>
    setScale((s) => {
      const n = Math.min(5, Math.max(1, Number((s + d).toFixed(2))));
      if (n === 1) setOff({ x: 0, y: 0 });
      return n;
    });

  return (
    <div>
      <div
        className={cn("relative aspect-[4/3] overflow-hidden rounded-4xl bg-primary-deep", scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onWheel={(e) => zoom(e.deltaY < 0 ? 0.25 : -0.25)}
        onPointerDown={(e) => {
          if (scale === 1) return zoom(1);
          drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label={alt}
      >
        <div className="absolute inset-0 transition-transform duration-150 ease-out will-change-transform" style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${scale})` }}>
          <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
          {/* model heat map rendered by the backend (already aligned to the original photo) */}
          {showHeat && heatmapUrl && (
            <img src={heatmapUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={{ opacity: opacity / 100 }} draggable={false} />
          )}
          {showHeat &&
            heat.map((h, i) => (
              <div
                key={i}
                className="pointer-events-none absolute rounded-full mix-blend-multiply"
                style={{
                  left: `${(h.x - h.r) * 100}%`,
                  top: `${(h.y - h.r) * 100}%`,
                  width: `${h.r * 200}%`,
                  height: `${h.r * 266}%`,
                  opacity: opacity / 100,
                  background: `radial-gradient(closest-side, rgba(220,38,38,${0.55 + h.w * 0.45}), rgba(245,158,11,0.55) 55%, rgba(250,204,21,0.25) 75%, transparent)`,
                }}
              />
            ))}
        </div>
        <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full bg-black/45 p-1 text-white backdrop-blur">
          <button onClick={(e) => { e.stopPropagation(); zoom(-0.5); }} onPointerDown={(e) => e.stopPropagation()} className="grid size-9 place-items-center rounded-full hover:bg-white/15" aria-label="Zoom out"><ZoomOut className="size-4" /></button>
          <span className="num w-11 text-center text-xs font-bold">{scale.toFixed(1)}×</span>
          <button onClick={(e) => { e.stopPropagation(); zoom(0.5); }} onPointerDown={(e) => e.stopPropagation()} className="grid size-9 place-items-center rounded-full hover:bg-white/15" aria-label="Zoom in"><ZoomIn className="size-4" /></button>
          <button onClick={(e) => { e.stopPropagation(); setScale(1); setOff({ x: 0, y: 0 }); }} onPointerDown={(e) => e.stopPropagation()} className="grid size-9 place-items-center rounded-full hover:bg-white/15" aria-label="Reset zoom"><Maximize2 className="size-4" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-3xl bg-surface px-5 py-3 shadow-soft">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <Flame className="size-4 text-[#C2412D]" /> AI heatmap
          <Switch checked={showHeat} onCheckedChange={setShowHeat} aria-label="Toggle heatmap" />
        </label>
        <div className={cn("flex min-w-[220px] flex-1 items-center gap-3 transition-opacity", !showHeat && "pointer-events-none opacity-40")}>
          <span className="text-xs font-semibold text-ink-mute">Opacity</span>
          <Slider value={[opacity]} onValueChange={(v) => setOpacity(v[0])} min={10} max={100} step={5} aria-label="Heatmap opacity" />
          <span className="num w-10 text-right text-xs font-bold">{opacity}%</span>
        </div>
        {heat.length === 0 && !heatmapUrl && <span className="text-xs text-ink-mute">No attention regions for this site</span>}
      </div>
    </div>
  );
}
