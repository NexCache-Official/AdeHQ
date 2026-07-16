/**
 * POST /api/inbox/approvals/[approvalId]/decide — approve or reject.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { AuthError } from "@/lib/supabase/auth-server";
import { recordEmailEvent } from "@/lib/inbox/audit";
import {
  computeApprovalHash,
  type SendEnvelope,
} from "@/lib/inbox/steward/envelope";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const { approvalId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      decision?: "approve" | "reject";
      reason?: string;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "approve_ai_send");
    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
    }

    const { data: approval } = await ctx.secret
      .from("email_approvals")
      .select("*")
      .eq("id", approvalId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (!approval) throw new AuthError("Approval not found.", 404);
    if (approval.status !== "pending") {
      return NextResponse.json({ error: "Approval is not pending." }, { status: 409 });
    }
    if (approval.expires_at && new Date(String(approval.expires_at)).getTime() < Date.now()) {
      await ctx.secret
        .from("email_approvals")
        .update({ status: "invalidated" })
        .eq("id", approvalId);
      return NextResponse.json({ error: "Approval has expired." }, { status: 409 });
    }

    const { data: version } = await ctx.secret
      .from("email_draft_versions")
      .select("*")
      .eq("id", approval.draft_version_id)
      .maybeSingle();
    if (!version) throw new AuthError("Version missing.", 404);

    const { data: draft } = await ctx.secret
      .from("email_drafts")
      .select("*")
      .eq("id", approval.draft_id)
      .maybeSingle();
    if (!draft) throw new AuthError("Draft missing.", 404);

    // Recompute envelope hash — reject if draft changed.
    const envelope: SendEnvelope = {
      mailboxId: String(approval.mailbox_id ?? ctx.mailbox.id),
      fromAddress: String(approval.from_address ?? ctx.mailbox.address),
      replyTo: (approval.reply_to as string) ?? null,
      to: (version.to_addresses as string[]) ?? [],
      cc: (version.cc_addresses as string[]) ?? [],
      bcc: (version.bcc_addresses as string[]) ?? [],
      subject: String(version.subject ?? ""),
      textBody: String(version.text_body ?? ""),
      htmlBody: String(version.html_body ?? ""),
      attachmentIds: [],
      attachmentContentHashes: [],
      threadId: String(draft.thread_id ?? ""),
      draftVersionId: String(version.id),
    };
    const hash = computeApprovalHash(envelope);
    if (hash !== approval.approval_hash) {
      await ctx.secret
        .from("email_approvals")
        .update({ status: "invalidated" })
        .eq("id", approvalId);
      return NextResponse.json(
        { error: "Draft envelope changed. Request a new approval." },
        { status: 409 },
      );
    }

    const { syncThreadMissionStatus } = await import(
      "@/lib/integrations/sync-email-draft-approvals"
    );

    if (body.decision === "reject") {
      await ctx.secret
        .from("email_approvals")
        .update({
          status: "rejected",
          rejected_by: ctx.user.id,
          rejected_at: new Date().toISOString(),
          rejection_reason: body.reason ?? null,
        })
        .eq("id", approvalId);
      await ctx.secret
        .from("email_drafts")
        .update({ status: "draft" })
        .eq("id", draft.id);
      if (draft.thread_id) {
        await syncThreadMissionStatus(ctx.secret, {
          workspaceId: ctx.workspaceId,
          threadId: String(draft.thread_id),
          status: "awaiting_human",
        });
      }
      await recordEmailEvent(ctx.secret, {
        workspaceId: ctx.workspaceId,
        mailboxId: ctx.mailbox.id,
        threadId: draft.thread_id ? String(draft.thread_id) : null,
        actorType: "human",
        actorId: ctx.user.id,
        eventType: "email.approval_rejected",
        payload: { approvalId, reason: body.reason ?? null },
      });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    await ctx.secret
      .from("email_approvals")
      .update({
        status: "approved",
        approved_by: ctx.user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", approvalId);

    await ctx.secret
      .from("email_drafts")
      .update({ status: "approved" })
      .eq("id", draft.id);

    if (draft.thread_id) {
      await ctx.secret
        .from("email_threads")
        .update({ latest_valid_approval_id: approvalId })
        .eq("id", draft.thread_id);
      await syncThreadMissionStatus(ctx.secret, {
        workspaceId: ctx.workspaceId,
        threadId: String(draft.thread_id),
        status: "pending_send",
      });
    }

    await recordEmailEvent(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId: draft.thread_id ? String(draft.thread_id) : null,
      actorType: "human",
      actorId: ctx.user.id,
      eventType: "email.approval_approved",
      payload: {
        approvalId,
        envelope: {
          from: envelope.fromAddress,
          to: envelope.to,
          cc: envelope.cc,
          bcc: envelope.bcc,
          subject: envelope.subject,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      status: "approved",
      envelope: {
        from: envelope.fromAddress,
        to: envelope.to,
        cc: envelope.cc,
        bcc: envelope.bcc,
        subject: envelope.subject,
      },
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
