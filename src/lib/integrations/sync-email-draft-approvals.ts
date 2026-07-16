/**
 * Keep chat tool approvals (`approvals`) and thread `mission_status` in sync
 * with inbox draft / outbox lifecycle so Inbox, Approvals, and chat agree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveEmailMissionStatus,
  updateEmailMission,
  type EmailMissionStatus,
} from "@/lib/inbox/mission-status";
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

/**
 * Recompute and store mission_status for a thread from draft / approval / outbox.
 * Prefer an explicit override when the caller already knows the transition.
 */
export async function syncThreadMissionStatus(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    threadId: string;
    status?: EmailMissionStatus;
    ownerEmployeeId?: string | null;
  },
): Promise<void> {
  const threadId = params.threadId.trim();
  if (!threadId) return;

  try {
    if (params.status) {
      await updateEmailMission(client, {
        workspaceId: params.workspaceId,
        threadId,
        status: params.status,
        ownerEmployeeId: params.ownerEmployeeId,
      });
      return;
    }

    const { data: thread } = await client
      .from("email_threads")
      .select(
        "mission_status, assigned_employee_id, mission_owner_employee_id, reply_required, latest_direction, draft_status, latest_draft_id, last_wake_at",
      )
      .eq("workspace_id", params.workspaceId)
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) return;

    let draftStatus = thread.draft_status ? String(thread.draft_status) : null;
    let draftRequiresApproval: boolean | null = null;
    let approvalStatus: string | null = null;
    let outboxStatus: string | null = null;

    if (thread.latest_draft_id) {
      const { data: draft } = await client
        .from("email_drafts")
        .select("id, status, requires_approval, current_version_id")
        .eq("id", thread.latest_draft_id)
        .maybeSingle();
      if (draft) {
        draftStatus = String(draft.status);
        draftRequiresApproval = Boolean(draft.requires_approval);
        if (draft.current_version_id) {
          const { data: approval } = await client
            .from("email_approvals")
            .select("status")
            .eq("draft_id", draft.id)
            .eq("draft_version_id", draft.current_version_id)
            .in("status", ["pending", "approved", "rejected"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          approvalStatus = approval?.status ? String(approval.status) : null;
        }
      }

      const { data: outbox } = await client
        .from("email_outbox")
        .select("status")
        .eq("draft_id", thread.latest_draft_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      outboxStatus = outbox?.status ? String(outbox.status) : null;
    }

    const status = deriveEmailMissionStatus({
      currentStatus: thread.mission_status ? String(thread.mission_status) : null,
      assignedEmployeeId: thread.assigned_employee_id
        ? String(thread.assigned_employee_id)
        : null,
      replyRequired: Boolean(thread.reply_required),
      latestDirection: thread.latest_direction ? String(thread.latest_direction) : null,
      draftStatus,
      draftRequiresApproval,
      approvalStatus,
      outboxStatus,
      wakePosted: Boolean(thread.last_wake_at),
    });

    await updateEmailMission(client, {
      workspaceId: params.workspaceId,
      threadId,
      status,
      ownerEmployeeId:
        params.ownerEmployeeId ??
        (thread.mission_owner_employee_id
          ? String(thread.mission_owner_employee_id)
          : thread.assigned_employee_id
            ? String(thread.assigned_employee_id)
            : null),
    });
  } catch (error) {
    console.warn("[AdeHQ sync-thread-mission] failed", error);
  }
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
  threadId: string | null;
} | null> {
  const { data: draft, error } = await client
    .from("email_drafts")
    .select("id, status, current_version_id, thread_id")
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
    threadId: draft.thread_id ? String(draft.thread_id) : null,
  };
}
