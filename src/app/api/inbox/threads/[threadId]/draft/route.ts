/**
 * POST /api/inbox/threads/[threadId]/draft — enqueue on-demand AI draft (or rewrite).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { assertEmployeeEligible } from "@/lib/inbox/steward/assign";
import {
  countConcurrentJobs,
  countRecentJobs,
  enqueueEmailJob,
} from "@/lib/inbox/steward/jobs";
import { processEmailJobs } from "@/lib/inbox/steward/process";
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
      employeeId?: string;
      draftId?: string | null;
      rewriteType?: "shorter" | "warmer" | "persuasive" | null;
      requestId?: string;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "create_ai_draft");

    const { data: thread } = await ctx.secret
      .from("email_threads")
      .select("id, assigned_employee_id, suggested_employee_id, latest_draft_id")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!thread) throw new AuthError("Thread not found.", 404);

    const employeeId =
      body.employeeId ||
      (thread.assigned_employee_id as string) ||
      (thread.suggested_employee_id as string);
    if (!employeeId) {
      return NextResponse.json(
        { error: "Assign or suggest an AI employee before drafting." },
        { status: 400 },
      );
    }
    await assertEmployeeEligible(ctx.secret, {
      workspaceId: ctx.workspaceId,
      employeeId,
    });

    const { data: mailbox } = await ctx.secret
      .from("workspace_mailboxes")
      .select("max_draft_jobs_per_user_per_minute, max_concurrent_jobs")
      .eq("id", ctx.mailbox.id)
      .maybeSingle();

    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await countRecentJobs(ctx.secret, {
      mailboxId: ctx.mailbox.id,
      jobType: body.rewriteType ? "rewrite" : "draft",
      sinceIso: since,
      userId: ctx.user.id,
    });
    if (recent >= Number(mailbox?.max_draft_jobs_per_user_per_minute ?? 10)) {
      return NextResponse.json({ error: "Draft rate limit exceeded. Try again shortly." }, { status: 429 });
    }
    const concurrent = await countConcurrentJobs(ctx.secret, ctx.workspaceId);
    if (concurrent >= Number(mailbox?.max_concurrent_jobs ?? 20)) {
      return NextResponse.json({ error: "Too many active inbox jobs." }, { status: 429 });
    }

    const { data: latestInbound } = await ctx.secret
      .from("email_messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const requestId = body.requestId?.trim() || crypto.randomUUID();
    const latestInboundId = latestInbound ? String(latestInbound.id) : "none";
    const jobType = body.rewriteType ? "rewrite" : "draft";
    const idempotencyKey = `email-draft:${threadId}:${latestInboundId}:${employeeId}:${requestId}`;

    await ctx.secret
      .from("email_threads")
      .update({ draft_status: "queued" })
      .eq("id", threadId);

    const { jobId } = await enqueueEmailJob(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId,
      messageId: latestInbound ? String(latestInbound.id) : null,
      draftId: body.draftId ?? (thread.latest_draft_id as string) ?? null,
      jobType,
      idempotencyKey,
      payload: {
        employeeId,
        requestedBy: ctx.user.id,
        rewriteType: body.rewriteType ?? null,
        requestId,
      },
    });

    // Best-effort drain so the user sees progress without waiting for cron.
    void processEmailJobs(ctx.secret, 2).catch(() => {});

    return NextResponse.json({ ok: true, jobId, draftStatus: "queued" });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
