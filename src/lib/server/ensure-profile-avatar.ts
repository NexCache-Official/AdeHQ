import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_BUCKET, avatarObjectPath } from "@/lib/avatar/constants";
import { publicAvatarUrl, renderDefaultAvatarSvg } from "@/lib/avatar/render-default-avatar";
import { SUPABASE_PROJECT_URL } from "@/lib/supabase/config";

/**
 * Ensure the user has a persisted avatar URL in profiles + storage.
 * Generates a unique gradient+initials SVG when missing.
 */
export async function ensureProfileAvatar(
  client: SupabaseClient,
  params: { userId: string; name: string; forceRegenerate?: boolean },
): Promise<{ avatarUrl: string; source: "generated" | "upload"; created: boolean }> {
  const { data: profile, error } = await client
    .from("profiles")
    .select("avatar, avatar_source, name")
    .eq("id", params.userId)
    .maybeSingle();
  if (error) throw error;

  const existing = profile?.avatar ? String(profile.avatar) : null;
  const source = profile?.avatar_source === "upload" ? "upload" : "generated";

  if (existing && !params.forceRegenerate && source === "upload") {
    return { avatarUrl: existing, source: "upload", created: false };
  }
  if (existing && !params.forceRegenerate && source === "generated") {
    return { avatarUrl: existing, source: "generated", created: false };
  }
  if (existing && !params.forceRegenerate) {
    return { avatarUrl: existing, source: "generated", created: false };
  }

  const displayName = params.name || profile?.name || "User";
  const svg = renderDefaultAvatarSvg(params.userId, displayName);
  const path = avatarObjectPath(params.userId, "svg");
  const bytes = new TextEncoder().encode(svg);

  const { error: uploadError } = await client.storage.from(AVATAR_BUCKET).upload(path, bytes, {
    contentType: "image/svg+xml",
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadError) throw uploadError;

  const avatarUrl = publicAvatarUrl(SUPABASE_PROJECT_URL, path, Date.now());
  const now = new Date().toISOString();
  const { error: updateError } = await client
    .from("profiles")
    .update({
      avatar: avatarUrl,
      avatar_source: "generated",
      avatar_updated_at: now,
      updated_at: now,
    })
    .eq("id", params.userId);
  if (updateError) throw updateError;

  return { avatarUrl, source: "generated", created: true };
}
