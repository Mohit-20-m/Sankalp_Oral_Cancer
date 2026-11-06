import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { NotificationItem, NOTIFICATION_KINDS } from "@/components/notifications/NotificationItem";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { StateView } from "@/components/common/StateView";
import { Button } from "@/components/ui/button";
import type { NotificationKind } from "@/types";
import { cn } from "@/utils/cn";

export default function Notifications() {
  const { data, loading, setData } = useAsync(() => services.notifications.list(), []);
  const [kind, setKind] = useState<NotificationKind | "all">("all");
  const rows = (data ?? []).filter((n) => kind === "all" || n.kind === kind);
  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Specialist reviews, referral updates, follow-up reminders and system notices."
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              await services.notifications.markAllRead();
              if (data) setData(data.map((n) => ({ ...n, read: true })));
            }}
          >
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {(["all", ...Object.keys(NOTIFICATION_KINDS)] as (NotificationKind | "all")[]).map((k) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("h-10 rounded-full px-4 text-sm font-semibold", kind === k ? "bg-primary-deep text-white" : "bg-surface text-ink-soft shadow-soft")}>
            {k === "all" ? "All" : NOTIFICATION_KINDS[k].label}
          </button>
        ))}
      </div>
      <div className="card max-w-3xl p-3">
        {loading ? (
          <div className="p-3"><LoadingSkeleton rows={5} /></div>
        ) : rows.length === 0 ? (
          <StateView state="empty" title="You're all caught up" body="New updates will appear here." />
        ) : (
          <Stagger className="space-y-1">
            {rows.map((n) => (
              <StaggerItem key={n.id}>
                <NotificationItem n={n} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </Page>
  );
}
