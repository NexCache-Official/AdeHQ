/**
 * GET /api/approvals/[approvalId] — fetch one approval for live chat/approvals UI.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { loadEmailDraftForApproval } from "@/lib/integrations/sync-email-draft-approvals";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

function approvalResponse(row: DbRow) {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    requestedBy: String(row.requested_by),
    title: String(row.title),
    description: String(row.description ?? ""),
    risk: row.risk,
    status: row.status,
    actionType: row.action_type,
    actionPayload: (row.action_payload as Record<string, unknown> | null) ?? undefined,
    previewSnapshot: (row.preview_snapshot as Record<string, unknown> | null) ?? undefined,
    revisionCount: Number(row.revision_count ?? 0),
    resolutionNote: row.resolution_note ? String(row.resolution_note) : undefined,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
    executedToolRunId: row.executed_tool_run_id ? String(row.executed_tool_run_id) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const { approvalId } = await params;
    const { user, client } = await requireAuthUser(request);

    const { data: row, error } = await client
      .from("approvals")
      .select("*")
      .eq("id", approvalId)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const workspaceId = String((row as DbRow).workspace_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const approval = approvalResponse(row as DbRow);
    const payload = approval.actionPayload;
    const tool = payload?.tool ? String(payload.tool) : "";
    const args = (payload?.args as Record<string, unknown> | undefined) ?? {};
    const draftId = typeof args.draftId === "string" ? args.draftId : null;

    let draft: Awaited<ReturnType<typeof loadEmailDraftForApproval>> = null;
    if (tool === "email.sendDraft" && draftId) {
      draft = await loadEmailDraftForApproval(client, { workspaceId, draftId });
    }

    return NextResponse.json({ approval, draft });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ approvals GET]", error);
    return NextResponse.json({ error: "Unable to load approval." }, { status: 500 });
  }
}
