import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/store/auth";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/primitives";
import { usePreferences } from "@/hooks";
import { AppRoutes } from "@/navigation/routes";

function PreferenceEffects() {
  const p = usePreferences();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--text-scale", String(p.textScale));
    root.dataset.contrast = p.highContrast ? "high" : "normal";
    root.dataset.motion = p.reduceMotion === "system" ? "system" : p.reduceMotion ? "reduce" : "full";
  }, [p.textScale, p.highContrast, p.reduceMotion]);
  return null;
}

export default function App() {
  const p = usePreferences();
  return (
    <MotionConfig reducedMotion={p.reduceMotion === "system" ? "user" : p.reduceMotion ? "always" : "never"}>
      <I18nProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={250}>
            <ToastProvider>
              <PreferenceEffects />
              <AppRoutes />
            </ToastProvider>
          </TooltipProvider>
        </AuthProvider>
      </I18nProvider>
    </MotionConfig>
  );
}
