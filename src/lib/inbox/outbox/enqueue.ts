/**
 * Outbound outbox — DB-first enqueue with idempotency key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getInboxDomain } from "@/lib/inbox/config";
import { buildOutboundMessageId } from "@/lib/inbox/threading";

export type EnqueueOutboundParams = {
  workspaceId: string;
  mailboxId: string;
  threadId?: string | null;
  draftId?: string | null;
  draftVersionId?: string | null;
  approvalId?: string | null;
  fromAddress: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  inReplyTo?: string | null;
  references?: string | null;
  sentByType: "human" | "ai_employee" | "system";
  sentById: string;
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
};

export async function enqueueOutbound(
  client: SupabaseClient,
  params: EnqueueOutboundParams,
): Promise<{ outboxId: string; idempotencyKey: string }> {
  const idempotencyKey = crypto.randomUUID();
  const domain = getInboxDomain();
  const messageIdHeader = buildOutboundMessageId(domain);
  const headers: Record<string, string> = {
    "Message-ID": messageIdHeader,
    "X-AdeHQ-Outbox": idempotencyKey,
  };
  if (params.inReplyTo) headers["In-Reply-To"] = params.inReplyTo;
  if (params.references) headers.References = params.references;

  const { data, error } = await client
    .from("email_outbox")
    .insert({
      workspace_id: params.workspaceId,
      mailbox_id: params.mailboxId,
      thread_id: params.threadId ?? null,
      draft_id: params.draftId ?? null,
      draft_version_id: params.draftVersionId ?? null,
      approval_id: params.approvalId ?? null,
      status: "queued",
      idempotency_key: idempotencyKey,
      from_address: params.fromAddress,
      from_name: params.fromName ?? null,
      to_addresses: params.to,
      cc_addresses: params.cc ?? [],
      bcc_addresses: params.bcc ?? [],
      subject: params.subject,
      text_body: params.textBody ?? null,
      html_body: params.htmlBody ?? null,
      headers,
      attachment_payload: params.attachments ?? [],
      sent_by_type: params.sentByType,
      sent_by_id: params.sentById,
    })
    .select("id")
    .single();

  if (error) throw error;

  void import("./process")
    .then(({ processOutboxItem }) => processOutboxItem(client, String(data.id)))
    .catch((err) => console.warn("[inbox] outbox nudge failed", err));

  return { outboxId: String(data.id), idempotencyKey };
}
