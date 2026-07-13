/**
 * POST /api/inbox/threads/[threadId]/notes — internal note (never customer-visible).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { AuthError } from "@/lib/supabase/auth-server";
import { mapMessageRow } from "@/lib/inbox/mailbox";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      text?: string;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "compose");

    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "Note text is required." }, { status: 400 });
    }

    const { data: thread } = await ctx.secret
      .from("email_threads")
      .select("id, subject")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!thread) throw new AuthError("Thread not found.", 404);

    const { data: message, error } = await ctx.secret
      .from("email_messages")
      .insert({
        workspace_id: ctx.workspaceId,
        mailbox_id: ctx.mailbox.id,
        thread_id: threadId,
        direction: "internal",
        from_address: null,
        from_name: "Internal note",
        to_addresses: [],
        cc_addresses: [],
        bcc_addresses: [],
        subject: String(thread.subject ?? ""),
        text_body: text.slice(0, 20_000),
        html_body_raw: null,
        html_body_sanitised: null,
        headers: { "X-AdeHQ-Internal": "1", "X-AdeHQ-Author": ctx.user.id },
        mailbox_type: "adehq_managed",
        delivery_status: "received",
        security_flags: [],
      })
      .select(
        "id, direction, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body_sanitised, delivery_status, headers, outbox_id, created_at",
      )
      .single();
    if (error) throw error;

    await recordEmailEvent(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId,
      messageId: String(message.id),
      actorType: "human",
      actorId: ctx.user.id,
      eventType: "email.internal_note",
      payload: { length: text.length },
    });

    return NextResponse.json({ message: mapMessageRow(message, []) });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
