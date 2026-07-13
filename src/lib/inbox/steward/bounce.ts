/**
 * Bounce mail is delivery state for outbound messages — not a customer thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { headerGet } from "@/lib/inbox/threading";

const BOUNCE_FROM =
  /mailer-daemon|postmaster|mail-daemon|noreply.*bounce|bounce@/i;
const BOUNCE_SUBJECT =
  /undeliverable|delivery (status|failure|failed)|returned mail|mail delivery failed|failure notice/i;

export function looksLikeBounceMessage(input: {
  fromAddress: string | null;
  subject: string;
  headers?: Record<string, string>;
}): boolean {
  const from = input.fromAddress ?? "";
  if (BOUNCE_FROM.test(from)) return true;
  if (BOUNCE_SUBJECT.test(input.subject ?? "")) return true;
  const contentType = headerGet(input.headers ?? {}, "content-type") ?? "";
  if (/delivery-status|report-type=delivery-status/i.test(contentType)) return true;
  return false;
}

/**
 * Update the original outbound message/outbox from an inbound bounce DSN.
 * Returns true when handled (caller should not create a normal inbox thread).
 */
export async function handleInboundBounceAsDelivery(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    fromAddress: string | null;
    subject: string;
    textBody: string | null;
    headers: Record<string, string>;
    eventId: string;
  },
): Promise<boolean> {
  if (
    !looksLikeBounceMessage({
      fromAddress: params.fromAddress,
      subject: params.subject,
      headers: params.headers,
    })
  ) {
    return false;
  }

  const inReplyTo = headerGet(params.headers, "in-reply-to");
  const references = headerGet(params.headers, "references");
  const candidates: string[] = [];
  if (inReplyTo) candidates.push(inReplyTo);
  if (references) {
    for (const part of references.split(/\s+/)) {
      const t = part.trim();
      if (t) candidates.push(t);
    }
  }

  let outbound: {
    id: string;
    thread_id: string | null;
    outbox_id: string | null;
  } | null = null;

  for (const mid of candidates) {
    const { data } = await client
      .from("email_messages")
      .select("id, thread_id, outbox_id")
      .eq("workspace_id", params.workspaceId)
      .eq("mailbox_id", params.mailboxId)
      .eq("direction", "outbound")
      .eq("message_id_header", mid)
      .maybeSingle();
    if (data) {
      outbound = {
        id: String(data.id),
        thread_id: data.thread_id ? String(data.thread_id) : null,
        outbox_id: data.outbox_id ? String(data.outbox_id) : null,
      };
      break;
    }
  }

  // Fallback: recent outbound with matching recipient mentioned in bounce body.
  if (!outbound) {
    const { data: recent } = await client
      .from("email_messages")
      .select("id, thread_id, outbox_id, to_addresses")
      .eq("workspace_id", params.workspaceId)
      .eq("mailbox_id", params.mailboxId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(20);
    const body = (params.textBody ?? "").toLowerCase();
    for (const row of recent ?? []) {
      const tos = (row.to_addresses as string[]) ?? [];
      if (tos.some((t) => t && body.includes(t.toLowerCase()))) {
        outbound = {
          id: String(row.id),
          thread_id: row.thread_id ? String(row.thread_id) : null,
          outbox_id: row.outbox_id ? String(row.outbox_id) : null,
        };
        break;
      }
    }
  }

  const reason =
    "Delivery bounced — the address may be invalid or unreachable.".slice(0, 500);

  if (outbound) {
    const { data: existing } = await client
      .from("email_messages")
      .select("headers")
      .eq("id", outbound.id)
      .maybeSingle();
    await client
      .from("email_messages")
      .update({
        delivery_status: "bounced",
        headers: {
          ...((existing?.headers as Record<string, string>) ?? {}),
          "X-AdeHQ-Delivery-Error": reason,
        },
      })
      .eq("id", outbound.id);

    if (outbound.outbox_id) {
      await client
        .from("email_outbox")
        .update({ status: "bounced", updated_at: new Date().toISOString() })
        .eq("id", outbound.outbox_id);
    }

    await recordEmailEvent(client, {
      workspaceId: params.workspaceId,
      mailboxId: params.mailboxId,
      threadId: outbound.thread_id,
      messageId: outbound.id,
      actorType: "provider",
      eventType: "email.bounced",
      payload: {
        source: "inbound_dsn",
        inboundEventId: params.eventId,
        from: params.fromAddress,
      },
    });
  } else {
    await recordEmailEvent(client, {
      workspaceId: params.workspaceId,
      mailboxId: params.mailboxId,
      actorType: "provider",
      eventType: "email.bounced",
      payload: {
        source: "inbound_dsn_unmatched",
        inboundEventId: params.eventId,
        from: params.fromAddress,
        subject: params.subject,
      },
    });
  }

  return true;
}
