/**
 * POST /api/inbox/threads/[threadId]/assign — human override (never starts a model).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { assertEmployeeEligible } from "@/lib/inbox/steward/assign";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      employeeId?: string | null;
      humanId?: string | null;
      clear?: boolean;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");

    const { data: thread } = await ctx.secret
      .from("email_threads")
      .select("id")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!thread) throw new AuthError("Thread not found.", 404);

    if (body.clear) {
      await ctx.secret
        .from("email_threads")
        .update({
          assigned_employee_id: null,
          assigned_human_id: null,
          assignment_source: "human",
          assignment_confidence: 1,
        })
        .eq("id", threadId);
    } else if (body.employeeId) {
      await assertEmployeeEligible(ctx.secret, {
        workspaceId: ctx.workspaceId,
        employeeId: body.employeeId,
      });
      await ctx.secret
        .from("email_threads")
        .update({
          assigned_employee_id: body.employeeId,
          assigned_human_id: null,
          suggested_employee_id: body.employeeId,
          assignment_source: "human",
          assignment_confidence: 1,
        })
        .eq("id", threadId);
    } else if (body.humanId) {
      await ctx.secret
        .from("email_threads")
        .update({
          assigned_human_id: body.humanId,
          assigned_employee_id: null,
          assignment_source: "human",
          assignment_confidence: 1,
        })
        .eq("id", threadId);
    } else {
      return NextResponse.json({ error: "employeeId, humanId, or clear required" }, { status: 400 });
    }

    await recordEmailEvent(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId,
      actorType: "human",
      actorId: ctx.user.id,
      eventType: "email.assigned",
      payload: {
        employeeId: body.employeeId ?? null,
        humanId: body.humanId ?? null,
        clear: Boolean(body.clear),
        source: "human",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
