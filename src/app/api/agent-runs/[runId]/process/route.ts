import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { processQueuedAgentRun } from "@/lib/server/process-queued-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      mode?: "mock" | "live";
    };

    const { data: runRow, error: runError } = await client
      .from("agent_runs")
      .select("workspace_id, room_id, topic_id, status")
      .eq("id", params.runId)
      .maybeSingle();

    if (runError) throw runError;
    if (!runRow) {
      return NextResponse.json({ error: "Agent run not found." }, { status: 404 });
    }

    const workspaceId = body.workspaceId ?? String(runRow.workspace_id);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(
      client,
      workspaceId,
      String(runRow.room_id),
      user.id,
      role,
    );

    const result = await processQueuedAgentRun(client, workspaceId, params.runId, {
      mode: body.mode,
    });

    return NextResponse.json({
      ok: true,
      runId: params.runId,
      ...result,
      aiMessage: {
        id: result.aiMessageId,
        roomId: String(runRow.room_id),
        topicId: runRow.topic_id ? String(runRow.topic_id) : undefined,
        senderType: "ai" as const,
        senderId: result.employeeId,
        senderName: result.employeeName,
        content: result.reply,
        agentRunId: params.runId,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ process agent run]", error);
    const message = error instanceof Error ? error.message : "Agent run failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
