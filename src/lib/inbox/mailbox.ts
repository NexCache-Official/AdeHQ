/**
 * Primary mailbox lookup + row → DTO mappers (Slice B).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttachmentDTO,
  DirectionState,
  DraftDTO,
  MailboxDTO,
  MessageDTO,
  ThreadStatus,
  ThreadSummaryDTO,
} from "./types";
import type { DeliveryStatus, MessageDirection } from "./types";

export async function getPrimaryMailbox(
  secret: SupabaseClient,
  workspaceId: string,
): Promise<MailboxDTO | null> {
  const { data, error } = await secret
    .from("workspace_mailboxes")
    .select("id, workspace_id, canonical_local_part, domain, display_name, status")
    .eq("workspace_id", workspaceId)
    .eq("is_primary", true)
    .neq("status", "retired")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    workspaceId: String(data.workspace_id),
    address: `${data.canonical_local_part}@${data.domain}`,
    displayName: String(data.display_name ?? ""),
    status: String(data.status),
  };
}

function snippetFrom(text: string | null, html: string | null): string {
  const base = (text ?? html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, 140);
}

function formatRecipients(to: unknown): string {
  if (!Array.isArray(to) || to.length === 0) return "(no recipient)";
  return to.map((a) => String(a)).join(", ");
}

/**
 * Map a thread row for the list. Pass `__preview_message` as the message that
 * should drive peer/snippet for the active folder (inbound for Inbox, outbound
 * for Sent), and `__peer_kind` as "from" | "to".
 */
export function mapThreadRow(row: Record<string, unknown>): ThreadSummaryDTO {
  const preview = (row.__preview_message ?? row.__last_message ?? {}) as Record<
    string,
    unknown
  >;
  const peerKind = (row.__peer_kind as "from" | "to") ?? "from";
  const direction = String(preview.direction ?? "");

  let peer = "";
  let peerName: string | null = null;
  if (peerKind === "to" || direction === "outbound") {
    peer = formatRecipients(preview.to_addresses);
    peerName = null;
  } else {
    peer = (preview.from_address as string) ?? "";
    peerName = (preview.from_name as string) ?? null;
  }

  return {
    id: String(row.id),
    subject: String(row.subject ?? "") || "(no subject)",
    snippet: snippetFrom(
      (preview.text_body as string) ?? null,
      (preview.html_body_sanitised as string) ?? null,
    ),
    peer,
    peerName,
    peerKind: peerKind === "to" || direction === "outbound" ? "to" : "from",
    timestamp:
      (preview.created_at as string) ?? (row.last_message_at as string) ?? null,
    hasUnread: Boolean(row.has_unread),
    hasAttachments: Boolean(row.__has_attachments),
    directionState: (row.direction_state as DirectionState) ?? "inbound",
    status: (row.status as ThreadStatus) ?? "open",
    isSpam: Boolean(row.is_spam),
    assigneeId: (row.assigned_human_id as string) ?? null,
  };
}

export function mapMessageRow(
  row: Record<string, unknown>,
  attachments: AttachmentDTO[],
): MessageDTO {
  return {
    id: String(row.id),
    direction: (row.direction as MessageDirection) ?? "inbound",
    fromAddress: (row.from_address as string) ?? null,
    fromName: (row.from_name as string) ?? null,
    to: (row.to_addresses as string[]) ?? [],
    cc: (row.cc_addresses as string[]) ?? [],
    bcc: (row.bcc_addresses as string[]) ?? [],
    subject: String(row.subject ?? ""),
    textBody: (row.text_body as string) ?? null,
    htmlSanitised: (row.html_body_sanitised as string) ?? null,
    deliveryStatus: (row.delivery_status as DeliveryStatus) ?? "received",
    createdAt: String(row.created_at),
    attachments,
  };
}

export function mapDraftRow(
  draft: Record<string, unknown>,
  version: Record<string, unknown> | null,
): DraftDTO {
  return {
    id: String(draft.id),
    threadId: (draft.thread_id as string) ?? null,
    status: String(draft.status),
    to: (version?.to_addresses as string[]) ?? [],
    cc: (version?.cc_addresses as string[]) ?? [],
    bcc: (version?.bcc_addresses as string[]) ?? [],
    subject: String(version?.subject ?? ""),
    textBody: (version?.text_body as string) ?? null,
    htmlBody: (version?.html_body as string) ?? null,
    updatedAt: String(draft.updated_at ?? draft.created_at),
  };
}
