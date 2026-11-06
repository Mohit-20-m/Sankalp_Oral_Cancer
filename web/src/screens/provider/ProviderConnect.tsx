import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KeyRound, ShieldCheck, Timer, Pill, NotebookPen, History, Send, Plus, ImageOff, ArrowRight, Lock } from "lucide-react";
import { services, type ProviderSummary } from "@/services";
import { Logo } from "@/components/brand/Logo";
import { QrScanner } from "@/components/common/QrScanner";
import { RiskIndicator } from "@/components/common/RiskIndicator";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { StateView } from "@/components/common/StateView";
import { Disclaimer, DemoBadge } from "@/components/common/misc";
import { DashboardCard } from "@/components/cards/DashboardCard";
import { LanguageSelector } from "@/components/navigation/LanguageSelector";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useCountdown } from "@/hooks";
import { isMockMode } from "@/services/api";
import { formatDate } from "@/utils/format";
import { PROVIDER_ACCESS_HOURS } from "@/config/constants";
import { cn } from "@/utils/cn";

type Stage = "scan" | "details" | "otp" | "summary";

function Steps({ stage }: { stage: Stage }) {
  const s = ["scan", "details", "otp", "summary"].indexOf(stage);
  return (
    <div className="flex items-center gap-2">
      {["Patient QR", "Your details", "Patient OTP", "Summary"].map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", i <= s ? "bg-primary-deep text-accent" : "bg-ink/10 text-ink-mute")}>{i + 1}</span>
          <span className={cn("hidden text-sm font-semibold md:inline", i <= s ? "text-ink" : "text-ink-mute")}>{l}</span>
          {i < 3 && <span className="mx-1 h-px w-6 bg-ink/15" />}
        </div>
      ))}
    </div>
  );
}

