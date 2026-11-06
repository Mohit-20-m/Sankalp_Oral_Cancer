/**
 * API configuration + HTTP client for the Python backend (/api/v1).
 * Staff requests carry the Keycloak access token (memory only); Provider Connect uses its own short-lived
 * patient-scoped token. A 401 triggers one silent token refresh, then the "session expired" screen.
 */
import { accessToken, refreshNow } from "./http/session";
export const API_MODE = (import.meta.env.VITE_API_MODE ?? "mock") as "mock" | "http";
export const isMockMode = API_MODE === "mock";
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
export const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
  get isAuth() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isUnavailable() {
    return this.status === 0 || this.status >= 502;
  }
}

/** Optional bearer for short-lived public flows (Provider Connect) — memory only. */
let ephemeralToken: string | null = null;
export const setEphemeralToken = (t: string | null) => {
  ephemeralToken = t;
};

export async function http<T>(path: string, init: RequestInit & { json?: unknown; noAuth?: boolean } = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  if (ephemeralToken) headers.set("Authorization", `Bearer ${ephemeralToken}`);
  else if (!init.noAuth) {
    const tok = await accessToken();
    if (tok) headers.set("Authorization", `Bearer ${tok}`);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(0, "Network unavailable");
  }
  if (res.status === 401 && !retried && !ephemeralToken && !init.noAuth && (await refreshNow())) {
    return http<T>(path, init, true);
  }
  if (!res.ok) {
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { detail?: unknown; message?: string; code?: string };
      const d = body.detail;
      msg =
        typeof d === "string"
          ? d
          : Array.isArray(d)
            ? d.map((x: { msg?: string }) => x.msg ?? "").join("; ")
            : d && typeof d === "object" && "reasons" in d
              ? `Not allowed: ${(d as { reasons: string[] }).reasons.join(", ")}`
              : (body.message ?? msg);
      code = body.code;
    } catch {
      /* non-JSON */
    }
    if (res.status === 401 && !init.noAuth && !ephemeralToken) window.dispatchEvent(new CustomEvent("auth:expired"));
    throw new ApiError(res.status, msg, code);
  }
  if (res.status === 204) return undefined as T;
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : undefined) as T;
}
