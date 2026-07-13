/**
 * Apply Resend delivery webhooks to outbox + message rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEmailEvent } from "@/lib/inbox/audit";
import type { OutboxStatus } from "@/lib/inbox/types";

function mapEventToStatus(eventType: string): OutboxStatus | null {
  switch (eventType) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.failed":
      return "failed";
    default:
      return null;
  }
}

export async function applyDeliveryEvent(
  client: SupabaseClient,
  params: {
    eventType: string;
    providerMessageId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  if (!params.providerMessageId) return;
  const status = mapEventToStatus(params.eventType);
  if (!status) return;

  const { data: outbox } = await client
    .from("email_outbox")
    .select("id, workspace_id, mailbox_id, thread_id, message_id")
    .eq("provider_message_id", params.providerMessageId)
    .maybeSingle();

  if (outbox) {
    await client
      .from("email_outbox")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", outbox.id);

    if (outbox.message_id) {
      const patch: Record<string, unknown> = { delivery_status: status };
      if (status === "bounced" || status === "failed" || status === "complained") {
        const data = params.payload.data as
          | { bounce?: { message?: string }; error?: { message?: string } }
          | undefined;
        const reason =
          data?.bounce?.message ||
          data?.error?.message ||
          (status === "bounced"
            ? "Delivery bounced — the address may be invalid or unreachable."
            : status === "complained"
              ? "Recipient marked this as spam."
              : "Delivery failed.");
        const { data: existing } = await client
          .from("email_messages")
          .select("headers")
          .eq("id", outbox.message_id)
          .maybeSingle();
        patch.headers = {
          ...((existing?.headers as Record<string, string>) ?? {}),
          "X-AdeHQ-Delivery-Error": reason.slice(0, 500),
        };
      }
      await client.from("email_messages").update(patch).eq("id", outbox.message_id);
    }

    await recordEmailEvent(client, {
      workspaceId: String(outbox.workspace_id),
      mailboxId: outbox.mailbox_id ? String(outbox.mailbox_id) : null,
      threadId: outbox.thread_id ? String(outbox.thread_id) : null,
      messageId: outbox.message_id ? String(outbox.message_id) : null,
      actorType: "provider",
      eventType: params.eventType,
      payload: { providerMessageId: params.providerMessageId },
    });

    if (status === "bounced" || status === "complained") {
      const data = params.payload.data as { to?: string[] } | undefined;
      const addresses = data?.to ?? [];
      for (const address of addresses) {
        await client.from("email_suppressions").upsert(
          {
            workspace_id: outbox.workspace_id,
            address: address.toLowerCase(),
            reason: status === "bounced" ? "bounce" : "complaint",
            source_message_id: outbox.message_id,
          },
          { onConflict: "workspace_id,address" },
        );
      }
    }
    return;
  }

  // Fallback: match message by provider_message_id
  const { data: message } = await client
    .from("email_messages")
    .select("id, workspace_id, mailbox_id, thread_id")
    .eq("provider_message_id", params.providerMessageId)
    .maybeSingle();

  if (message) {
    await client
      .from("email_messages")
      .update({ delivery_status: status })
      .eq("id", message.id);
    await recordEmailEvent(client, {
      workspaceId: String(message.workspace_id),
      mailboxId: message.mailbox_id ? String(message.mailbox_id) : null,
      threadId: message.thread_id ? String(message.thread_id) : null,
      messageId: String(message.id),
      actorType: "provider",
      eventType: params.eventType,
      payload: { providerMessageId: params.providerMessageId },
    });
  }
}
