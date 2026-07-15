/**
 * POST /api/inbox/send — idempotent send (clientSendId).
 * Provider delivery is delayed by the undo window; the client (or cron drain)
 * flushes the outbox after undoUntil. Draft closes only after a successful send.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { enqueueOutbound } from "@/lib/inbox/outbox/enqueue";
import type { OutboxStatus, SendResultDTO } from "@/lib/inbox/types";

export const runtime = "nodejs";

function asAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      clientSendId?: string;
      draftId?: string | null;
      threadId?: string | null;
      to?: string[] | string;
      cc?: string[] | string;
      bcc?: string[] | string;
      subject?: string;
      body?: string;
      htmlBody?: string;
      attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
    };

    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");

    if (!body.clientSendId || !body.clientSendId.trim()) {
      return NextResponse.json({ error: "clientSendId required" }, { status: 400 });
    }
    const to = asAddressList(body.to);
    if (to.length === 0) {
      return NextResponse.json({ error: "At least one recipient is required." }, { status: 400 });
    }

    // AI-origin drafts: server-side approval gate (never trust client).
    if (body.draftId) {
      const { data: draft } = await ctx.secret
        .from("email_drafts")
        .select(
          "id, origin_type, requires_approval, current_version_id, is_stale, status, thread_id",
        )
        .eq("id", body.draftId)
        .eq("mailbox_id", ctx.mailbox.id)
        .maybeSingle();
      if (draft && (draft.origin_type === "ai_employee" || draft.requires_approval)) {
        if (draft.is_stale) {
          return NextResponse.json(
            { error: "Draft is outdated. Regenerate before sending." },
            { status: 409 },
          );
        }
        const { data: approval } = await ctx.secret
          .from("email_approvals")
          .select("*")
          .eq("draft_id", draft.id)
          .eq("draft_version_id", draft.current_version_id)
          .eq("status", "approved")
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!approval) {
          return NextResponse.json(
            { error: "AI drafts require version-locked approval before send." },
            { status: 403 },
          );
        }
        if (approval.expires_at && new Date(String(approval.expires_at)).getTime() < Date.now()) {
          return NextResponse.json({ error: "Approval has expired." }, { status: 403 });
        }
        const { computeApprovalHash } = await import("@/lib/inbox/steward/envelope");
        const { data: version } = await ctx.secret
          .from("email_draft_versions")
          .select("*")
          .eq("id", draft.current_version_id)
          .maybeSingle();
        if (!version) {
          return NextResponse.json({ error: "Draft version missing." }, { status: 409 });
        }
        const hash = computeApprovalHash({
          mailboxId: ctx.mailbox.id,
          fromAddress: String(approval.from_address ?? ctx.mailbox.address),
          replyTo: (approval.reply_to as string) ?? null,
          to: asAddressList(body.to),
          cc: asAddressList(body.cc),
          bcc: asAddressList(body.bcc),
          subject: body.subject ?? "",
          textBody: (body.body ?? "").trim(),
          htmlBody: (body.htmlBody ?? "").trim(),
          attachmentIds: [],
          attachmentContentHashes: [],
          threadId: String(draft.thread_id ?? body.threadId ?? ""),
          draftVersionId: String(version.id),
        });
        if (hash !== approval.approval_hash) {
          return NextResponse.json(
            { error: "Send envelope does not match the approved version." },
            { status: 403 },
          );
        }
      }
    }

    // Suppressions check
    for (const addr of to) {
      const { data: suppressed } = await ctx.secret
        .from("email_suppressions")
        .select("address")
        .eq("workspace_id", ctx.workspaceId)
        .eq("address", addr)
        .maybeSingle();
      if (suppressed) {
        return NextResponse.json(
          { error: `Recipient ${addr} is suppressed (bounce/complaint).` },
          { status: 400 },
        );
      }
    }

    const textBody = (body.body ?? "").trim();
    const htmlBody =
      body.htmlBody?.trim() ||
      (textBody ? textToHtml(textBody) : undefined);

    const attachments = Array.isArray(body.attachments)
      ? body.attachments
          .filter((a) => a?.filename && a?.contentBase64)
          .slice(0, 10)
          .map((a) => ({
            filename: String(a.filename).slice(0, 200),
            contentBase64: String(a.contentBase64),
            contentType: a.contentType ? String(a.contentType).slice(0, 120) : undefined,
          }))
      : undefined;

    let inReplyTo: string | null = null;
    let references: string | null = null;
    if (body.threadId) {
      const { data: last } = await ctx.secret
        .from("email_messages")
        .select("message_id_header, references_header")
        .eq("thread_id", body.threadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.message_id_header) {
        inReplyTo = String(last.message_id_header);
        references = last.references_header
          ? `${last.references_header} ${last.message_id_header}`
          : String(last.message_id_header);
      }
    }

    const result = await enqueueOutbound(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId: body.threadId ?? null,
      draftId: body.draftId ?? null,
      fromAddress: ctx.mailbox.address,
      fromName: ctx.mailbox.displayName || null,
      to,
      cc: asAddressList(body.cc),
      bcc: asAddressList(body.bcc),
      subject: body.subject ?? "",
      textBody: textBody || undefined,
      htmlBody: htmlBody || undefined,
      inReplyTo,
      references,
      sentByType: "human",
      sentById: ctx.user.id,
      clientSendId: body.clientSendId.trim(),
      attachments,
    });

    // Close any pending chat email.sendDraft cards for this draft so DMs update live.
    if (body.draftId) {
      const { syncPendingEmailSendApprovals } = await import(
        "@/lib/integrations/sync-email-draft-approvals"
      );
      await syncPendingEmailSendApprovals(ctx.secret, {
        workspaceId: ctx.workspaceId,
        draftId: body.draftId,
        status: "approved",
        resolvedBy: ctx.user.id,
        note: "Sent from Inbox",
      });
    }

    const { data: outbox } = await ctx.secret
      .from("email_outbox")
      .select("status, message_id, thread_id")
      .eq("id", result.outboxId)
      .maybeSingle();

    const payload: SendResultDTO = {
      outboxId: result.outboxId,
      status: (outbox?.status as OutboxStatus) ?? "queued",
      deduped: result.deduped,
      threadId: (outbox?.thread_id as string) ?? body.threadId ?? null,
      messageId: (outbox?.message_id as string) ?? null,
      undoUntil: result.undoUntil,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

function textToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
