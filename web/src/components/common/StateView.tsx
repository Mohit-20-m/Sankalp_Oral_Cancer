import {
  Inbox,
  WifiOff,
  CloudUpload,
  CloudOff,
  BrainCircuit,
  Bug,
  Timer,
  QrCode,
  Lock,
  PartyPopper,
  ServerCrash,
  KeyRound,
  SearchX,
  Loader2,
  X,
  Check,
  Clock3,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { SpotIllustration } from "@/components/illustrations/SpotIllustration";
import { cn } from "@/utils/cn";

export type AppState =
  | "empty"
  | "noResults"
  | "offline"
  | "uploading"
  | "uploadFailed"
  | "waitingAi"
  | "aiFailed"
  | "sessionExpired"
  | "invalidQr"
  | "permissionDenied"
  | "success"
  | "apiUnavailable"
  | "authFailure";

interface Preset {
  icon: LucideIcon;
  badge?: LucideIcon;
  blob: string;
  badgeBg?: string;
  badgeFg?: string;
  title: string;
  body: string;
  variant: 0 | 1 | 2;
}

/** One designed visual per required system state (see Section 10 of the brief). */
export const STATE_PRESETS: Record<AppState, Preset> = {
  empty: { icon: Inbox, blob: "#DCEBDD", title: "Nothing here yet", body: "When there's something to show, it will appear here.", variant: 0 },
  noResults: { icon: SearchX, blob: "#ECE6D6", title: "No matches found", body: "Try a different name, phone number or patient ID.", variant: 1 },
  offline: { icon: WifiOff, badge: Clock3, blob: "#D3E2EC", title: "You're offline", body: "Keep working — everything is saved on this device and will upload when you're back online.", variant: 2 },
  uploading: { icon: CloudUpload, badge: Loader2, blob: "#DCEBDD", title: "Uploading securely", body: "Photos and answers are being sent. You can continue with the next patient.", variant: 0 },
  uploadFailed: { icon: CloudOff, badge: X, badgeBg: "#A3301F", badgeFg: "#fff", blob: "#F2D4CC", title: "Upload didn't finish", body: "Nothing was lost. We'll retry automatically, or you can retry now.", variant: 1 },
  waitingAi: { icon: BrainCircuit, badge: Loader2, blob: "#E1DCEF", title: "Analysing photographs", body: "The screening model is checking image quality and each mouth site. This usually takes a few seconds.", variant: 2 },
  aiFailed: { icon: Bug, badge: X, badgeBg: "#A3301F", badgeFg: "#fff", blob: "#F2D4CC", title: "Analysis couldn't complete", body: "The case has been sent for specialist review instead. No result has been guessed.", variant: 0 },
  sessionExpired: { icon: Timer, blob: "#F4E6AE", title: "Session expired", body: "For patient privacy, sessions end after a period of inactivity. Please sign in again.", variant: 1 },
  invalidQr: { icon: QrCode, badge: X, badgeBg: "#A3301F", badgeFg: "#fff", blob: "#F4E6AE", title: "This QR code isn't valid", body: "It may have expired or belong to another system. Ask for a new code or enter it manually.", variant: 2 },
  permissionDenied: { icon: Lock, blob: "#ECE6D6", title: "You don't have access", body: "Your role doesn't include this area. Contact your administrator if you think this is wrong.", variant: 0 },
  success: { icon: PartyPopper, badge: Check, blob: "#D6EC8C", title: "Submitted successfully", body: "Everything has been saved and shared with the care team.", variant: 1 },
  apiUnavailable: { icon: ServerCrash, blob: "#D3E2EC", title: "Service temporarily unavailable", body: "We couldn't reach the server. Your work is safe — please try again in a moment.", variant: 2 },
  authFailure: { icon: KeyRound, badge: X, badgeBg: "#A3301F", badgeFg: "#fff", blob: "#F2D4CC", title: "Couldn't sign you in", body: "Check your username and password. After 5 attempts the account is locked for 15 minutes.", variant: 0 },
};

export function StateView({
  state,
  title,
  body,
  action,
  compact,
  className,
}: {
  state: AppState;
  title?: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const p = STATE_PRESETS[state];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col items-center text-center", compact ? "py-6" : "py-12", className)}
      role={state.includes("Failed") || state === "authFailure" ? "alert" : "status"}
    >
      <SpotIllustration icon={p.icon} badge={p.badge} blob={p.blob} badgeBg={p.badgeBg} badgeFg={p.badgeFg} variant={p.variant} className={compact ? "scale-90" : ""} />
      <h3 className={cn("mt-4 font-bold text-ink", compact ? "text-base" : "text-lg")}>{title ?? p.title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-soft">{body ?? p.body}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export const EmptyState = (p: Omit<Parameters<typeof StateView>[0], "state"> & { state?: AppState }) => <StateView state={p.state ?? "empty"} {...p} />;
