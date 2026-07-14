/**
 * GET /api/inbox/threads/[threadId] — thread + messages + Slice C triage fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { mapMessageRow } from "@/lib/inbox/mailbox";
import { AuthError } from "@/lib/supabase/auth-server";
import type {
  AttachmentDTO,
  DirectionState,
  DraftJobStatus,
  EmailPriority,
  ThreadDetailDTO,
  ThreadStatus,
  TriageStatus,
} from "@/lib/inbox/types";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );

    const { data: thread, error: threadError } = await ctx.secret
      .from("email_threads")
      .select(
        "id, subject, status, is_spam, direction_state, has_unread, mailbox_id, triage_status, draft_status, category, priority, reply_required, triage_confidence, assignment_confidence, assignment_source, assigned_employee_id, assigned_human_id, suggested_employee_id, steward_meta, latest_draft_id",
      )
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) throw new AuthError("Thread not found.", 404);

    const { data: mailbox } = await ctx.secret
      .from("workspace_mailboxes")
      .select("assistance_mode")
      .eq("id", ctx.mailbox.id)
      .maybeSingle();

    const { data: messages, error: msgError } = await ctx.secret
      .from("email_messages")
      .select(
        "id, direction, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body_sanitised, delivery_status, headers, outbox_id, created_at",
      )
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (msgError) throw msgError;

    const messageIds = (messages ?? []).map((m) => String(m.id));
    const attByMessage = new Map<string, AttachmentDTO[]>();
    if (messageIds.length > 0) {
      const { data: atts } = await ctx.secret
        .from("email_attachments")
        .select("id, message_id, filename, content_type, size_bytes, quarantine_state")
        .in("message_id", messageIds);
      for (const a of atts ?? []) {
        const mid = String(a.message_id);
        const list = attByMessage.get(mid) ?? [];
        list.push({
          id: String(a.id),
          filename: (a.filename as string) ?? null,
          contentType: (a.content_type as string) ?? null,
          sizeBytes: (a.size_bytes as number) ?? null,
          quarantineState: String(a.quarantine_state ?? "clean"),
        });
        attByMessage.set(mid, list);
      }
    }

    const meta = (thread.steward_meta as Record<string, unknown>) ?? {};
    const latestInboundId = [...(messages ?? [])]
      .reverse()
      .find((m) => m.direction === "inbound")?.id;
    const dismissFp = meta.dismissedSuggestionFingerprint
      ? String(meta.dismissedSuggestionFingerprint)
      : null;
    const suggestionDismissed = Boolean(
      dismissFp && latestInboundId && dismissFp === String(latestInboundId),
    );

    const employeeIds = [
      thread.assigned_employee_id,
      thread.suggested_employee_id,
    ].filter(Boolean) as string[];
    const nameById = new Map<string, string>();
    if (employeeIds.length > 0) {
      const { data: employees } = await ctx.secret
        .from("ai_employees")
        .select("id, name")
        .in("id", employeeIds);
      for (const e of employees ?? []) {
        nameById.set(String(e.id), String(e.name ?? "Employee"));
      }
    }
    if (thread.assigned_human_id) {
      const { data: profile } = await ctx.secret
        .from("profiles")
        .select("id, name, email")
        .eq("id", thread.assigned_human_id)
        .maybeSingle();
      if (profile) {
        nameById.set(
          String(profile.id),
          String(profile.name ?? "").trim() || String(profile.email ?? "Teammate"),
        );
      }
    }

    const body: ThreadDetailDTO = {
      id: String(thread.id),
      subject: String(thread.subject ?? "") || "(no subject)",
      status: (thread.status as ThreadStatus) ?? "open",
      isSpam: Boolean(thread.is_spam),
      hasUnread: Boolean(thread.has_unread),
      directionState: (thread.direction_state as DirectionState) ?? "inbound",
      messages: (messages ?? []).map((m) =>
        mapMessageRow(m, attByMessage.get(String(m.id)) ?? []),
      ),
      triageStatus: (thread.triage_status as TriageStatus) ?? "not_started",
      draftStatus: (thread.draft_status as DraftJobStatus) ?? "idle",
      category: (thread.category as string) ?? null,
      priority: (thread.priority as EmailPriority) ?? "normal",
      replyRequired: Boolean(thread.reply_required),
      triageConfidence: Number(thread.triage_confidence ?? 0),
      assignmentConfidence: Number(thread.assignment_confidence ?? 0),
      assignmentSource: (thread.assignment_source as string) ?? null,
      assigneeId:
        (thread.assigned_employee_id as string) ??
        (thread.assigned_human_id as string) ??
        null,
      assigneeKind: thread.assigned_employee_id
        ? "ai_employee"
        : thread.assigned_human_id
          ? "human"
          : null,
      suggestedEmployeeId: (thread.suggested_employee_id as string) ?? null,
      assigneeName: thread.assigned_employee_id
        ? nameById.get(String(thread.assigned_employee_id)) ?? null
        : thread.assigned_human_id
          ? nameById.get(String(thread.assigned_human_id)) ?? null
          : null,
      suggestedEmployeeName: thread.suggested_employee_id
        ? nameById.get(String(thread.suggested_employee_id)) ?? null
        : null,
      keyPoints: Array.isArray(meta.keyPoints)
        ? (meta.keyPoints as string[])
        : [],
      summary: typeof meta.summary === "string" ? meta.summary : null,
      suggestedNextAction:
        typeof meta.suggestedNextAction === "string" ? meta.suggestedNextAction : null,
      matchReason: typeof meta.matchReason === "string" ? meta.matchReason : null,
      suggestionDismissed,
      latestDraftId: (thread.latest_draft_id as string) ?? null,
      assistanceModeSuggestsActions:
        String(mailbox?.assistance_mode) === "ai_triage_suggested_replies",
    };
    return NextResponse.json(body);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
