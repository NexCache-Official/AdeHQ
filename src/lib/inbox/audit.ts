import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordEmailEvent(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId?: string | null;
    threadId?: string | null;
    messageId?: string | null;
    actorType?: "human" | "ai_employee" | "system" | "provider" | null;
    actorId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("email_events").insert({
    workspace_id: params.workspaceId,
    mailbox_id: params.mailboxId ?? null,
    thread_id: params.threadId ?? null,
    message_id: params.messageId ?? null,
    actor_type: params.actorType ?? "system",
    actor_id: params.actorId ?? null,
    event_type: params.eventType,
    payload: params.payload ?? {},
  });
  if (error) {
    console.warn("[inbox] email_events insert failed", error.message);
  }
}
