import { Search, X } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
  value: string;
  onValueChange: (v: string) => void;
  size?: "md" | "lg";
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(({ value, onValueChange, className, size = "md", placeholder, ...p }, ref) => (
  <div className={cn("group relative", className)}>
    <Search className={cn("pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute transition-colors group-focus-within:text-primary", size === "lg" ? "size-5" : "size-[18px]")} aria-hidden />
    <input
      ref={ref}
      type="search"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn(
        "w-full rounded-full border border-line bg-surface pl-11 pr-10 text-ink placeholder:text-ink-mute transition-shadow focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10 [&::-webkit-search-cancel-button]:hidden",
        size === "lg" ? "h-14 text-base" : "h-11 text-sm",
      )}
      {...p}
    />
    {value && (
      <button type="button" aria-label="Clear search" onClick={() => onValueChange("")} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-mute hover:bg-ink/5">
        <X className="size-4" />
      </button>
    )}
  </div>
));
SearchBar.displayName = "SearchBar";
