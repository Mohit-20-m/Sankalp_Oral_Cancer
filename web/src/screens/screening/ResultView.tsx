import { useState , useEffect } from "react";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { services } from "@/services";
import { Building2, CalendarDays, MessageSquareText, Download, Share2, IdCard, ArrowRight, Plus, CheckCircle2, ListChecks, Camera, Send, UploadCloud, Webcam } from "lucide-react";
import type { AiResult, CapturedPhoto, Patient, Referral, SiteId } from "@/types";
import { PHOTO_SITES } from "@/config/constants";
import { UploadCapture } from "@/components/screening/UploadCapture";
import { WebcamCapture } from "@/components/screening/WebcamCapture";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { riskTokens } from "@/config/theme";
import { RISK_ICON, RiskIndicator } from "@/components/common/RiskIndicator";
import { Disclaimer } from "@/components/common/misc";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { formatDate, pct, patientRef } from "@/utils/format";
import { branding } from "@/config/branding";
import { useToast } from "@/components/ui/toast";
import { LogoMark } from "@/components/brand/Logo";

const NEXT: Record<AiResult["risk"], string[]> = {
  LOW: ["No referral needed now.", "Encourage quitting areca nut and tobacco.", "Rescreen in 12 months, or sooner if a sore or patch appears."],
  MEDIUM: ["Referred to the dental college for an examination.", "Specialist will review the photos within 72 hours.", "Follow-up call in 3 months."],
  HIGH: ["Visit the dental college within 7 days — this is important.", "The patient has received an SMS with the referral code.", "You will be reminded if the visit is missed."],
  CANNOT_ASSESS: ["Photos were not clear enough for the screening model.", "Retake the photos in better light, or the specialist will review directly."],
  NEEDS_REVIEW: ["A specialist will look at the photos before a result is given.", "No referral yet — you'll be notified of the decision."],
};

// AI flagged a photo but nothing else is worrying (rule R1b): first a retake, then — if still flagged — a doctor's check.
const NEXT_RETAKE = [
  "The photo(s) on the right need to be taken again — closer, in focus, without glare or flash reflections.",
  "Retake now. If the new photo looks normal, no doctor visit is needed.",
  "If it can't be retaken within 24 hours, a doctor will check the original photo.",
];
const NEXT_DOCTOR_CHECK = [
  "No urgent concern — a doctor will double-check one photo.",
  "No need to travel. You'll be notified of the doctor's decision.",
  "Keep giving routine advice on areca nut and tobacco.",
];

