import { branding } from "@/config/branding";
import { cn } from "@/utils/cn";

/**
 * Brand mark + name. Reads everything from branding.ts.
 * The logo artwork has a transparent background, so it sits directly on light surfaces; on dark surfaces
 * (sidebar, login hero) the mark is placed on a light tile so its dark-green strokes stay visible.
 */
export function LogoMark({ size = 36, className, onDark }: { size?: number; className?: string; onDark?: boolean }) {
  if (branding.useImageLogo) {
    const img = <img src={branding.logoMark} width={size} height={size} alt="" draggable={false} />;
    return onDark ? (
      <span className={cn("grid shrink-0 place-items-center rounded-[28%] bg-bg", className)} style={{ width: size, height: size, padding: size * 0.1 }}>
        <img src={branding.logoMark} alt="" draggable={false} className="size-full" />
      </span>
    ) : (
      <span className={cn("inline-block shrink-0", className)}>{img}</span>
    );
  }
  const c = branding.colors;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="14" fill={onDark ? c.primary : c.primaryDeep} />
      <path d="M9 15v-3a3 3 0 0 1 3-3h3M33 9h3a3 3 0 0 1 3 3v3M39 33v3a3 3 0 0 1-3 3h-3M15 39h-3a3 3 0 0 1-3-3v-3" stroke="#8FB09A" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M15 25.5c3.6 6.4 14.4 6.4 18 0" stroke={c.accent} strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="24" cy="17" r="4" fill={c.accent} />
    </svg>
  );
}

/** Full artwork (mark + name + tagline) for light surfaces such as the login form. */
export function LogoFull({ className }: { className?: string }) {
  return <img src={branding.logo} alt={`${branding.appName} - ${branding.tagline}`} draggable={false} className={cn("h-auto w-full max-w-[360px]", className)} />;
}

export function Logo({ tone = "dark", collapsed = false, className }: { tone?: "dark" | "light"; collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark size={collapsed ? 40 : 38} onDark={tone === "light"} />
      {!collapsed && (
        <span className={cn("font-display text-[21px] font-bold leading-none tracking-tight", tone === "light" ? "text-white" : "text-primary-deep")}>{branding.appName}</span>
      )}
    </div>
  );
}
