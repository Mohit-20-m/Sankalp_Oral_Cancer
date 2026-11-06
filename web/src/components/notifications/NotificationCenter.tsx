import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { useAsync } from "@/hooks";
import { services } from "@/services";
import { NotificationItem } from "./NotificationItem";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { branding } from "@/config/branding";

export function NotificationCenter() {
  const { data, loading, setData } = useAsync(() => services.notifications.list(), []);
  const [open, setOpen] = useState(false);
  const unread = data?.filter((n) => !n.read).length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative grid size-11 place-items-center rounded-full bg-primary-deep text-white shadow-soft transition hover:scale-[1.03]" aria-label={`Notifications, ${unread} unread`}>
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-primary-deep ring-2 ring-bg">{unread}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px]">
        <div className="flex items-center justify-between px-3 pb-2 pt-2">
          <div>
            <p className="font-display text-base font-bold">Notifications</p>
            <p className="text-xs text-ink-mute">{branding.appName} updates</p>
          </div>
          {unread > 0 && (
            <button
              className="text-xs font-semibold text-primary hover:underline"
              onClick={async () => {
                await services.notifications.markAllRead();
                if (data) setData(data.map((n) => ({ ...n, read: true })));
              }}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="scroll-thin max-h-[420px] space-y-1 overflow-y-auto px-1">
          {loading ? <div className="p-3"><LoadingSkeleton rows={3} /></div> : data?.slice(0, 5).map((n) => <NotificationItem key={n.id} n={n} compact />)}
        </div>
        <Link to="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-2xl py-2.5 text-center text-sm font-semibold text-primary hover:bg-secondary/50">
          See all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
