/* Shared chart styling so every Recharts chart looks like one family. */
export const CHART = {
  grid: "rgba(26,38,32,0.07)",
  tick: { fill: "rgba(26,38,32,0.55)", fontSize: 12, fontFamily: "Inter Variable, sans-serif" },
  series: { deep: "#16352A", primary: "#2F6B4F", lime: "#B9D65B", sage: "#8FB09A", amber: "#D99A1E", red: "#C2412D", violet: "#5340B5", sky: "#7FA6C2" },
};

interface TipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}

export function ChartTooltip({ active, payload, label, unit = "" }: { active?: boolean; payload?: TipPayload[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-primary-deep px-3.5 py-2.5 text-white shadow-lift">
      {label !== undefined && <p className="mb-1 text-xs font-semibold text-white/60">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-sm">
          <span className="size-2.5 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-white/75">{p.name}</span>
          <span className="num ml-auto pl-3 font-bold">
            {typeof p.value === "number" ? p.value.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : p.value}
            {unit}
          </span>
        </p>
      ))}
    </div>
  );
}
