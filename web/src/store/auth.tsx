import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@/types";
import { services } from "@/services";

/**
 * Auth state lives in memory only. The real backend keeps the session in an
 * httpOnly cookie; on refresh you'd call a `/auth/me` endpoint to restore it.
 * In demo mode, a refresh returns you to the login screen (by design — no
 * patient-adjacent data in browser storage).
 */
interface AuthCtx {
  user: User | null;
  login: (u: string, p: string) => Promise<User>;
  logout: () => Promise<void>;
  sessionExpired: boolean;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setExpired] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(services.auth.restore));

  useEffect(() => {
    if (!services.auth.restore) return;
    services.auth
      .restore()
      .then((u) => u && setUser(u))
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setExpired(true);
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const usr = await services.auth.login(u, p);
    setExpired(false);
    setUser(usr);
    return usr;
  }, []);
  const logout = useCallback(async () => {
    await services.auth.logout();
    setUser(null);
  }, []);

  if (restoring) return <div className="grid min-h-screen place-items-center text-sm text-ink-mute">Restoring your session…</div>;
  return <Ctx.Provider value={{ user, login, logout, sessionExpired }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
