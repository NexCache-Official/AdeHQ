/**
 * Outbound outbox — DB-first enqueue with idempotency key + clientSendId.
 * Actual provider send is delayed by UNDO_SEND_MS so the UI can cancel/undo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getInboxDomain } from "@/lib/inbox/config";
import { buildOutboundMessageId } from "@/lib/inbox/threading";
import { undoUntilIso } from "@/lib/inbox/outbox/undo";

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
  /** Client-supplied idempotency key — unique per mailbox. */
  clientSendId?: string | null;
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
};

export type EnqueueOutboundResult = {
  outboxId: string;
  idempotencyKey: string;
  deduped: boolean;
  /** ISO timestamp — cancel is allowed until this moment while status=queued. */
  undoUntil: string;
};

export async function enqueueOutbound(
  client: SupabaseClient,
  params: EnqueueOutboundParams,
): Promise<EnqueueOutboundResult> {
  const clientSendId = params.clientSendId?.trim() || null;

  if (clientSendId) {
    const existing = await client
      .from("email_outbox")
      .select("id, idempotency_key")
      .eq("mailbox_id", params.mailboxId)
      .eq("client_send_id", clientSendId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const { data: row } = await client
        .from("email_outbox")
        .select("created_at")
        .eq("id", existing.data.id)
        .maybeSingle();
      const created = row?.created_at ? new Date(String(row.created_at)).getTime() : Date.now();
      return {
        outboxId: String(existing.data.id),
        idempotencyKey: String(existing.data.idempotency_key),
        deduped: true,
        undoUntil: undoUntilIso(created),
      };
    }
  }

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
      client_send_id: clientSendId,
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

  if (error) {
    // Race on (mailbox_id, client_send_id) — return the winner.
    if (error.code === "23505" && clientSendId) {
      const again = await client
        .from("email_outbox")
        .select("id, idempotency_key")
        .eq("mailbox_id", params.mailboxId)
        .eq("client_send_id", clientSendId)
        .maybeSingle();
      if (again.data) {
        return {
          outboxId: String(again.data.id),
          idempotencyKey: String(again.data.idempotency_key),
          deduped: true,
          undoUntil: undoUntilIso(),
        };
      }
    }
    throw error;
  }

  const outboxId = String(data.id);
  return {
    outboxId,
    idempotencyKey,
    deduped: false,
    undoUntil: undoUntilIso(),
  };
}
