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

export function getAuthCallbackUrl(nextPath = "/onboarding"): string {
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}
