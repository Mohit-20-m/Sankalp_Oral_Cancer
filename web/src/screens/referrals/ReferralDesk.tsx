import { useCallback, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QrCode, Keyboard, CalendarCheck, Footprints, CheckCircle2, Building2, CalendarDays, ArrowRight, CircleDot } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { services } from "@/services";
import { useAsync } from "@/hooks";
import { Page } from "@/components/common/motion";
import { PageHeader } from "@/components/common/misc";
import { QrScanner } from "@/components/common/QrScanner";
import { StateView } from "@/components/common/StateView";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { ConfirmationModal } from "@/components/modals/ConfirmationModal";
import { Tabs, TabsList, TabsTrigger, TabsContent, Input, Label } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Referral, ReferralStatus } from "@/types";
import { formatDate, formatDateTime } from "@/utils/format";
import { cn } from "@/utils/cn";

const FLOW: { s: ReferralStatus; label: string; action: string; icon: typeof CalendarCheck }[] = [
  { s: "issued", label: "Issued", action: "", icon: CircleDot },
  { s: "booked", label: "Booked", action: "Mark booked", icon: CalendarCheck },
  { s: "visited", label: "Visited", action: "Mark visited", icon: Footprints },
  { s: "completed", label: "Completed", action: "Mark completed", icon: CheckCircle2 },
];

