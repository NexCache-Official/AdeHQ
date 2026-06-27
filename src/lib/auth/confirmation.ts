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

export function parseAuthError(error: unknown): {
  message: string;
  needsEmailConfirmation: boolean;
  linkExpired: boolean;
} {
  const e = (error ?? {}) as AuthLikeError;
  const msg = (e.message ?? "Something went wrong.").toLowerCase();
  const code = e.code ?? "";

  if (
    code === "email_not_confirmed" ||
    msg.includes("email not confirmed") ||
    msg.includes("not confirmed")
  ) {
    return {
      message: "Confirm your email before logging in. We can send you a new link.",
      needsEmailConfirmation: true,
      linkExpired: false,
    };
  }

  if (
    msg.includes("expired") ||
    msg.includes("invalid") ||
    code === "otp_expired" ||
    code === "flow_state_expired"
  ) {
    return {
      message: "That confirmation link expired. Request a new one below.",
      needsEmailConfirmation: true,
      linkExpired: true,
    };
  }

  if (msg.includes("invalid login credentials") || code === "invalid_credentials") {
    return {
      message: "Incorrect email or password.",
      needsEmailConfirmation: false,
      linkExpired: false,
    };
  }

  return {
    message: e.message ?? "Something went wrong.",
    needsEmailConfirmation: false,
    linkExpired: false,
  };
}
