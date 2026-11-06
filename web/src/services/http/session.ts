/**
 * Keycloak session (OIDC password grant against the "oralscreen-app" public client).
 * The access token lives in memory only. The refresh token is kept in sessionStorage so a page reload keeps
 * you signed in — it is per-tab and disappears when the tab is closed. No patient data is ever stored.
 */
const KC_URL = (import.meta.env.VITE_KEYCLOAK_URL as string | undefined) ?? "/auth";
const REALM = (import.meta.env.VITE_KEYCLOAK_REALM as string | undefined) ?? "oralscreen";
const CLIENT = (import.meta.env.VITE_KEYCLOAK_CLIENT as string | undefined) ?? "oralscreen-app";
const TOKEN_URL = `${KC_URL}/realms/${REALM}/protocol/openid-connect/token`;
const LOGOUT_URL = `${KC_URL}/realms/${REALM}/protocol/openid-connect/logout`;
const RT_KEY = "os.rt";

let access: string | null = null;
let accessExp = 0;
let refresh: string | null = safeGet();
let refreshing: Promise<boolean> | null = null;

function safeGet() {
  try {
    return sessionStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}
function safeSet(v: string | null) {
  try {
    if (v) sessionStorage.setItem(RT_KEY, v);
    else sessionStorage.removeItem(RT_KEY);
  } catch {
    /* storage blocked — memory only */
  }
}

export class AuthError extends Error {}

async function tokenCall(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT, ...body }),
    });
  } catch {
    throw new AuthError("Cannot reach the sign-in service. Check your connection.");
  }
  const js = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const d = String(js.error_description ?? js.error ?? res.statusText);
    throw new AuthError(/invalid user credentials/i.test(d) ? "Wrong username or password" : d);
  }
  access = js.access_token as string;
  accessExp = Date.now() + (Number(js.expires_in ?? 300) - 20) * 1000;
  refresh = (js.refresh_token as string) ?? refresh;
  safeSet(refresh);
}

export async function passwordLogin(username: string, password: string) {
  await tokenCall({ grant_type: "password", username, password, scope: "openid" });
}

export async function refreshNow(): Promise<boolean> {
  if (!refresh) return false;
  refreshing ??= tokenCall({ grant_type: "refresh_token", refresh_token: refresh })
    .then(() => true)
    .catch(() => {
      clearSession();
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function accessToken(): Promise<string | null> {
  if (access && Date.now() < accessExp) return access;
  if (await refreshNow()) return access;
  return null;
}

export const hasSession = () => Boolean(access || refresh);

export function clearSession() {
  access = null;
  accessExp = 0;
  refresh = null;
  safeSet(null);
}

export async function logoutSession() {
  const rt = refresh;
  clearSession();
  if (rt)
    await fetch(LOGOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT, refresh_token: rt }),
    }).catch(() => undefined);
}
