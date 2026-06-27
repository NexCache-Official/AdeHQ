import { supabase } from "@/lib/supabase/client";
import { getEmailRedirectUrl } from "@/lib/auth/callback-session";

export async function resendSignupConfirmation(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Enter your email address.");

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: trimmed,
    options: {
      emailRedirectTo: getEmailRedirectUrl(),
    },
  });

  if (error) throw error;
}

type AuthLikeError = {
  message?: string;
  code?: string;
  status?: number;
};

/** True when Supabase rejected a one-time email link (used or timed out). */
export function isConfirmationLinkError(error: unknown): boolean {
  const e = (error ?? {}) as AuthLikeError;
  const msg = (e.message ?? "").toLowerCase();
  const code = e.code ?? "";

  return (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    code === "otp_disabled" ||
    msg.includes("email link is invalid") ||
    msg.includes("link is invalid or has expired") ||
    msg.includes("one-time token not found") ||
    msg.includes("token has expired") ||
    msg.includes("otp expired")
  );
}

export function parseAuthError(error: unknown): {
  message: string;
  needsEmailConfirmation: boolean;
  linkExpired: boolean;
  alreadyConfirmedHint: boolean;
} {
  const e = (error ?? {}) as AuthLikeError;
  const rawMessage = e.message ?? "Something went wrong.";
  const msg = rawMessage.toLowerCase();
  const code = e.code ?? "";

  if (msg.includes("invalid login credentials") || code === "invalid_credentials") {
    return {
      message: "Incorrect email or password.",
      needsEmailConfirmation: false,
      linkExpired: false,
      alreadyConfirmedHint: false,
    };
  }

  if (
    code === "email_not_confirmed" ||
    msg.includes("email not confirmed") ||
    msg.includes("not confirmed")
  ) {
    return {
      message: "Confirm your email before logging in. We can send you a new link.",
      needsEmailConfirmation: true,
      linkExpired: false,
      alreadyConfirmedHint: false,
    };
  }

  if (isConfirmationLinkError(error)) {
    return {
      message:
        "That confirmation link was already used or has expired. If you already confirmed your email, sign in below.",
      needsEmailConfirmation: false,
      linkExpired: true,
      alreadyConfirmedHint: true,
    };
  }

  return {
    message: rawMessage,
    needsEmailConfirmation: false,
    linkExpired: false,
    alreadyConfirmedHint: false,
  };
}
