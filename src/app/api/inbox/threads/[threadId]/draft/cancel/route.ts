/**
 * POST /api/inbox/threads/[threadId]/draft/cancel — cancel queued/running draft job.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { cancelJob } from "@/lib/inbox/steward/jobs";
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
      jobId?: string;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");

    const { data: thread } = await ctx.secret
      .from("email_threads")
      .select("id, draft_status")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!thread) throw new AuthError("Thread not found.", 404);

    let jobId = body.jobId?.trim() || null;
    if (!jobId) {
      const { data: job } = await ctx.secret
        .from("email_jobs")
        .select("id")
        .eq("thread_id", threadId)
        .eq("mailbox_id", ctx.mailbox.id)
        .in("job_type", ["draft", "rewrite"])
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      jobId = job ? String(job.id) : null;
    }

    if (!jobId) {
      await ctx.secret
        .from("email_threads")
        .update({ draft_status: "cancelled" })
        .eq("id", threadId);
      return NextResponse.json({ ok: true, cancelled: false, reason: "no_active_job" });
    }

    const cancelled = await cancelJob(ctx.secret, {
      jobId,
      mailboxId: ctx.mailbox.id,
    });
    if (cancelled) {
      await ctx.secret
        .from("email_threads")
        .update({ draft_status: "cancelled" })
        .eq("id", threadId);
    }

    return NextResponse.json({ ok: true, cancelled, jobId });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
