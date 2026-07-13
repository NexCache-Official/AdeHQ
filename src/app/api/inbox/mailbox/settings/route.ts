/**
 * GET/PATCH /api/inbox/mailbox/settings — assistance mode + thresholds.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { ASSISTANCE_MODE_LABELS } from "@/lib/inbox/steward/types";
import type { AssistanceMode } from "@/lib/inbox/types";

export const runtime = "nodejs";

const MODES: AssistanceMode[] = [
  "manual",
  "ai_triage",
  "ai_triage_suggested_replies",
];

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );
    const { data } = await ctx.secret
      .from("workspace_mailboxes")
      .select(
        "assistance_mode, assign_threshold, approval_ttl_hours, max_triage_per_minute, max_draft_jobs_per_user_per_minute, max_concurrent_jobs, max_classifier_body_chars, max_draft_context_messages, max_rewrites_per_draft",
      )
      .eq("id", ctx.mailbox.id)
      .maybeSingle();

    const mode = (data?.assistance_mode as AssistanceMode) ?? "ai_triage";
    return NextResponse.json({
      assistanceMode: mode,
      labels: ASSISTANCE_MODE_LABELS,
      assignThreshold: Number(data?.assign_threshold ?? 0.9),
      approvalTtlHours: Number(data?.approval_ttl_hours ?? 48),
      limits: {
        maxTriagePerMinute: Number(data?.max_triage_per_minute ?? 60),
        maxDraftJobsPerUserPerMinute: Number(data?.max_draft_jobs_per_user_per_minute ?? 10),
        maxConcurrentJobs: Number(data?.max_concurrent_jobs ?? 20),
        maxClassifierBodyChars: Number(data?.max_classifier_body_chars ?? 8000),
        maxDraftContextMessages: Number(data?.max_draft_context_messages ?? 12),
        maxRewritesPerDraft: Number(data?.max_rewrites_per_draft ?? 5),
      },
      consent:
        "AdeHQ will classify and prioritise incoming email. It will not generate or send replies unless you request it.",
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      assistanceMode?: AssistanceMode;
      assignThreshold?: number;
      approvalTtlHours?: number;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "manage");

    const patch: Record<string, unknown> = {};
    if (body.assistanceMode) {
      if (!MODES.includes(body.assistanceMode)) {
        return NextResponse.json({ error: "Invalid assistance mode." }, { status: 400 });
      }
      patch.assistance_mode = body.assistanceMode;
    }
    if (typeof body.assignThreshold === "number") {
      patch.assign_threshold = Math.min(1, Math.max(0.5, body.assignThreshold));
    }
    if (typeof body.approvalTtlHours === "number") {
      patch.approval_ttl_hours = Math.min(168, Math.max(1, Math.round(body.approvalTtlHours)));
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No settings to update." }, { status: 400 });
    }

    await ctx.secret
      .from("workspace_mailboxes")
      .update(patch)
      .eq("id", ctx.mailbox.id);

    return NextResponse.json({ ok: true, ...patch });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
