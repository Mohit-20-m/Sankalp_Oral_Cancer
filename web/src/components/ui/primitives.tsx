import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/utils/cn";
import { soundManager } from "@/utils/soundManager";

/* ── Input ─────────────────────────────────────────── */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-ink-mute transition-shadow focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50",
      className,
    )}
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[96px] w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-mute focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10",
      className,
    )}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink-soft", className)} {...p} />;
}

export function Select({ className, children, ...p }: InputHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-12 w-full appearance-none rounded-2xl border border-line bg-surface pl-4 pr-10 text-[15px] text-ink focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10",
          className,
        )}
        {...(p as React.SelectHTMLAttributes<HTMLSelectElement>)}
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

/* ── Switch ────────────────────────────────────────── */
export function Switch({ className, onCheckedChange, ...p }: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-ink/15",
        className,
      )}
      onCheckedChange={(v) => {
        soundManager.play("click");
        onCheckedChange?.(v);
      }}
      {...p}
    >
      <SwitchPrimitive.Thumb className="block size-6 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

/* ── Slider ────────────────────────────────────────── */
export function Slider({ className, ...p }: SliderPrimitive.SliderProps) {
  return (
    <SliderPrimitive.Root className={cn("relative flex h-6 w-full touch-none select-none items-center", className)} {...p}>
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-ink/10">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {(p.value ?? p.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className="block size-5 rounded-full border-2 border-primary bg-white shadow transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-primary/20"
          aria-label={p["aria-label"]}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/* ── Tooltip ───────────────────────────────────────── */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = "right" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-xl bg-primary-deep px-3 py-1.5 text-xs font-medium text-white shadow-lift data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ── Tabs (pill style) ─────────────────────────────── */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-1 rounded-full bg-ink/5 p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      onClick={() => soundManager.play("click")}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-ink-soft transition-colors hover:text-ink data-[state=active]:bg-primary-deep data-[state=active]:text-white [&_svg]:size-4",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/* ── Popover ───────────────────────────────────────── */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, ...p }: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={10}
        align="end"
        className={cn(
          "z-50 rounded-3xl bg-surface p-2 shadow-lift outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...p}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ── Badge ─────────────────────────────────────────── */
export function Badge({ className, ...p }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold [&_svg]:size-3.5", className)} {...p} />;
}

/* ── Skeleton ──────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-ink/[0.06]", className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

/* ── Progress bar ──────────────────────────────────── */
export function Progress({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-ink/10", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500 ease-out", barClassName)} style={{ width: `${value}%` }} />
    </div>
  );
}
