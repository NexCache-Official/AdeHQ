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
    deliveryStatus: (preview.delivery_status as DeliveryStatus) ?? null,
    assigneeId:
      (row.assigned_employee_id as string) ??
      (row.assigned_human_id as string) ??
      null,
    suggestedEmployeeId: (row.suggested_employee_id as string) ?? null,
    priority: (row.priority as ThreadSummaryDTO["priority"]) ?? "normal",
    replyRequired: Boolean(row.reply_required),
    triageStatus: (row.triage_status as ThreadSummaryDTO["triageStatus"]) ?? "not_started",
    draftStatus: (row.draft_status as ThreadSummaryDTO["draftStatus"]) ?? "idle",
    category: (row.category as string) ?? null,
    aiActivity: buildAiActivity(row),
    labels: Array.isArray(row.__labels)
      ? (row.__labels as Array<{ id: string; name: string; color: string | null }>)
      : [],
  };
}

function buildAiActivity(row: Record<string, unknown>): string | null {
  const draftStatus = String(row.draft_status ?? "idle");
  const triageStatus = String(row.triage_status ?? "not_started");
  const meta = (row.steward_meta as Record<string, unknown>) ?? {};
  if (draftStatus === "queued" || draftStatus === "running") {
    return "Drafting reply…";
  }
  if (triageStatus === "queued" || triageStatus === "running") {
    return "Organising…";
  }
  if (meta.matchReason && row.suggested_employee_id && !row.assigned_employee_id) {
    return String(meta.matchReason);
  }
  if (row.reply_required && meta.suggestedNextAction) {
    return String(meta.suggestedNextAction);
  }
  return null;
}

export function mapMessageRow(
  row: Record<string, unknown>,
  attachments: AttachmentDTO[],
): MessageDTO {
  const headers = (row.headers as Record<string, unknown> | null) ?? {};
  const deliveryError =
    (typeof headers["X-AdeHQ-Delivery-Error"] === "string"
      ? headers["X-AdeHQ-Delivery-Error"]
      : null) ??
    (typeof row.delivery_error === "string" ? row.delivery_error : null);

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
    deliveryError,
    outboxId: (row.outbox_id as string) ?? null,
    createdAt: String(row.created_at),
    attachments,
  };
}

export function mapDraftRow(
  draft: Record<string, unknown>,
  version: Record<string, unknown> | null,
  approval?: {
    status: string | null;
    id: string | null;
    expiresAt: string | null;
  } | null,
): DraftDTO {
  let approvalStatus: DraftDTO["approvalStatus"] = "none";
  if (approval?.status === "pending") {
    const expired =
      approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now();
    approvalStatus = expired ? "expired" : "pending";
  } else if (approval?.status === "approved") {
    approvalStatus = "approved";
  } else if (approval?.status === "rejected") {
    approvalStatus = "rejected";
  } else if (draft.status === "pending_approval") {
    approvalStatus = "pending";
  } else if (draft.status === "approved") {
    approvalStatus = "approved";
  }

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
    originType: (draft.origin_type as "ai_employee" | "human") ?? "human",
    requiresApproval: Boolean(draft.requires_approval),
    isStale: Boolean(draft.is_stale),
    staleReason: (draft.stale_reason as string) ?? null,
    employeeId: (draft.employee_id as string) ?? null,
    versionId: (draft.current_version_id as string) ?? (version?.id as string) ?? null,
    rewriteCount: Number(draft.rewrite_count ?? 0),
    basedOnMessageId: (draft.based_on_message_id as string) ?? null,
    approvalStatus,
    approvalId: approval?.id ?? null,
    approvalExpiresAt: approval?.expiresAt ?? null,
  };
}
