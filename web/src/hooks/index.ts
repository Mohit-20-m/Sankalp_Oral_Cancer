import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { prefs, type Preferences } from "@/utils/preferences";
import { ApiError } from "@/services/api";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | Error | undefined;
  reload: () => void;
  setData: (d: T) => void;
}

/** Minimal data-loading hook with loading / error / reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error>();
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    fnRef
      .current()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, loading, error, reload, setData };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
  );
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(prefs.subscribe as (cb: () => void) => () => void, prefs.all);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useCountdown(targetIso: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  if (!targetIso) return { ms: 0, label: "--:--", expired: false };
  const ms = Math.max(0, new Date(targetIso).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { ms, label: `${m}:${s.toString().padStart(2, "0")}`, expired: ms === 0 };
}
