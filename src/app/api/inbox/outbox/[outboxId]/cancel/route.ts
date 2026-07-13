/**
 * POST /api/inbox/outbox/[outboxId]/cancel — undo a queued send.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { cancelOutboxItem } from "@/lib/inbox/outbox/process";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ outboxId: string }> },
) {
  try {
    const { outboxId } = await params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");
    const result = await cancelOutboxItem(ctx.secret, {
      outboxId,
      mailboxId: ctx.mailbox.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Message already sent or can no longer be undone.", reason: result.reason },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
