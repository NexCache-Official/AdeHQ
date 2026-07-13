/**
 * POST /api/inbox/drafts/[draftId]/approvals — create pending approval for AI draft.
 * POST .../approvals/decide — approve or reject (separate file below).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import {
  approvalExpiryIso,
  computeApprovalHash,
  computeFieldHashes,
  type SendEnvelope,
} from "@/lib/inbox/steward/envelope";
import { AuthError } from "@/lib/supabase/auth-server";
import { recordEmailEvent } from "@/lib/inbox/audit";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      fromAddress?: string;
      replyTo?: string | null;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "approve_ai_send");

    const { data: draft } = await ctx.secret
      .from("email_drafts")
      .select("*")
      .eq("id", draftId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!draft) throw new AuthError("Draft not found.", 404);
    if (!draft.requires_approval && draft.origin_type !== "ai_employee") {
      return NextResponse.json({ error: "This draft does not require approval." }, { status: 400 });
    }
    if (draft.is_stale) {
      return NextResponse.json(
        { error: "Draft is outdated. Regenerate before requesting approval." },
        { status: 409 },
      );
    }
    if (!draft.current_version_id) {
      return NextResponse.json({ error: "Draft has no version." }, { status: 400 });
    }

    const { data: version } = await ctx.secret
      .from("email_draft_versions")
      .select("*")
      .eq("id", draft.current_version_id)
      .maybeSingle();
    if (!version) throw new AuthError("Draft version not found.", 404);

    const { data: mailbox } = await ctx.secret
      .from("workspace_mailboxes")
      .select("canonical_local_part, domain, display_name, approval_ttl_hours, status")
      .eq("id", ctx.mailbox.id)
      .maybeSingle();
    if (!mailbox || mailbox.status !== "active") {
      throw new AuthError("Mailbox is not active.", 400);
    }

    const fromAddress =
      body.fromAddress?.trim() ||
      `${mailbox.canonical_local_part}@${mailbox.domain}`;

    const envelope: SendEnvelope = {
      mailboxId: ctx.mailbox.id,
      fromAddress,
      replyTo: body.replyTo ?? null,
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

    const approvalHash = computeApprovalHash(envelope);
    const fieldHashes = computeFieldHashes(envelope);
    const ttl = Number(mailbox.approval_ttl_hours ?? 48);

    // Invalidate prior pending approvals for this draft.
    await ctx.secret
      .from("email_approvals")
      .update({ status: "invalidated" })
      .eq("draft_id", draftId)
      .eq("status", "pending");

    const { data: approval, error } = await ctx.secret
      .from("email_approvals")
      .insert({
        workspace_id: ctx.workspaceId,
        draft_id: draftId,
        draft_version_id: version.id,
        recipient_hash: fieldHashes.recipientHash,
        subject_hash: fieldHashes.subjectHash,
        body_hash: fieldHashes.bodyHash,
        attachment_hash: fieldHashes.attachmentHash,
        approval_hash: approvalHash,
        status: "pending",
        expires_at: approvalExpiryIso(ttl),
        from_address: fromAddress,
        reply_to: body.replyTo ?? null,
        mailbox_id: ctx.mailbox.id,
        thread_id: draft.thread_id,
      })
      .select("id, expires_at, approval_hash")
      .single();
    if (error) throw error;

    await ctx.secret
      .from("email_drafts")
      .update({ status: "pending_approval" })
      .eq("id", draftId);

    await recordEmailEvent(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId: draft.thread_id ? String(draft.thread_id) : null,
      actorType: "human",
      actorId: ctx.user.id,
      eventType: "email.approval_requested",
      payload: {
        approvalId: approval.id,
        draftId,
        versionId: version.id,
        envelope: {
          from: fromAddress,
          to: envelope.to,
          cc: envelope.cc,
          bcc: envelope.bcc,
          subject: envelope.subject,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      approvalId: approval.id,
      expiresAt: approval.expires_at,
      approvalHash: approval.approval_hash,
      envelope: {
        from: fromAddress,
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
