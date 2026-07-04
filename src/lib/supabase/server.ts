import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PROJECT_URL } from "./config";

/** Server-only Supabase secret key (bypasses RLS). Supports legacy and new env names. */
export function resolveSupabaseSecretKey(): string | undefined {
  const candidates = [
    process.env.SUPABASE_SECRET_KEY?.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  ];
  return candidates.find((key) => key && key.length > 20);
}

export function createServiceRoleClient() {
  const secretKey = resolveSupabaseSecretKey();

  if (!secretKey) {
    throw new Error(
      "Supabase secret key is not configured. Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }

  return createClient(SUPABASE_PROJECT_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
