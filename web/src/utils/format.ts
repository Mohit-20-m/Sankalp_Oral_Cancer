export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-IN", opts);
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function waitingDuration(iso: string): { label: string; hours: number } {
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours < 1) return { label: `${Math.max(1, Math.round(hours * 60))}m`, hours };
  if (hours < 48) return { label: `${Math.round(hours)}h`, hours };
  return { label: `${Math.round(hours / 24)}d`, hours };
}

export function maskPhone(p: string) {
  return p.length > 4 ? `${"•".repeat(p.length - 4)}${p.slice(-4)}` : p;
}

export function pct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function greetingKey(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "greet.morning" : h < 17 ? "greet.afternoon" : "greet.evening";
}

/** The ID people read and say aloud — the short display ID when the backend provides one. */
export const patientRef = (p: { id: string; displayId?: string }) => p.displayId ?? (p.id.length > 20 ? p.id.slice(0, 8).toUpperCase() : p.id);
