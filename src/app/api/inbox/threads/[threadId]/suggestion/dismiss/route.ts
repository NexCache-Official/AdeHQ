/**
 * POST /api/inbox/threads/[threadId]/suggestion/dismiss
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "read");

    const { data: thread } = await ctx.secret
      .from("email_threads")
      .select("id, steward_meta")
      .eq("id", threadId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!thread) throw new AuthError("Thread not found.", 404);

    const { data: latestInbound } = await ctx.secret
      .from("email_messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const meta = {
      ...((thread.steward_meta as Record<string, unknown>) ?? {}),
      dismissedSuggestionFingerprint: latestInbound
        ? String(latestInbound.id)
        : `dismissed:${Date.now()}`,
    };

    await ctx.secret
      .from("email_threads")
      .update({ steward_meta: meta })
      .eq("id", threadId);

    await recordEmailEvent(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId,
      actorType: "human",
      actorId: ctx.user.id,
      eventType: "email.suggestion_dismissed",
      payload: { fingerprint: meta.dismissedSuggestionFingerprint },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
