import { supabase } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";

export const AUTH_NEXT_KEY = "adehq_auth_next";

/** Where Supabase sends users after they click the email link. Must match an allowed redirect URL. */
export function getEmailRedirectUrl(): string {
  // Site URL is always allowed in Supabase. Subpaths like /auth/callback require
  // an explicit Redirect URL entry — set NEXT_PUBLIC_AUTH_REDIRECT_PATH=/auth/callback
  // only after adding it in Supabase → Authentication → URL Configuration.
  const path = process.env.NEXT_PUBLIC_AUTH_REDIRECT_PATH ?? "/";
  if (path === "/") return getSiteUrl();
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function setAuthNextPath(path: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AUTH_NEXT_KEY, path);
}

export function consumeAuthNextPath(defaultPath = "/onboarding"): string {
  if (typeof window === "undefined") return defaultPath;
  const next = sessionStorage.getItem(AUTH_NEXT_KEY) ?? defaultPath;
  sessionStorage.removeItem(AUTH_NEXT_KEY);
  return next.startsWith("/") && !next.startsWith("//") ? next : defaultPath;
}

function clearAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", window.location.pathname);
}

function hasAuthParamsInUrl(): boolean {
  if (typeof window === "undefined") return false;
  const search = window.location.search;
  const hash = window.location.hash;
  return (
    search.includes("code=") ||
    search.includes("token_hash=") ||
    hash.includes("access_token=") ||
    hash.includes("refresh_token=")
  );
}

function waitForAuthSession(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let subscription: { unsubscribe: () => void };

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    const listener = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) {
        finish(true);
      }
    });
    subscription = listener.data.subscription;

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });
  });
}

/** Parse PKCE code, token_hash, or hash tokens from the current URL and create a session. */
export async function establishSessionFromUrl(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const searchParams = new URLSearchParams(window.location.search);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "email" | "recovery" | "invite" | "email_change",
    });
    if (error) throw error;
    clearAuthParamsFromUrl();
    return true;
  }

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    clearAuthParamsFromUrl();
    return true;
  }

  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      clearAuthParamsFromUrl();
      return true;
    }
  }

  // detectSessionInUrl may still be processing — wait briefly.
  if (hasAuthParamsInUrl()) {
    return waitForAuthSession();
  }

  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export { hasAuthParamsInUrl };
