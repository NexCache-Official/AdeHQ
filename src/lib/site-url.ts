const DEFAULT_SITE_URL = "https://ade-hq-eight.vercel.app";

/** Public site origin used for Supabase email redirect links. */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return DEFAULT_SITE_URL;
}

/** @deprecated Use getEmailRedirectUrl from @/lib/auth/callback-session */
export function getAuthCallbackUrl(_nextPath = "/onboarding"): string {
  return `${getSiteUrl()}/auth/callback`;
}
