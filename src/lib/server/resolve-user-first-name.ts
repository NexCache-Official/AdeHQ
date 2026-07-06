import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

/** Resolve display first name: profiles.name → auth metadata → email local-part. */
export async function resolveUserFirstName(
  client: SupabaseClient,
  user: User,
  override?: string,
): Promise<string> {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;

  const { data: profile, error } = await client
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;

  const profileName = typeof profile?.name === "string" ? profile.name.trim() : "";
  if (profileName) return profileName.split(/\s+/)[0] ?? profileName;

  const metadataName =
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  if (metadataName) return metadataName.split(/\s+/)[0] ?? metadataName;

  const emailLocal = user.email?.split("@")[0]?.trim();
  if (emailLocal) return emailLocal;

  return "there";
}
