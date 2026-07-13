/**
 * POST /api/inbox/outbox/[outboxId]/flush — send now if the undo window has elapsed.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { processOutboxItem } from "@/lib/inbox/outbox/process";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ outboxId: string }> },
) {
  try {
    const { outboxId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      /** Client timer expired — send even if clocks differ slightly. */
      force?: boolean;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");

    const { data: row } = await ctx.secret
      .from("email_outbox")
      .select("id, mailbox_id, status")
      .eq("id", outboxId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!row) throw new AuthError("Outbox item not found.", 404);

    const result = await processOutboxItem(ctx.secret, outboxId, {
      ignoreUndoWindow: body.force === true,
    });
    return NextResponse.json({
      ok: true,
      reason: result.reason ?? null,
      processed: result.ok,
      priorStatus: row.status,
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
