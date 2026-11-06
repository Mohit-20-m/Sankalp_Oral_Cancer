import { Page, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { StateView, STATE_PRESETS, type AppState } from "@/components/common/StateView";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { Button } from "@/components/ui/button";

/** Reference gallery of every designed system state (Section 10 of the brief). */
export default function States() {
  const states = Object.keys(STATE_PRESETS) as AppState[];
  return (
    <Page>
      <PageHeader eyebrow="Design system" title="System states" description="Every loading, empty, offline and error state the app can show — all from one component (components/common/StateView.tsx)." />
      <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StaggerItem className="card p-6">
          <p className="label-eyebrow mb-4">initialLoading</p>
          <LoadingSkeleton rows={4} />
        </StaggerItem>
        {states.map((s) => (
          <StaggerItem key={s} className="card relative p-2">
            <p className="label-eyebrow absolute left-6 top-5">{s}</p>
            <StateView state={s} compact action={["uploadFailed", "apiUnavailable", "aiFailed"].includes(s) ? <Button size="sm" variant="secondary">Retry</Button> : undefined} />
          </StaggerItem>
        ))}
      </Stagger>
    </Page>
  );
}
