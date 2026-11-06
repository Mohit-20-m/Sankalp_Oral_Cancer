import { cn } from "@/utils/cn";

const TINTS = ["bg-mint text-primary-deep", "bg-butter text-[#5A4500]", "bg-blush text-[#6B2A1E]", "bg-sky text-[#1F4560]", "bg-lilac text-[#3D2F80]", "bg-sand text-[#4A4030]"];

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function PatientAvatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const tint = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-2xl font-display font-bold", tint, className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
