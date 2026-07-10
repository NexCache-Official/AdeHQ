import { supabase } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";
import { isConfirmationLinkError } from "@/lib/auth/confirmation";
import { isEmailConfirmed } from "@/lib/auth/session";
import {
  captureRecoveryIntentFromUrl,
  isPasswordRecoveryPending,
  markPasswordRecoveryPending,
  peekAuthIntentFromUrl,
} from "@/lib/auth/recovery";

export const AUTH_NEXT_KEY = "adehq_auth_next";

/** Where Supabase sends users after they click the email link. Must match an allowed redirect URL. */
export function getEmailRedirectUrl(): string {
  const path = process.env.NEXT_PUBLIC_AUTH_REDIRECT_PATH ?? "/auth/callback";
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
  const { pathname, search } = window.location;
  // Keep non-auth query params (e.g. next=/reset-password) when clearing tokens.
  const params = new URLSearchParams(search);
  params.delete("code");
  params.delete("token_hash");
  params.delete("type");
  const next = params.toString();
  window.history.replaceState({}, "", next ? `${pathname}?${next}` : pathname);
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

async function getExistingSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

function readRecoveryNextFromUrl(): string | null {
  if (isPasswordRecoveryPending()) return "/reset-password";
  const intent = peekAuthIntentFromUrl();
  if (intent.recovery || intent.next === "/reset-password") return "/reset-password";
  return null;
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
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY")) {
        finish(true);
      }
    });
    subscription = listener.data.subscription;

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });
  });
}

/**
 * Parse PKCE code, token_hash, or hash tokens from the current URL and create a session.
 * Single code path — detectSessionInUrl is disabled on the Supabase client to avoid races.
 */
export async function establishSessionFromUrl(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  captureRecoveryIntentFromUrl();

  const hasParams = hasAuthParamsInUrl();
  const intent = peekAuthIntentFromUrl();
  const isRecoveryFlow = intent.recovery || isPasswordRecoveryPending();

  const existing = await getExistingSession();
  if (existing?.user && !hasParams) {
    return true;
  }

  // Recovery links must not reuse a stale workspace session — clear it before consuming tokens.
  if (hasParams && existing?.user && isRecoveryFlow) {
    markPasswordRecoveryPending();
    await supabase.auth.signOut();
  }

  if (!hasParams) {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const tokenHash = searchParams.get("token_hash") ?? searchParams.get("token");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const hash = window.location.hash.replace(/^#/, "");

  try {
    if (tokenHash && type) {
      if (type === "recovery") markPasswordRecoveryPending();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as "signup" | "email" | "recovery" | "invite" | "email_change",
      });
      if (error) throw error;
      clearAuthParamsFromUrl();
      return true;
    }

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      clearAuthParamsFromUrl();
      return true;
    }

    if (hash) {
      const hashParams = new URLSearchParams(hash);
      if (hashParams.get("type") === "recovery") {
        markPasswordRecoveryPending();
      }
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
  } catch (error) {
    // Link may have been consumed already — session might exist in another tab or from a prior click.
    const sessionAfterError = await getExistingSession();
    if (sessionAfterError?.user) {
      clearAuthParamsFromUrl();
      return true;
    }
    throw error;
  }

  const waited = await waitForAuthSession(4000);
  if (waited) {
    clearAuthParamsFromUrl();
    return true;
  }

  return Boolean(await getExistingSession());
}

export async function completeAuthRedirect(nextPath?: string): Promise<{
  ok: true;
  next: string;
  email: string;
} | {
  ok: false;
  error: unknown;
  linkError: boolean;
}> {
  try {
    const intent = peekAuthIntentFromUrl();
    if (intent.recovery || intent.next === "/reset-password" || nextPath === "/reset-password") {
      captureRecoveryIntentFromUrl();
    }

    const established = await establishSessionFromUrl();
    const session = await getExistingSession();

    if (!session?.user) {
      if (established) {
        throw new Error("Session could not be loaded after confirmation.");
      }
      throw new Error(
        "No login session was created. Add your site URL under Supabase → Authentication → URL Configuration, set Site URL to your app origin, and add Redirect URL patterns for /auth/callback. Then request a new confirmation email.",
      );
    }

    const recoveryFlow =
      isPasswordRecoveryPending() ||
      intent.recovery ||
      nextPath === "/reset-password" ||
      readRecoveryNextFromUrl() === "/reset-password";

    if (!isEmailConfirmed(session.user) && !recoveryFlow) {
      await supabase.auth.signOut();
      throw new Error("Email not confirmed");
    }

    const next =
      nextPath ??
      readRecoveryNextFromUrl() ??
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next") ?? consumeAuthNextPath("/onboarding")
        : "/onboarding");
    const safeNext =
      isPasswordRecoveryPending() || next === "/reset-password"
        ? "/reset-password"
        : next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/onboarding";

    return { ok: true, next: safeNext, email: session.user.email ?? "" };
  } catch (error) {
    return {
      ok: false,
      error,
      linkError: isConfirmationLinkError(error),
    };
  }
}

export { hasAuthParamsInUrl };
