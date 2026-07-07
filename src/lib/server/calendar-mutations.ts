import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentPlatform, ContentPost, ContentPostStatus } from "@/lib/calendar/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function mapPost(row: DbRow, campaignName: string | null = null): ContentPost {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    campaignName,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    status: String(row.status ?? "draft") as ContentPostStatus,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    platform: String(row.platform ?? "linkedin") as ContentPlatform,
    approvalId: row.approval_id ? String(row.approval_id) : null,
    artifactId: row.artifact_id ? String(row.artifact_id) : null,
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

export async function updateContentPost(
  client: SupabaseClient,
  workspaceId: string,
  postId: string,
  patch: {
    scheduledAt?: string | null;
    status?: ContentPostStatus;
    title?: string;
    platform?: ContentPlatform;
  },
): Promise<ContentPost> {
  const { data: existing, error: loadError } = await client
    .from("content_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("Post not found.");

  const update: DbRow = { updated_at: nowISO() };
  if (patch.scheduledAt !== undefined) update.scheduled_at = patch.scheduledAt;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.platform !== undefined) update.platform = patch.platform;

  if (patch.scheduledAt && patch.status === undefined) {
    update.status = "scheduled_later";
  }
  if (patch.scheduledAt === null && patch.status === undefined) {
    update.status = "draft";
  }

  const { error } = await client
    .from("content_posts")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", postId);
  if (error) throw error;

  const { data: updated, error: reloadError } = await client
    .from("content_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .maybeSingle();
  if (reloadError) throw reloadError;
  if (!updated) throw new Error("Post update failed.");

  let campaignName: string | null = null;
  const campaignId = (updated as DbRow).campaign_id;
  if (campaignId) {
    const { data: campaign } = await client
      .from("content_campaigns")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("id", String(campaignId))
      .maybeSingle();
    campaignName = campaign?.name ? String(campaign.name) : null;
  }

  return mapPost(updated as DbRow, campaignName);
}
