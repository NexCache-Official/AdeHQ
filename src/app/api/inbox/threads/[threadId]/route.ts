/**
 * GET /api/inbox/threads/[threadId] — thread + its messages (bounded).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { mapMessageRow } from "@/lib/inbox/mailbox";
import { AuthError } from "@/lib/supabase/auth-server";
import type {
  AttachmentDTO,
  DirectionState,
  ThreadDetailDTO,
  ThreadStatus,
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
      .select("id, subject, status, is_spam, direction_state, has_unread, mailbox_id")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) throw new AuthError("Thread not found.", 404);

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
    };
    return NextResponse.json(body);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
