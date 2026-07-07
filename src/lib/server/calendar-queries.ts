import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarListPayload,
  ContentCampaign,
  ContentPlatform,
  ContentPost,
  ContentPostStatus,
} from "@/lib/calendar/types";

type DbRow = Record<string, unknown>;

function mapCampaign(row: DbRow): ContentCampaign {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: row.description ? String(row.description) : null,
    status: String(row.status ?? "draft") as ContentCampaign["status"],
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function mapPost(row: DbRow, campaignName: string | null): ContentPost {
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

export async function listCalendarWorkspaceData(
  client: SupabaseClient,
  workspaceId: string,
  options?: { query?: string; limit?: number },
): Promise<CalendarListPayload> {
  const limit = options?.limit ?? 200;
  const query = options?.query?.trim();

  let campaignsQuery = client
    .from("content_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    campaignsQuery = campaignsQuery.or(`name.ilike.${q},description.ilike.${q}`);
  }

  let postsQuery = client
    .from("content_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    postsQuery = postsQuery.or(`title.ilike.${q},body.ilike.${q}`);
  }

  const [campaignsRes, postsRes] = await Promise.all([campaignsQuery, postsQuery]);
  if (campaignsRes.error) throw campaignsRes.error;
  if (postsRes.error) throw postsRes.error;

  const campaigns = (campaignsRes.data ?? []).map((row) => mapCampaign(row as DbRow));
  const campaignNameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const posts = (postsRes.data ?? []).map((row) => {
    const r = row as DbRow;
    const campaignId = r.campaign_id ? String(r.campaign_id) : null;
    const campaignName = campaignId ? (campaignNameById.get(campaignId) ?? null) : null;
    return mapPost(r, campaignName);
  });

  return { campaigns, posts };
}
