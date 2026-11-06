import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Pointer-based signature pad (mouse, pen, touch). Emits a PNG data URL. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | undefined) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16352A";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl bg-surface shadow-inset dot-grid">
        <canvas
          ref={ref}
          className="h-44 w-full touch-none cursor-crosshair"
          aria-label="Signature area — draw with mouse, pen or finger"
          onPointerDown={(e) => {
            drawing.current = true;
            ref.current!.setPointerCapture(e.pointerId);
            const ctx = ref.current!.getContext("2d")!;
            const p = pos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = ref.current!.getContext("2d")!;
            const p = pos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            drawing.current = false;
            setEmpty(false);
            onChange(ref.current!.toDataURL("image/png"));
          }}
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-dashed border-ink/20" />
        {empty && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-mute">Patient signs here</p>}
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const c = ref.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            onChange(undefined);
          }}
        >
          <Eraser /> Clear
        </Button>
      </div>
    </div>
  );
}
