import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, ArrowRight, ShieldCheck, ScanFace, Stethoscope, BarChart3, Cpu, Activity, Users, UserRound, AlertCircle, Timer } from "lucide-react";
import { Logo, LogoFull } from "@/components/brand/Logo";
import { branding } from "@/config/branding";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { LanguageSelector } from "@/components/navigation/LanguageSelector";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/i18n";
import { isMockMode } from "@/services/api";
import { ROLE_LABEL } from "@/mocks/data";
import type { Role } from "@/types";
import { cn } from "@/utils/cn";

const DEMO: { role: Role; user: string; icon: typeof ScanFace; name: string }[] = isMockMode
  ? [
      { role: "asha", user: "kavya", icon: UserRound, name: "Kavya" },
      { role: "nurse", user: "rekha", icon: ScanFace, name: "Rekha" },
      { role: "specialist", user: "meera", icon: Stethoscope, name: "Dr. Meera" },
      { role: "district_officer", user: "dho", icon: BarChart3, name: "Mr. Suresh" },
      { role: "clinical_lead", user: "lead", icon: Cpu, name: "Dr. Anand" },
      { role: "admin", user: "admin", icon: Activity, name: "Farhan" },
    ]
  : [
      { role: "asha", user: "kavya.asha", icon: UserRound, name: "Kavya" },
      { role: "nurse", user: "rekha.nurse", icon: ScanFace, name: "Rekha" },
      { role: "specialist", user: "dr.meera", icon: Stethoscope, name: "Dr. Meera" },
      { role: "district_officer", user: "officer.dk", icon: BarChart3, name: "District officer" },
      { role: "clinical_lead", user: "lead.rao", icon: Cpu, name: "Dr. Prakash Rao" },
      { role: "admin", user: "admin.ops", icon: Activity, name: "Platform admin" },
    ];
const SHOW_DEMO = isMockMode || import.meta.env.VITE_SHOW_DEMO_USERS !== "false";
const DEMO_PASSWORD = isMockMode ? "demo1234" : ((import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? "OralScreen@2026");

function Hero() {
  return (
    <div className="relative hidden h-full overflow-hidden rounded-4xl bg-primary-deep p-10 text-white lg:flex lg:flex-col">
      <Logo tone="light" />
      {/* decorative composition */}
      <svg className="pointer-events-none absolute -right-24 top-24 h-[520px] w-[520px]" viewBox="0 0 400 400" aria-hidden>
        <circle cx="200" cy="200" r="180" fill="none" stroke="#2F6B4F" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="130" fill="none" stroke="#2F6B4F" strokeWidth="1.5" strokeDasharray="4 8" />
        <path d="M120 230c40 70 120 70 160 0" stroke="#D6EC8C" strokeWidth="22" strokeLinecap="round" fill="none" />
        <circle cx="200" cy="140" r="26" fill="#D6EC8C" />
        <circle cx="340" cy="120" r="10" fill="#F4E6AE" />
        <circle cx="70" cy="300" r="7" fill="#F2D4CC" />
      </svg>

      <div className="relative mt-auto max-w-md">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-8 flex flex-wrap gap-2">
          {[
            { i: ScanFace, t: "7-site guided capture" },
            { i: ShieldCheck, t: "Specialist-reviewed" },
            { i: Users, t: "Built for ASHA workers" },
          ].map(({ i: I, t }) => (
            <span key={t} className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3.5 py-2 text-[13px] font-medium text-white/85 backdrop-blur">
              <I className="size-4 text-accent" /> {t}
            </span>
          ))}
        </motion.div>
        <h2 className="text-[2.6rem] font-bold leading-[1.08] tracking-tight">
          {branding.tagline.split(". ").map((s, i) => (
            <span key={i} className={cn("block", i === 1 && "text-accent")}>
              {s.replace(/\.$/, "")}.
            </span>
          ))}
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/65">{branding.description}</p>
        <p className="mt-10 text-xs text-white/35">
          © {new Date().getFullYear()} {branding.copyrightHolder} · v{branding.version}
        </p>
      </div>
    </div>
  );
}

export default function Login() {
  const { login, sessionExpired } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== "/login" ? from : "/", { replace: true });
    } catch {
      setError(t("auth.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 gap-3 p-3 lg:grid-cols-[1.05fr_1fr]">
      <Hero />
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto">
            <LanguageSelector variant="segmented" />
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="mx-auto my-auto w-full max-w-[420px] py-10">
          <LogoFull className="mb-8 -ml-2" />
          <h1 className="text-[2.1rem] font-bold leading-tight">{t("auth.welcome")}</h1>
          <p className="mt-2 text-[15px] text-ink-soft">{t("auth.subtitle")}</p>

          <AnimatePresence>
            {sessionExpired && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-5 flex items-center gap-3 rounded-2xl bg-butter px-4 py-3 text-sm text-[#5A4500]" role="status">
                <Timer className="size-5 shrink-0" /> Your session expired for privacy. Please sign in again.
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <div>
              <Label htmlFor="u">{t("auth.username")}</Label>
              <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. rekha" aria-invalid={!!error} />
            </div>
            <div>
              <Label htmlFor="p">{t("auth.password")}</Label>
              <div className="relative">
                <Input id="p" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pr-12" aria-invalid={!!error} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-mute hover:bg-ink/5" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>
            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-2xl bg-blush px-4 py-3 text-sm font-medium text-[#7A2418]" role="alert">
                  <AlertCircle className="size-[18px] shrink-0" /> {error}
                </motion.p>
              )}
            </AnimatePresence>
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
              {t("auth.signIn")} {!busy && <ArrowRight />}
            </Button>
          </form>

          {SHOW_DEMO && (
            <div className="mt-10">
              <p className="label-eyebrow mb-3">{t("auth.demoAs")} · {isMockMode ? "any password (4+ chars)" : "demo accounts"}</p>
              <div className="grid grid-cols-3 gap-2">
                {DEMO.map((d) => {
                  const I = d.icon;
                  const sel = username === d.user;
                  return (
                    <button
                      key={d.role}
                      type="button"
                      onClick={() => {
                        setUsername(d.user);
                        setPassword(DEMO_PASSWORD);
                        setError(null);
                      }}
                      className={cn(
                        "flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition-all",
                        sel ? "bg-primary-deep text-white shadow-lift" : "bg-surface shadow-soft hover:-translate-y-0.5",
                      )}
                    >
                      <I className={cn("size-5", sel ? "text-accent" : "text-primary")} />
                      <span>
                        <span className="block text-[13px] font-semibold leading-tight">{d.name}</span>
                        <span className={cn("block text-[11px]", sel ? "text-white/60" : "text-ink-mute")}>{ROLE_LABEL[d.role]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-mute">
                Local doctors don't sign in — they use <a href="/connect" className="font-semibold text-primary hover:underline">Provider Connect</a> with the patient's QR.
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
