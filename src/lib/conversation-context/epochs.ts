import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";

export const CURRENT_CONTEXT_EPOCH_METADATA_KEY = "currentContextEpochId";
export const CHAT_CLEARED_AT_COLUMN = "chat_cleared_at";

type DbRow = Record<string, unknown>;

function isMissingRelationError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message)
        : "";
  return msg.includes("does not exist") || msg.includes("Could not find the table");
}

export type ConversationContextEpoch = {
  id: string;
  workspaceId: string;
  scopeType: "room" | "topic" | "dm";
  scopeId: string;
  sequence: number;
  startedAt: string;
  clearedAt: string | null;
  metadata: Record<string, unknown>;
};

function epochFromRow(row: DbRow): ConversationContextEpoch {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    scopeType: String(row.scope_type) as ConversationContextEpoch["scopeType"],
    scopeId: String(row.scope_id),
    sequence: Number(row.sequence ?? 1),
    startedAt: String(row.started_at),
    clearedAt: row.cleared_at ? String(row.cleared_at) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function fetchTopicContextEpochId(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("topics")
    .select("current_context_epoch_id, metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.current_context_epoch_id) return String(data.current_context_epoch_id);
  const metadata = (data.metadata as Record<string, unknown>) ?? {};
  const legacy = metadata[CURRENT_CONTEXT_EPOCH_METADATA_KEY];
  return typeof legacy === "string" && legacy.trim() ? legacy : null;
}

export async function fetchTopicChatClearedAtColumn(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("topics")
    .select("chat_cleared_at, metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.chat_cleared_at) return String(data.chat_cleared_at);
  const metadata = (data.metadata as Record<string, unknown>) ?? {};
  const legacy = metadata.chatClearedAt;
  return typeof legacy === "string" && legacy.trim() ? legacy : null;
}

/** Resolve the active conversation boundary timestamp for scoping summaries and context. */
export async function resolveTopicConversationBoundary(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<{ chatClearedAt: string | null; epochId: string | null }> {
  const [chatClearedAt, epochId] = await Promise.all([
    fetchTopicChatClearedAtColumn(client, workspaceId, topicId),
    fetchTopicContextEpochId(client, workspaceId, topicId),
  ]);
  return { chatClearedAt, epochId };
}

export async function startConversationContextEpoch(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    scopeType: "room" | "topic" | "dm";
    scopeId: string;
    clearedBy?: string | null;
    clearReason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ConversationContextEpoch | null> {
  const timestamp = nowISO();

  const { data: prior, error: priorError } = await client
    .from("conversation_context_epochs")
    .select("sequence")
    .eq("workspace_id", params.workspaceId)
    .eq("scope_type", params.scopeType)
    .eq("scope_id", params.scopeId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorError && !isMissingRelationError(priorError)) throw priorError;

  const sequence = prior?.sequence != null ? Number(prior.sequence) + 1 : 1;

  const { data: epochRow, error: epochError } = await client
    .from("conversation_context_epochs")
    .insert({
      workspace_id: params.workspaceId,
      scope_type: params.scopeType,
      scope_id: params.scopeId,
      sequence,
      started_at: timestamp,
      cleared_at: null,
      cleared_by: params.clearedBy ?? null,
      clear_reason: params.clearReason ?? null,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .maybeSingle();

  if (epochError) {
    if (isMissingRelationError(epochError)) return null;
    throw epochError;
  }

  if (!epochRow) return null;
  return epochFromRow(epochRow as DbRow);
}

export async function markTopicConversationCleared(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    scopeType?: "room" | "topic" | "dm";
    clearedBy?: string | null;
  },
): Promise<{ chatClearedAt: string; epochId: string | null }> {
  const timestamp = nowISO();
  const scopeType = params.scopeType ?? "topic";

  const epoch = await startConversationContextEpoch(client, {
    workspaceId: params.workspaceId,
    scopeType,
    scopeId: params.topicId,
    clearedBy: params.clearedBy ?? null,
    clearReason: "chat_history_cleared",
  });

  const { data: topicRow, error: topicFetchError } = await client
    .from("topics")
    .select("metadata")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.topicId)
    .maybeSingle();
  if (topicFetchError) throw topicFetchError;

  const metadata = { ...((topicRow?.metadata as Record<string, unknown>) ?? {}) };
  metadata.chatClearedAt = timestamp;
  if (epoch?.id) metadata[CURRENT_CONTEXT_EPOCH_METADATA_KEY] = epoch.id;

  const patch: Record<string, unknown> = {
    metadata,
    chat_cleared_at: timestamp,
    updated_at: timestamp,
  };
  if (epoch?.id) patch.current_context_epoch_id = epoch.id;

  const { error: topicError } = await client
    .from("topics")
    .update(patch)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.topicId);
  if (topicError) throw topicError;

  await client
    .from("topic_orchestration_state")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .then(({ error }) => {
      if (error && !isMissingRelationError(error)) throw error;
    });

  return { chatClearedAt: timestamp, epochId: epoch?.id ?? null };
}
