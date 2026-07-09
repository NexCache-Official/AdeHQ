import { getSiteUrl } from "@/lib/site-url";

/** Where Supabase sends users after they click the password-reset email link. */
export function getPasswordResetRedirectUrl(): string {
  const next = encodeURIComponent("/reset-password");
  return `${getSiteUrl()}/auth/callback?next=${next}`;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Enter your email address.");

  const response = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trimmed }),
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to send reset email. Try again in a moment.");
  }
}
