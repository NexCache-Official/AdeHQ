import type { SupabaseClient } from "@supabase/supabase-js";

export type StoredWorkAction = {
  id: string;
  actionType: string;
  resultPayload: Record<string, unknown>;
  status: string;
};

export async function findWorkAction(
  client: SupabaseClient,
  params: { workspaceId: string; clientActionId: string },
): Promise<StoredWorkAction | null> {
  const { data, error } = await client
    .from("email_work_actions")
    .select("id, action_type, result_payload, status")
    .eq("workspace_id", params.workspaceId)
    .eq("client_action_id", params.clientActionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    actionType: String(data.action_type),
    resultPayload: (data.result_payload as Record<string, unknown>) ?? {},
    status: String(data.status),
  };
}

export async function completeWorkAction(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
    clientActionId: string;
    actionType: string;
    actorUserId: string;
    resultPayload: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("email_work_actions").insert({
    workspace_id: params.workspaceId,
    mailbox_id: params.mailboxId,
    thread_id: params.threadId,
    client_action_id: params.clientActionId,
    action_type: params.actionType,
    actor_user_id: params.actorUserId,
    status: "completed",
    result_payload: params.resultPayload,
  });
  if (error) {
    // Race: another request completed first — ignore unique violation.
    if (error.code === "23505") return;
    throw error;
  }
}
