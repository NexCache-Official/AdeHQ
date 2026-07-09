import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PROJECT_URL, resolveSupabaseSecretKey } from "./config";

/** Server-only Supabase client using the secret key (bypasses RLS). */
export function createSupabaseSecretClient() {
  const secretKey = resolveSupabaseSecretKey();

  if (!secretKey) {
    throw new Error(
      "Supabase secret key is not configured. Set SUPABASE_SECRET_KEY (sb_secret_…) on the server.",
    );
  }

  return createClient(SUPABASE_PROJECT_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