function RetakePanel({ sites, onSend }: { sites: SiteId[]; onSend: (photos: CapturedPhoto[]) => Promise<void> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<"webcam" | "upload">("upload");
  const [photos, setPhotos] = useState<Partial<Record<SiteId, CapturedPhoto>>>({});
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const site = PHOTO_SITES.find((s) => s.id === sites[active]) ?? PHOTO_SITES[0];
  const ready = sites.every((s) => photos[s]?.quality.acceptable);
  return (
    <div className="flex h-full flex-col">
      <h3 className="flex items-center gap-2 text-lg font-bold">
        <Camera className="size-5" /> Retake {sites.length > 1 ? `${sites.length} photos` : "one photo"}
      </h3>
      <p className="mt-1 text-sm text-ink-soft">Fill the frame with the area, hold steady, avoid glare. Only the photo(s) below are needed.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {sites.map((s, i) => {
          const ps = PHOTO_SITES.find((x) => x.id === s);
          return (
            <button
              key={s}
              onClick={() => setActive(i)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${i === active ? "bg-primary text-white" : "bg-bg"}`}
            >
              {ps ? t(ps.labelKey) : s} {photos[s]?.quality.acceptable ? "✓" : ""}
            </button>
          );
        })}
      </div>
      <Tabs value={method} onValueChange={(v) => setMethod(v as "webcam" | "upload")} className="mt-4">
        <TabsList>
          <TabsTrigger value="upload">
            <UploadCloud /> Upload
          </TabsTrigger>
          <TabsTrigger value="webcam">
            <Webcam /> Webcam
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4">
        {method === "upload" ? (
          <UploadCapture key={site.id} site={site} onSave={(p) => setPhotos((x) => ({ ...x, [p.site]: p }))} />
        ) : (
          <WebcamCapture key={site.id} site={site} onSave={(p) => setPhotos((x) => ({ ...x, [p.site]: p }))} />
        )}
      </div>
      <div className="mt-auto pt-6">
        <Button
          className="w-full"
          disabled={!ready || sending}
          onClick={async () => {
            setSending(true);
            try {
              await onSend(sites.map((s) => photos[s]!));
            } finally {
              setSending(false);
            }
          }}
        >
          <Send /> {sending ? "Checking the new photo…" : "Send retake"}
        </Button>
      </div>
    </div>
  );
}

function printSlip(patient: Patient, referral: Referral, qrSvg: string) {
  const w = window.open("", "_blank", "width=640,height=820");
  if (!w) return;
  w.document.write(`<!doctype html><title>Referral ${referral.code}</title><style>body{font-family:Inter,system-ui,sans-serif;padding:40px;color:#1A2620}h1{font-size:22px;margin:0}.muted{color:#6b7a72}.box{border:1.5px solid #16352A;border-radius:18px;padding:24px;margin-top:20px}.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee}.code{font-size:26px;font-weight:800;letter-spacing:2px}</style>
  <h1>${branding.appName} — Referral slip</h1><p class="muted">Screening aid only — not a diagnosis.</p>
  <div class="box"><div style="display:flex;gap:24px;align-items:center"><div>${qrSvg}</div><div><p class="muted">Referral code</p><p class="code">${referral.code}</p></div></div>
  <div class="row"><span>Patient</span><b>${patient.name} (${patientRef(patient)})</b></div>
  <div class="row"><span>Refer to</span><b>${referral.facility}</b></div>
  <div class="row"><span>Visit by</span><b>${formatDate(referral.visitBy)}</b></div>
  <div class="row"><span>Priority</span><b>${referral.risk}</b></div></div>
  <p class="muted" style="margin-top:24px">Bring this slip and the health card. Support: ${branding.supportEmail}</p><script>window.print()</script>`);
  w.document.close();
}

export function ResultView({ result, referral, patient, offline, onNew, onProfile, onRetake }: { result: AiResult; referral?: Referral; patient: Patient; offline: boolean; onNew: () => void; onProfile: () => void; onRetake?: (photos: CapturedPhoto[]) => Promise<void> }) {
  const { t } = useI18n();
  const toast = useToast();
  const tok = riskTokens[result.risk];
  const Icon = RISK_ICON[result.risk];
  const retake = result.retake && onRetake ? result.retake : undefined;
  const doctorCheck = !retake && result.risk === "NEEDS_REVIEW" && result.aiOnlyFlag;
  const title = retake ? "Retake needed" : doctorCheck ? "Doctor double-check" : t(tok.labelKey);
  const next = retake ? NEXT_RETAKE : doctorCheck ? NEXT_DOCTOR_CHECK : NEXT[result.risk];
  const [card, setCard] = useState(false);
  const [cardLink, setCardLink] = useState<string | null>(null);
  useEffect(() => {
    if (card && !cardLink)
      services.patients
        .issueCard(patient.id)
        .then((c) => setCardLink(c.link))
        .catch(() => toast({ tone: "error", title: "Could not issue the health card" }));
  }, [card, cardLink, patient.id, toast]);

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* Hero risk card */}
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative col-span-12 overflow-hidden rounded-4xl p-8 xl:col-span-7"
        style={{ backgroundColor: tok.bg }}
        aria-labelledby="risk-title"
      >
        <svg className="absolute -right-16 -top-16 size-72 opacity-40" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="48" fill="none" stroke={tok.ring} strokeWidth="1.2" />
          <circle cx="50" cy="50" r="34" fill="none" stroke={tok.ring} strokeWidth="1.2" strokeDasharray="2 3" />
        </svg>
        <div className="relative flex flex-wrap items-center gap-2">
          <StatusBadge status={result.preliminary ? "preliminary" : result.reviewedBy ? "reviewed" : "approved"} label={result.preliminary ? undefined : result.reviewedBy ? undefined : result.risk === "LOW" ? "AI + rules checked" : retake ? "AI + rules · retake requested" : "AI + rules · awaiting specialist"} />
          <span className="text-xs font-semibold" style={{ color: tok.fg }}>
            Model {result.modelVersion} · confidence {pct(result.confidence)}
          </span>
        </div>
        <div className="relative mt-6 flex items-center gap-5">
          <motion.span initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.15 }} className="grid size-20 place-items-center rounded-3xl bg-white/70" style={{ color: tok.fg }}>
            <Icon className="size-10" strokeWidth={2} />
          </motion.span>
          <div>
            <p className="text-sm font-semibold" style={{ color: tok.fg }}>
              {t("result.title")} · {patient.name}
            </p>
            <h2 id="risk-title" className="text-[2.6rem] font-extrabold leading-none tracking-tight" style={{ color: tok.fg }}>
              {title}
            </h2>
          </div>
        </div>
        <Disclaimer preliminary={offline} className="relative mt-7 bg-white/60" />

        <div className="relative mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <ListChecks className="size-4" /> {t("result.reasons")}
            </p>
            <ul className="space-y-1.5">
              {result.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-[15px] leading-snug">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tok.fg }} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <ArrowRight className="size-4" /> {t("result.next")}
            </p>
            <ol className="space-y-1.5">
              {next.map((r, i) => (
                <li key={r} className="flex gap-2.5 text-[15px] leading-snug">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/70 text-[11px] font-bold">{i + 1}</span>
                  {r}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.section>

      {/* Referral */}
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="col-span-12 flex flex-col rounded-4xl bg-surface p-7 shadow-soft xl:col-span-5">
        {retake ? (
          <RetakePanel sites={retake.sites} onSend={onRetake!} />
        ) : referral ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("result.referral")}</h3>
              <RiskIndicator risk={referral.risk} size="sm" />
            </div>
            <div className="mt-5 flex items-center gap-5">
              <div className="rounded-3xl bg-bg p-3">
                <QRCodeSVG id="ref-qr" value={`REF:${referral.code}`} size={124} fgColor="#16352A" bgColor="transparent" />
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-mute">Referral code</p>
                <p className="num text-2xl font-extrabold tracking-wider">{referral.code}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-mint px-2.5 py-1 text-xs font-semibold text-primary-deep">
                  <MessageSquareText className="size-3.5" /> {t("result.smsSent")}
                </p>
              </div>
            </div>
            <dl className="mt-6 space-y-3">
              <div className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                <Building2 className="size-5 text-primary" />
                <dt className="text-sm text-ink-mute">Dental college</dt>
                <dd className="ml-auto text-right text-sm font-semibold">{referral.facility}</dd>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-bg p-3">
                <CalendarDays className="size-5 text-primary" />
                <dt className="text-sm text-ink-mute">{t("result.visitBy")}</dt>
                <dd className="ml-auto text-sm font-bold">{formatDate(referral.visitBy, { weekday: "short", day: "numeric", month: "long" })}</dd>
              </div>
            </dl>
            <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
              <Button variant="secondary" onClick={() => printSlip(patient, referral, document.getElementById("ref-qr")?.outerHTML ?? "")}>
                <Download /> {t("result.download")}
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const text = `${branding.appName} referral ${referral.code} for ${patient.name}. Visit ${referral.facility} by ${formatDate(referral.visitBy)}.`;
                  if (navigator.share) await navigator.share({ title: "Referral", text }).catch(() => undefined);
                  else {
                    await navigator.clipboard?.writeText(text);
                    toast({ tone: "info", title: "Referral details copied" });
                  }
                }}
              >
                <Share2 /> {t("result.share")}
              </Button>
              <Button variant="accent" onClick={() => setCard(true)}>
                <IdCard /> Health card
              </Button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col">
            <h3 className="text-lg font-bold">No referral needed</h3>
            <p className="mt-1 text-sm text-ink-soft">{result.risk === "LOW" ? "Next routine screening in 12 months." : doctorCheck ? "A doctor will double-check one photo — no need to travel." : "Awaiting specialist decision."}</p>
            <div className="mt-6 flex items-center gap-3 rounded-3xl bg-mint p-4">
              <CheckCircle2 className="size-6 text-primary" />
              <p className="text-sm font-semibold">Result saved to {patient.name}'s record</p>
            </div>
            <div className="mt-auto pt-6">
              <Button variant="accent" className="w-full" onClick={() => setCard(true)}>
                <IdCard /> {t("result.healthCard")}
              </Button>
            </div>
          </div>
        )}
      </motion.section>

      <div className="col-span-12 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onProfile}>
          Open patient profile
        </Button>
        <Button onClick={onNew} sound="transition">
          <Plus /> New screening
        </Button>
      </div>

      <Dialog open={card} onOpenChange={setCard}>
        <DialogContent title="Patient health card" description="Print on card stock or share as an image. The QR opens the patient's record for authorised staff and Provider Connect.">
          <div className="relative overflow-hidden rounded-3xl bg-primary-deep p-6 text-white">
            <svg className="absolute -right-10 -top-10 size-48 opacity-30" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="46" fill="#2F6B4F" />
            </svg>
            <div className="relative flex items-center gap-2">
              <LogoMark size={28} />
              <span className="font-display text-sm font-bold">{branding.appName}</span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest text-white/50">Health card</span>
            </div>
            <div className="relative mt-6 flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-xl font-bold">{patient.name}</p>
                <p className="text-sm text-white/60">
                  {patientRef(patient)} · {patient.village}
                </p>
                <p className="mt-4 text-[11px] text-white/45">Issued {formatDate(new Date().toISOString())}</p>
              </div>
              <div className="rounded-2xl bg-white p-2">
                {cardLink ? <QRCodeSVG value={cardLink} size={88} fgColor="#16352A" /> : <div className="size-[88px] animate-pulse rounded-xl bg-ink/10" />}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              <Download /> Print
            </Button>
            <Button
              onClick={() => {
                setCard(false);
                toast({ tone: "success", title: "Health card issued", body: `Card for ${patient.name} recorded.` });
              }}
              sound={null}
            >
              Mark as issued
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
