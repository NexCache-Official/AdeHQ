/**
 * POST /api/inbox/send — idempotent send (clientSendId). Preserves the draft on
 * failure so the composer can retry with a new clientSendId.
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
    };

    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");

    if (!body.clientSendId || !body.clientSendId.trim()) {
      return NextResponse.json({ error: "clientSendId required" }, { status: 400 });
    }
    const to = asAddressList(body.to);
    if (to.length === 0) {
      return NextResponse.json({ error: "At least one recipient is required." }, { status: 400 });
    }

    const textBody = (body.body ?? "").trim();
    const htmlBody = body.htmlBody ?? textToHtml(textBody);

    // Thread-aware headers for replies.
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
    });

    // Link + close the draft (idempotent — safe on dedupe).
    if (body.draftId) {
      await ctx.secret
        .from("email_drafts")
        .update({ status: "sent" })
        .eq("id", body.draftId)
        .eq("mailbox_id", ctx.mailbox.id);
    }

    // Re-read the outbox row: the async nudge may already have advanced it.
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
