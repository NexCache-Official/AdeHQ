const DEFAULT_SITE_URL = "https://app.adehq.com";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function readEnvUrl(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return trimTrailingSlash(value);
  }
  return null;
}

/** Public site origin used for Supabase email redirect links and user-facing URLs. */
export function getSiteUrl(): string {
  const configured = readEnvUrl("NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL", "APP_BASE_URL");
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return DEFAULT_SITE_URL;
}

/** Server-side app origin for webhooks, billing redirects, and internal callbacks. */
export function getPublicAppUrl(): string {
  const configured = readEnvUrl(
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SITE_URL",
    "APP_BASE_URL",
  );
  if (configured) return configured;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return DEFAULT_SITE_URL;
}

/** @deprecated Use getEmailRedirectUrl from @/lib/auth/callback-session */
export function getAuthCallbackUrl(_nextPath = "/onboarding"): string {
  return `${getSiteUrl()}/auth/callback`;
}
