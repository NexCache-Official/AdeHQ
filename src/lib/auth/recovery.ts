import { getSiteUrl } from "@/lib/site-url";
import { supabase } from "@/lib/supabase/client";

/** Session flag: user must finish /reset-password before accessing the workspace. */
export const PASSWORD_RECOVERY_PENDING_KEY = "adehq_password_recovery_pending";

export function markPasswordRecoveryPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, "1");
}

export function clearPasswordRecoveryPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
}

export function isPasswordRecoveryPending(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY) === "1";
}

/** Read recovery intent from the current URL before auth params are stripped. */
export function peekAuthIntentFromUrl(): { recovery: boolean; next: string | null } {
  if (typeof window === "undefined") {
    return { recovery: false, next: null };
  }

  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const recovery =
    search.get("type") === "recovery" ||
    search.get("next") === "/reset-password" ||
    hash.get("type") === "recovery";

  return {
    recovery,
    next: search.get("next"),
  };
}

export function captureRecoveryIntentFromUrl(): boolean {
  const intent = peekAuthIntentFromUrl();
  const pending = intent.recovery || intent.next === "/reset-password";
  if (pending) markPasswordRecoveryPending();
  return pending;
}

/** Supabase redirects here after the user clicks the reset link in email. */
export function getPasswordResetRedirectUrl(): string {
  return `${getSiteUrl()}/reset-password`;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Enter your email address.");

  // Must run in the browser so PKCE state is stored for the reset link callback.
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: getPasswordResetRedirectUrl(),
  });

  if (error) {
    throw new Error(error.message || "Unable to send reset email. Try again in a moment.");
  }
}
