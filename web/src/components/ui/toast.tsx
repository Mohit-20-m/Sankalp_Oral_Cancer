import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { soundManager } from "@/utils/soundManager";
import { cn } from "@/utils/cn";

type Tone = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
}

const Ctx = createContext<{ toast: (t: Omit<ToastItem, "id">) => void } | null>(null);

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const STYLE: Record<Tone, string> = {
  success: "bg-primary-deep text-white [&_.ic]:text-accent",
  error: "bg-[#5C1F17] text-white [&_.ic]:text-[#F6B4A6]",
  info: "bg-surface text-ink [&_.ic]:text-primary",
  warning: "bg-[#FBEBC4] text-[#5A3B00] [&_.ic]:text-[#8A5A00]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { ...t, id }]);
    soundManager.play(t.tone === "error" ? "error" : t.tone === "success" ? "success" : "notify");
    window.setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[min(92vw,380px)] flex-col gap-2.5" aria-live="polite" role="status">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICON[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={cn("pointer-events-auto flex items-start gap-3 rounded-3xl p-4 pr-3 shadow-lift", STYLE[t.tone])}
              >
                <Icon className="ic mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-sm opacity-80">{t.body}</p>}
                </div>
                <button aria-label="Dismiss" className="grid size-7 place-items-center rounded-full opacity-60 hover:opacity-100" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside provider");
  return c.toast;
}
