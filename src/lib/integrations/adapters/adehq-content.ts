import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { ContentPlatform, ContentPostStatus } from "@/lib/calendar/types";
import { nowISO, uid } from "@/lib/utils";
import {
  contentCampaignArtifact,
  contentPostArtifact,
} from "@/lib/integrations/content-message-artifacts";

type CreateCampaignArgs = {
  name: string;
  description?: string;
  status?: "draft" | "active" | "paused" | "completed" | "archived";
  startDate?: string;
  endDate?: string;
  ownerEmployeeId?: string;
};

type DraftPostArgs = {
  title: string;
  body: string;
  campaignId?: string;
  campaignName?: string;
  status?: ContentPostStatus;
  platform?: ContentPlatform;
  scheduledAt?: string;
  sourceMessageId?: string;
};

type ScheduleDraftArgs = {
  postId?: string;
  title?: string;
  scheduledAt: string;
};

async function resolveCampaignId(
  client: SupabaseClient,
  workspaceId: string,
  args: { campaignId?: string; campaignName?: string },
): Promise<string | null> {
  if (args.campaignId?.trim()) return args.campaignId.trim();
  if (!args.campaignName?.trim()) return null;

  const campaignName = args.campaignName.trim();
  const { data, error } = await client
    .from("content_campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", campaignName)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return String(data.id);

  const id = uid("campaign");
  const { error: insertError } = await client.from("content_campaigns").insert({
    workspace_id: workspaceId,
    id,
    name: campaignName,
    status: "draft",
    created_by_type: "ai",
  });
  if (insertError) throw insertError;
  return id;
}

export async function createCampaign(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateCampaignArgs,
): Promise<ToolExecutionOutput> {
  const name = args.name.trim();
  const { data: existing, error: findError } = await client
    .from("content_campaigns")
    .select("id, name, status")
    .eq("workspace_id", ctx.workspaceId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    return {
      summary: `Campaign ${String(existing.name)} already exists — reused existing record.`,
      payload: { campaignId: String(existing.id), deduped: true },
      objectId: String(existing.id),
      workLogAction: "content_campaign_reused",
      messageArtifact: contentCampaignArtifact({
        campaignId: String(existing.id),
        name: String(existing.name),
        status: String(existing.status ?? "draft"),
      }),
    };
  }

  const campaignId = uid("campaign");
  const { error } = await client.from("content_campaigns").insert({
    workspace_id: ctx.workspaceId,
    id: campaignId,
    name,
    description: args.description?.trim() ?? null,
    status: args.status ?? "draft",
    start_date: args.startDate ?? null,
    end_date: args.endDate ?? null,
    owner_employee_id: args.ownerEmployeeId ?? ctx.employeeId,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  return {
    summary: `Created campaign "${name}".`,
    payload: { campaignId, name },
    objectId: campaignId,
    workLogAction: "content_campaign_created",
    messageArtifact: contentCampaignArtifact({
      campaignId,
      name,
      status: args.status ?? "draft",
    }),
  };
}

export async function draftPost(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: DraftPostArgs,
): Promise<ToolExecutionOutput> {
  const title = args.title.trim();
  const postId = uid("post");
  const campaignId = await resolveCampaignId(client, ctx.workspaceId, {
    campaignId: args.campaignId,
    campaignName: args.campaignName,
  });

  const { error } = await client.from("content_posts").insert({
    workspace_id: ctx.workspaceId,
    id: postId,
    campaign_id: campaignId,
    title,
    body: args.body.trim(),
    status: args.status ?? "draft",
    scheduled_at: args.scheduledAt ?? null,
    platform: args.platform ?? "linkedin",
    source_message_id: args.sourceMessageId ?? ctx.triggerMessageId ?? null,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  return {
    summary: `Drafted ${args.platform ?? "linkedin"} post "${title}".`,
    payload: {
      postId,
      campaignId,
      status: args.status ?? "draft",
      platform: args.platform ?? "linkedin",
    },
    objectId: postId,
    workLogAction: "content_post_drafted",
    messageArtifact: contentPostArtifact({
      postId,
      title,
      platform: args.platform ?? "linkedin",
      status: args.status ?? "draft",
    }),
  };
}

export const createContentPost = draftPost;

export async function scheduleDraft(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: ScheduleDraftArgs,
): Promise<ToolExecutionOutput> {
  let post: { id: string; title: string; platform: string | null } | null = null;
  if (args.postId?.trim()) {
    const { data, error } = await client
      .from("content_posts")
      .select("id, title, platform")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", args.postId.trim())
      .maybeSingle();
    if (error) throw error;
    post = data ? { id: String(data.id), title: String(data.title), platform: String(data.platform) } : null;
  } else if (args.title?.trim()) {
    const { data, error } = await client
      .from("content_posts")
      .select("id, title, platform")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("title", `%${args.title.trim()}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    post = data ? { id: String(data.id), title: String(data.title), platform: String(data.platform) } : null;
  }

  if (!post) {
    throw new Error(
      `Post not found${args.title?.trim() ? ` matching "${args.title.trim()}"` : ""}. Use social.draftPost first.`,
    );
  }

  const { error: updateError } = await client
    .from("content_posts")
    .update({
      status: "scheduled_later",
      scheduled_at: args.scheduledAt,
      updated_at: nowISO(),
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", post.id);
  if (updateError) throw updateError;

  return {
    summary: `Scheduled "${post.title}" for ${args.scheduledAt}.`,
    payload: {
      postId: post.id,
      status: "scheduled_later",
      scheduledAt: args.scheduledAt,
      approvalPolicy: "suggested",
    },
    objectId: post.id,
    workLogAction: "content_post_scheduled",
    messageArtifact: contentPostArtifact({
      postId: post.id,
      title: post.title,
      platform: post.platform ?? undefined,
      status: "scheduled_later",
    }),
  };
}
