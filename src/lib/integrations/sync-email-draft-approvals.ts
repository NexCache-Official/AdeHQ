/**
 * Keep chat tool approvals (`approvals`) in sync with inbox draft lifecycle.
 * Chat `email.sendDraft` cards stay pending if the human sends/discards from Inbox
 * without resolving the chat card — close those rows so the UI updates live.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";

export type DraftApprovalSyncStatus = "approved" | "rejected";

function draftIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const tool = (payload as { tool?: unknown }).tool;
  if (tool !== "email.sendDraft") return null;
  const args = (payload as { args?: unknown }).args;
  if (!args || typeof args !== "object") return null;
  const draftId = (args as { draftId?: unknown }).draftId;
  return typeof draftId === "string" && draftId.trim() ? draftId.trim() : null;
}

/**
 * Resolve every pending chat approval for `email.sendDraft` on this draft.
 * Best-effort — failures are logged, never thrown to the inbox send path.
 */
export async function syncPendingEmailSendApprovals(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    draftId: string;
    status: DraftApprovalSyncStatus;
    resolvedBy?: string | null;
    note?: string;
  },
): Promise<number> {
  const draftId = params.draftId.trim();
  if (!draftId) return 0;

  const { data: rows, error } = await client
    .from("approvals")
    .select("id, action_payload")
    .eq("workspace_id", params.workspaceId)
    .eq("status", "pending")
    .eq("action_type", "tool_execution");
  if (error) {
    console.warn("[AdeHQ sync-email-draft-approvals] list failed", error);
    return 0;
  }

  const matching = (rows ?? []).filter(
    (row) => draftIdFromPayload(row.action_payload) === draftId,
  );
  if (matching.length === 0) return 0;

  const ids = matching.map((row) => String(row.id));
  const { error: updateError } = await client
    .from("approvals")
    .update({
      status: params.status,
      resolution_note:
        params.note ??
        (params.status === "approved"
          ? "Resolved via Inbox send"
          : "Draft discarded or cancelled"),
      resolved_by: params.resolvedBy ?? null,
      resolved_at: nowISO(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("status", "pending")
    .in("id", ids);

  if (updateError) {
    console.warn("[AdeHQ sync-email-draft-approvals] update failed", updateError);
    return 0;
  }
  return ids.length;
}

/** Enrich send-draft approval args/preview with the live inbox draft content. */
export async function loadEmailDraftForApproval(
  client: SupabaseClient,
  params: { workspaceId: string; draftId: string },
): Promise<{
  subject: string;
  recipientEmail: string;
  body: string;
  status: string;
} | null> {
  const { data: draft, error } = await client
    .from("email_drafts")
    .select("id, status, current_version_id")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.draftId)
    .maybeSingle();
  if (error || !draft?.current_version_id) return null;

  const { data: version, error: verErr } = await client
    .from("email_draft_versions")
    .select("subject, to_addresses, text_body, html_body")
    .eq("id", draft.current_version_id)
    .maybeSingle();
  if (verErr || !version) return null;

  const to = Array.isArray(version.to_addresses)
    ? version.to_addresses.map((a: unknown) => String(a).trim()).filter(Boolean)
    : [];
  const text = String(version.text_body ?? "").trim();
  const html = String(version.html_body ?? "").trim();
  const body =
    text ||
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  return {
    subject: String(version.subject ?? ""),
    recipientEmail: to.join(", "),
    body,
    status: String(draft.status ?? "draft"),
  };
}
