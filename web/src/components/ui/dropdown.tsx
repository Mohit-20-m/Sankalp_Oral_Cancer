import * as DM from "@radix-ui/react-dropdown-menu";
import { cn } from "@/utils/cn";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuSeparator = ({ className }: { className?: string }) => <DM.Separator className={cn("my-1.5 h-px bg-line", className)} />;
export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">{children}</DM.Label>;

export function DropdownMenuContent({ className, ...p }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={10}
        align="end"
        className={cn(
          "z-50 min-w-[220px] rounded-3xl bg-surface p-2 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...p}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, ...p }: DM.DropdownMenuItemProps) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-secondary/70 [&_svg]:size-4 [&_svg]:text-ink-soft",
        className,
      )}
      {...p}
    />
  );
}