export default function ReferralDesk() {
  const toast = useToast();
  const nav = useNavigate();
  const list = useAsync(() => services.referrals.list(), []);
  const [code, setCode] = useState("");
  const [ref, setRef] = useState<Referral | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "invalid">("idle");
  const [pending, setPending] = useState<ReferralStatus | null>(null);
  const [mode, setMode] = useState("scan");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("10:00");
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const lookup = useCallback(async (c: string) => {
    setState("loading");
    try {
      const r = await services.referrals.lookup(c.replace(/^REF:/, ""));
      setRef(r);
      setState("idle");
    } catch {
      setRef(null);
      setState("invalid");
    }
  }, []);

  // "overdue" is a display state: the real step is "booked" if an appointment exists, otherwise "issued"
  const current: ReferralStatus | null = ref ? (ref.status === "overdue" ? (ref.bookedFor ? "booked" : "issued") : ref.status) : null;
  const idx = current ? FLOW.findIndex((f) => f.s === current) : -1;
  const next = ref && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
  const openBooking = (s: ReferralStatus) => {
    if (s === "booked") {
      const b = ref?.bookedFor ? new Date(ref.bookedFor) : null;
      setApptDate(b ? new Date(b.getTime() - b.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "");
      setApptTime(b ? b.toTimeString().slice(0, 5) : "10:00");
    }
    setPending(s);
  };

  return (
    <Page>
      <PageHeader eyebrow="Dental college & PHC" title="Referral desk" description="Scan the patient's referral slip or type the code to open the case and update the visit status." />
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-4">
          <div className="card p-6">
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="scan" className="flex-1 justify-center">
                  <QrCode /> Scan QR
                </TabsTrigger>
                <TabsTrigger value="code" className="flex-1 justify-center">
                  <Keyboard /> Enter code
                </TabsTrigger>
              </TabsList>
              <TabsContent value="scan">
                <QrScanner active={mode === "scan" && !ref} onResult={(t) => void lookup(t)} />
              </TabsContent>
              <TabsContent value="code">
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void lookup(code);
                  }}
                  className="space-y-3"
                >
                  <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RF-XXXX-123" className="num h-14 text-center text-xl font-bold tracking-widest" aria-label="Referral code" />
                  <Button type="submit" size="lg" className="w-full" loading={state === "loading"} disabled={code.length < 6}>
                    Open referral <ArrowRight />
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-8">
          <AnimatePresence mode="wait">
            {state === "invalid" ? (
              <motion.div key="inv" className="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <StateView state="invalidQr" title="Referral not found" body="Check the code on the slip. Codes look like RF-7Q4-219." action={<Button variant="secondary" onClick={() => setState("idle")}>Try again</Button>} />
              </motion.div>
            ) : ref ? (
              <motion.div key={ref.code} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 bg-sky/60 p-6">
                  <PatientAvatar name={ref.patientName} size={56} />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-ink-mute">Referral {ref.code}</p>
                    <h2 className="text-2xl font-bold">{ref.patientName}</h2>
                    <p className="text-sm text-ink-soft">{ref.patientId}</p>
                  </div>
                  <RiskIndicator risk={ref.risk} size="lg" />
                </div>
                <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
                  <dl className="space-y-3">
                    <div className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                      <Building2 className="size-5 text-primary" />
                      <dt className="text-sm text-ink-mute">Facility</dt>
                      <dd className="ml-auto text-sm font-semibold">{ref.facility}</dd>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                      <CalendarDays className="size-5 text-primary" />
                      <dt className="text-sm text-ink-mute">Visit by</dt>
                      <dd className="ml-auto text-sm font-semibold">{formatDate(ref.visitBy)}</dd>
                    </div>
                    <div className={cn("flex items-center gap-3 rounded-2xl p-3", ref.bookedFor ? "bg-mint" : "bg-bg")}>
                      <CalendarCheck className="size-5 text-primary" />
                      <dt className="text-sm text-ink-mute">Appointment</dt>
                      <dd className="ml-auto text-sm font-semibold">{ref.bookedFor ? formatDateTime(ref.bookedFor) : "Not booked yet"}</dd>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                      <CalendarDays className="size-5 text-primary" />
                      <dt className="text-sm text-ink-mute">Issued</dt>
                      <dd className="ml-auto text-sm font-semibold">{formatDate(ref.issuedAt)}</dd>
                    </div>
                  </dl>
                  <div>
                    <p className="label-eyebrow mb-3">Status</p>
                    {ref.status === "overdue" && <StatusBadge status="overdue" className="mb-3" />}
                    <ol className="space-y-2">
                      {FLOW.map((f, i) => {
                        const I = f.icon;
                        const done = i <= idx;
                        return (
                          <li key={f.s} className={cn("flex items-center gap-3 rounded-2xl p-3 transition-colors", done ? "bg-mint" : "bg-bg")}>
                            <span className={cn("grid size-8 place-items-center rounded-full", done ? "bg-primary text-white" : "bg-ink/10 text-ink-mute")}>
                              <I className="size-4" />
                            </span>
                            <span className={cn("text-sm font-semibold", !done && "text-ink-mute")}>{f.label}</span>
                            {i === idx && <span className="ml-auto text-xs font-semibold text-primary">Current</span>}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-line p-5">
                  <Button variant="ghost" onClick={() => nav(`/patients/${ref.patientId}`)}>
                    Open patient case
                  </Button>
                  {current === "booked" && (
                    <Button variant="secondary" onClick={() => openBooking("booked")}>
                      <CalendarDays /> Reschedule
                    </Button>
                  )}
                  {next && (
                    <Button onClick={() => openBooking(next.s)}>
                      <next.icon /> {next.action}
                    </Button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" className="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <StateView state="empty" title="Scan or enter a referral" body="The patient's case and visit status will appear here." />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DashboardCard title="Recent referrals" subtitle="Click to open" className="col-span-12">
          {list.loading ? (
            <LoadingSkeleton rows={4} />
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {list.data?.slice(0, 9).map((r) => (
                <button key={r.code} onClick={() => setRef(r)} className="flex items-center gap-3 rounded-2xl bg-bg p-3 text-left transition hover:bg-secondary/50">
                  <PatientAvatar name={r.patientName} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.patientName}</span>
                    <span className="num block text-xs text-ink-mute">{r.code}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </button>
              ))}
            </div>
          )}
        </DashboardCard>
      </div>

      <ConfirmationModal
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending === "booked" ? (current === "booked" ? "Reschedule appointment" : "Book appointment") : `${FLOW.find((f) => f.s === pending)?.action}?`}
        description={
          pending === "booked"
            ? `Choose when ${ref?.patientName} will visit ${ref?.facility}. The patient gets an SMS with the date and time.`
            : `Update ${ref?.patientName}'s referral ${ref?.code}. The referring PHC will be notified.`
        }
        confirmLabel={pending === "booked" ? "Save appointment" : "Confirm"}
        confirmDisabled={pending === "booked" && (!apptDate || !apptTime)}
        onConfirm={async () => {
          if (!ref || !pending) return;
          try {
            const when = pending === "booked" ? new Date(`${apptDate}T${apptTime}`).toISOString() : undefined;
            const r = await services.referrals.setStatus(ref.code, pending, when);
            setRef(r);
            list.reload();
            toast({
              tone: "success",
              title: pending === "booked" ? "Appointment saved" : `Referral ${pending}`,
              body: pending === "booked" && r.bookedFor ? `${ref.patientName} · ${formatDateTime(r.bookedFor)} · SMS sent to the patient` : ref.patientName,
            });
            setPending(null);
          } catch (e) {
            toast({ tone: "error", title: "Could not update the referral", body: e instanceof Error ? e.message : "Please try again." });
          }
        }}
      >
        {pending === "booked" && (
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="appt-date">Date</Label>
              <Input id="appt-date" type="date" min={today} value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="appt-time">Time</Label>
              <Input id="appt-time" type="time" step={900} value={apptTime} onChange={(e) => setApptTime(e.target.value)} />
            </div>
            {ref?.visitBy && <p className="col-span-2 text-xs text-ink-mute">Referral should be seen by {formatDate(ref.visitBy)}.</p>}
          </div>
        )}
      </ConfirmationModal>
    </Page>
  );
}
