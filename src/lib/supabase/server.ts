import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PROJECT_URL, isLegacyJwtKey } from "./config";

/**
 * Server-only Supabase secret key (bypasses RLS).
 *
 * Prefers the new API-key format (`sb_secret_…`). `SUPABASE_SECRET_KEY` is the
 * canonical env name; `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a name
 * alias so existing deployments keep working — the value it holds should be the
 * new secret key, not a legacy `service_role` JWT.
 */
export function resolveSupabaseSecretKey(): string | undefined {
  const candidates = [
    process.env.SUPABASE_SECRET_KEY?.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  ];
  return candidates.find((key) => key && key.length > 20);
}

let warnedLegacySecret = false;

function warnIfLegacySecretKey(secretKey: string): void {
  if (warnedLegacySecret || !isLegacyJwtKey(secretKey)) return;
  warnedLegacySecret = true;
  console.warn(
    "[AdeHQ Supabase] Using a legacy service_role JWT for server writes. " +
      "Migrate to a new secret key (sb_secret_…) via Supabase → Settings → API Keys, " +
      "set it as SUPABASE_SECRET_KEY, then disable legacy JWT-based API keys.",
  );
}

export function createServiceRoleClient() {
  const secretKey = resolveSupabaseSecretKey();

  if (!secretKey) {
    throw new Error(
      "Supabase secret key is not configured. Set SUPABASE_SECRET_KEY (sb_secret_…) on the server.",
    );
  }

  warnIfLegacySecretKey(secretKey);

  return createClient(SUPABASE_PROJECT_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