export default function ProviderConnect() {
  const toast = useToast();
  const cardParam = new URLSearchParams(window.location.search).get("card") ?? "";
  const [stage, setStage] = useState<Stage>(cardParam ? "details" : "scan");
  const [qr, setQr] = useState(cardParam);
  const [doc, setDoc] = useState({ name: "", phone: "", reg: "" });
  const [req, setReq] = useState<{ requestId: string; maskedPhone: string; demoCode?: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<"qr" | "otp" | null>(null);
  const [sum, setSum] = useState<ProviderSummary | null>(null);
  const [note, setNote] = useState("");
  const [med, setMed] = useState({ name: "", dose: "" });
  const cd = useCountdown(sum?.accessExpiresAt);
  const hours = Math.floor(cd.ms / 3600000);
  const mins = Math.floor((cd.ms % 3600000) / 60000);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setReq(await services.provider.requestOtp({ qrToken: qr, doctorName: doc.name, phone: doc.phone, regNo: doc.reg }));
      setStage("otp");
    } catch {
      setErr("qr");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setSum(await services.provider.verifyOtp(req!.requestId, otp));
      setStage("summary");
    } catch {
      setErr("otp");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-4 px-6">
          <Logo />
          <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-primary-deep">Provider Connect</span>
          <DemoBadge />
          <div className="ml-auto flex items-center gap-3">
            {sum && (
              <span className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold", hours < 2 ? "bg-butter text-[#5A4500]" : "bg-surface shadow-soft")}>
                <Timer className="size-4" /> Access ends in {hours}h {mins}m
              </span>
            )}
            <LanguageSelector />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {stage !== "summary" && (
          <div className="mx-auto max-w-xl">
            <div className="mb-8 flex justify-center">
              <Steps stage={stage} />
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={stage + String(err)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="card p-8">
                {err === "qr" ? (
                  <StateView state="invalidQr" compact action={<Button variant="secondary" onClick={() => { setErr(null); setStage("scan"); setQr(""); }}>Scan again</Button>} />
                ) : stage === "scan" ? (
                  <>
                    <h1 className="text-2xl font-bold">Scan the patient's health card</h1>
                    <p className="mt-1 text-sm text-ink-soft">You'll get {PROVIDER_ACCESS_HOURS}-hour read access to this patient's summary after they confirm with an OTP. No login needed.</p>
                    <div className="mt-6">
                      <QrScanner
                        onResult={(t) => {
                          setQr(t);
                          setStage("details");
                        }}
                      />
                    </div>
                    <div className="mt-5 flex gap-2">
                      <Input value={qr} onChange={(e) => setQr(e.target.value)} placeholder="…or type the card code (e.g. PATIENT:PT-24107)" />
                      <Button disabled={qr.length < 4} onClick={() => setStage("details")}>
                        Next
                      </Button>
                    </div>
                  </>
                ) : stage === "details" ? (
                  <form onSubmit={requestOtp} className="space-y-4">
                    <h1 className="text-2xl font-bold">Your details</h1>
                    <p className="text-sm text-ink-soft">These are recorded in the patient's access log.</p>
                    <div>
                      <Label htmlFor="dn">Doctor's full name</Label>
                      <Input id="dn" value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="dp">Mobile</Label>
                        <Input id="dp" inputMode="tel" maxLength={10} value={doc.phone} onChange={(e) => setDoc({ ...doc, phone: e.target.value.replace(/\D/g, "") })} />
                      </div>
                      <div>
                        <Label htmlFor="dr">Registration no.</Label>
                        <Input id="dr" value={doc.reg} onChange={(e) => setDoc({ ...doc, reg: e.target.value.toUpperCase() })} placeholder="KMC 12345" />
                      </div>
                    </div>
                    <Button type="submit" size="lg" className="w-full" loading={busy} disabled={doc.name.length < 3 || doc.phone.length !== 10 || doc.reg.length < 4}>
                      Send OTP to patient <ArrowRight />
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={verify} className="space-y-5 text-center">
                    <span className="mx-auto grid size-14 place-items-center rounded-3xl bg-mint text-primary-deep">
                      <KeyRound className="size-7" />
                    </span>
                    <div>
                      <h1 className="text-2xl font-bold">Ask the patient for the code</h1>
                      <p className="mt-1 text-sm text-ink-soft">We sent a 6-digit code to the patient's phone {req?.maskedPhone}.</p>
                    </div>
                    <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="num mx-auto h-16 max-w-[260px] text-center text-3xl font-bold tracking-[0.5em]" aria-label="One-time code" aria-invalid={err === "otp"} />
                    {err === "otp" && <p className="text-sm font-semibold text-[#A3301F]" role="alert">That code didn't match. Check with the patient and try again.</p>}
                    {(isMockMode || req?.demoCode) && <p className="text-xs text-ink-mute">Demo (SMS sandbox) code: <b className="num">{req?.demoCode ?? "123456"}</b></p>}
                    <Button type="submit" size="lg" className="w-full" loading={busy} disabled={otp.length !== 6}>
                      <ShieldCheck /> Verify & open summary
                    </Button>
                  </form>
                )}
              </motion.div>
            </AnimatePresence>
            <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-mute">
              <Lock className="size-3.5" /> Patient photographs are never shared through Provider Connect.
            </p>
          </div>
        )}

        {stage === "summary" && sum && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-12 gap-5">
            <section className="col-span-12 flex flex-wrap items-center gap-5 rounded-4xl bg-mint p-7">
              <PatientAvatar name={sum.patient.name} size={72} className="bg-white" />
              <div className="flex-1">
                <h1 className="text-3xl font-bold">{sum.patient.name}</h1>
                <p className="text-sm text-ink-soft">
                  {sum.patient.id} · {sum.patient.age} y · <span className="capitalize">{sum.patient.sex}</span> · {sum.patient.village}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <RiskIndicator risk={sum.risk} size="lg" />
                <StatusBadge status={sum.reviewed ? "reviewed" : "preliminary"} />
              </div>
              <Disclaimer className="w-full bg-white/60" />
            </section>

            <DashboardCard title="Referral" className="col-span-12 lg:col-span-4">
              {sum.referral ? (
                <div className="space-y-2 text-sm">
                  <p className="num text-xl font-bold">{sum.referral.code}</p>
                  <p>{sum.referral.facility}</p>
                  <p className="text-ink-mute">Visit by {formatDate(sum.referral.visitBy)}</p>
                  <StatusBadge status={sum.referral.status} />
                </div>
              ) : (
                <p className="text-sm text-ink-mute">No active referral.</p>
              )}
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-sand/60 p-3 text-xs text-ink-soft">
                <ImageOff className="size-4 shrink-0" /> Photos are restricted to the specialist team.
              </div>
            </DashboardCard>

            <DashboardCard title="Medicines" className="col-span-12 lg:col-span-4">
              <ul className="space-y-2">
                {sum.medicines.map((m, i) => (
                  <li key={i} className="flex gap-3 rounded-2xl bg-bg p-3">
                    <Pill className="mt-0.5 size-4 text-primary" />
                    <div className="text-sm">
                      <p className="font-semibold">{m.name}</p>
                      <p className="text-xs text-ink-mute">
                        {m.dose} · {m.addedBy} · {formatDate(m.since)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await services.provider.addMedicine(med);
                  setSum({ ...sum, medicines: [{ ...med, since: new Date().toISOString(), addedBy: `Dr. ${doc.name || "visiting doctor"}` }, ...sum.medicines] });
                  setMed({ name: "", dose: "" });
                  toast({ tone: "success", title: "Medicine added" });
                }}
              >
                <Input value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })} placeholder="Medicine" className="h-11" aria-label="Medicine name" />
                <Input value={med.dose} onChange={(e) => setMed({ ...med, dose: e.target.value })} placeholder="Dose" className="h-11" aria-label="Dose" />
                <Button type="submit" size="icon" className="size-11 rounded-2xl" disabled={!med.name || !med.dose} aria-label="Add medicine" sound={null}>
                  <Plus />
                </Button>
              </form>
            </DashboardCard>

            <DashboardCard title="History" className="col-span-12 lg:col-span-4">
              <ol className="space-y-3">
                {sum.history.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <History className="mt-0.5 size-4 text-primary" />
                    <div className="text-sm">
                      <p className="font-semibold">{h.event}</p>
                      <p className="text-xs text-ink-mute">{formatDate(h.date)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </DashboardCard>

            <DashboardCard title="Clinical notes" className="col-span-12">
              <form
                className="flex gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await services.provider.addNote(note);
                  setSum({ ...sum, notes: [{ at: new Date().toISOString(), by: `Dr. ${doc.name || "visiting doctor"}`, text: note }, ...sum.notes] });
                  setNote("");
                  toast({ tone: "success", title: "Note added to record" });
                }}
              >
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the care team…" className="min-h-[64px]" />
                <Button type="submit" className="self-end" disabled={note.trim().length < 3} sound={null}>
                  <Send /> Add note
                </Button>
              </form>
              <ul className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                {sum.notes.map((n, i) => (
                  <li key={i} className="rounded-3xl bg-sand/60 p-4">
                    <p className="flex items-start gap-2 text-sm">
                      <NotebookPen className="mt-0.5 size-4 shrink-0 text-primary" /> {n.text}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-ink-mute">
                      {n.by} · {formatDate(n.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </DashboardCard>
          </motion.div>
        )}
        {stage === "summary" && cd.expired && <StateView state="sessionExpired" title="Access has ended" body="Your 24-hour access window closed. Scan the card again to request new access." />}
      </main>
    </div>
  );
}
