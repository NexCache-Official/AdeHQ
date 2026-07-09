import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSearchCacheKey } from "./search-cache";
import { nowISO } from "@/lib/utils";

const INFLIGHT_TTL_MS = 3 * 60 * 1000;
const WAIT_POLL_MS = 400;
const MAX_WAIT_MS = 12_000;

export type TopicSearchCoordination = {
  cacheKey: string;
  acquired: boolean;
  sharedFromRunId?: string;
  waitedMs?: number;
};

export async function coordinateTopicSearch(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    topicId: string;
    query: string;
    agentRunId: string;
  },
): Promise<TopicSearchCoordination> {
  const cacheKey = normalizeSearchCacheKey(params.query);
  const expiresAt = new Date(Date.now() + INFLIGHT_TTL_MS).toISOString();

  const { data: existing } = await client
    .from("topic_search_inflight")
    .select("agent_run_id, status, shared_from_run_id, result_message_id")
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .eq("cache_key", cacheKey)
    .gt("expires_at", nowISO())
    .maybeSingle();

  if (existing?.status === "completed" && existing.agent_run_id !== params.agentRunId) {
    return {
      cacheKey,
      acquired: false,
      sharedFromRunId: existing.shared_from_run_id ?? existing.agent_run_id,
    };
  }

  if (existing?.status === "running" && existing.agent_run_id !== params.agentRunId) {
    const waited = await waitForTopicSearchCompletion(client, {
      workspaceId: params.workspaceId,
      topicId: params.topicId,
      cacheKey,
    });
    if (waited) {
      return {
        cacheKey,
        acquired: false,
        sharedFromRunId: waited.sharedFromRunId,
        waitedMs: waited.waitedMs,
      };
    }
  }

  const { error } = await client.from("topic_search_inflight").upsert(
    {
      workspace_id: params.workspaceId,
      topic_id: params.topicId,
      cache_key: cacheKey,
      agent_run_id: params.agentRunId,
      status: "running",
      shared_from_run_id: null,
      result_message_id: null,
      expires_at: expiresAt,
      updated_at: nowISO(),
    },
    { onConflict: "workspace_id,topic_id,cache_key" },
  );

  if (error) {
    console.warn("[AdeHQ topic-search] acquire failed", error.message);
    return { cacheKey, acquired: true };
  }

  return { cacheKey, acquired: true };
}

async function waitForTopicSearchCompletion(
  client: SupabaseClient,
  params: { workspaceId: string; topicId: string; cacheKey: string },
): Promise<{ sharedFromRunId: string; waitedMs: number } | null> {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const { data } = await client
      .from("topic_search_inflight")
      .select("agent_run_id, status, shared_from_run_id")
      .eq("workspace_id", params.workspaceId)
      .eq("topic_id", params.topicId)
      .eq("cache_key", params.cacheKey)
      .maybeSingle();

    if (data?.status === "completed") {
      return {
        sharedFromRunId: String(data.shared_from_run_id ?? data.agent_run_id),
        waitedMs: Date.now() - started,
      };
    }
    if (!data || data.status === "failed") return null;
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
  return null;
}

export async function completeTopicSearch(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    topicId: string;
    cacheKey: string;
    agentRunId: string;
    resultMessageId?: string;
    sharedFromRunId?: string;
  },
): Promise<void> {
  await client
    .from("topic_search_inflight")
    .update({
      status: "completed",
      result_message_id: params.resultMessageId ?? null,
      shared_from_run_id: params.sharedFromRunId ?? params.agentRunId,
      updated_at: nowISO(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .eq("cache_key", params.cacheKey);
}

export async function failTopicSearch(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    topicId: string;
    cacheKey: string;
  },
): Promise<void> {
  await client
    .from("topic_search_inflight")
    .update({ status: "failed", updated_at: nowISO() })
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .eq("cache_key", params.cacheKey);
}
