import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getTopicForRoom, topicFromRow } from "@/lib/server/topic-helpers";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AiControlBody = {
  action: "stop_all" | "resume" | "pause_smart" | "stop_employee" | "resume_employee";
  employeeId?: string;
  pauseMinutes?: number;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as AiControlBody;

    const { data: topicRow, error: topicError } = await client
      .from("room_topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const topic = topicFromRow(topicRow as Record<string, unknown>);
    const workspaceId = topic.workspaceId;
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, topic.roomId, user.id, role);

    const meta = { ...(topic.metadata ?? {}) };

    switch (body.action) {
      case "stop_all":
        meta.aiStopped = true;
        meta.smartAssistPaused = false;
        meta.aiPausedUntil = null;
        break;
      case "resume":
        meta.aiStopped = false;
        meta.smartAssistPaused = false;
        meta.aiPausedUntil = null;
        meta.blockedEmployeeIds = [];
        break;
      case "pause_smart": {
        const minutes = body.pauseMinutes ?? 60;
        meta.smartAssistPaused = true;
        meta.aiPausedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
        break;
      }
      case "stop_employee": {
        if (!body.employeeId) {
          return NextResponse.json({ error: "employeeId required." }, { status: 400 });
        }
        const blocked = new Set(
          Array.isArray(meta.blockedEmployeeIds)
            ? (meta.blockedEmployeeIds as string[])
            : [],
        );
        blocked.add(body.employeeId);
        meta.blockedEmployeeIds = [...blocked];
        break;
      }
      case "resume_employee": {
        if (!body.employeeId) {
          return NextResponse.json({ error: "employeeId required." }, { status: 400 });
        }
        meta.blockedEmployeeIds = (
          Array.isArray(meta.blockedEmployeeIds) ? (meta.blockedEmployeeIds as string[]) : []
        ).filter((id) => id !== body.employeeId);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const { data: updated, error: updateError } = await client
      .from("room_topics")
      .update({ metadata: meta, updated_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", params.topicId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    if (body.action === "stop_all") {
      const { data: activeRuns } = await client
        .from("agent_runs")
        .select("id, run_metadata, status")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", params.topicId)
        .in("status", ["queued", "waiting", "running"]);

      for (const row of (activeRuns as Record<string, unknown>[] | null) ?? []) {
        const runId = String(row.id);
        const status = String(row.status);
        const meta = { ...((row.run_metadata as Record<string, unknown>) ?? {}) };
        meta.collaborationStatus = "cancelled";
        meta.cancelReason = "cancelled_by_user";

        if (status === "queued" || status === "waiting") {
          await client
            .from("agent_runs")
            .update({
              status: "cancelled",
              error_message: "Stopped by user",
              run_metadata: meta,
              completed_at: nowISO(),
            })
            .eq("workspace_id", workspaceId)
            .eq("id", runId);
        } else if (status === "running") {
          await client
            .from("agent_runs")
            .update({
              status: "failed",
              error_message: "Stopped by user",
              run_metadata: meta,
              completed_at: nowISO(),
            })
            .eq("workspace_id", workspaceId)
            .eq("id", runId);
        }
      }
    }

    return NextResponse.json({ topic: topicFromRow(updated as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ai-control]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI control failed." },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const topic = await getTopicForRoom(
      client,
      request.nextUrl.searchParams.get("workspaceId") ?? "",
      request.nextUrl.searchParams.get("roomId") ?? "",
      params.topicId,
    );
    if (!topic) {
      const { data: row } = await client
        .from("room_topics")
        .select("workspace_id, room_id, metadata")
        .eq("id", params.topicId)
        .maybeSingle();
      if (!row) {
        return NextResponse.json({ error: "Topic not found." }, { status: 404 });
      }
      const workspaceId = String(row.workspace_id);
      const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
      await assertCanAccessRoom(
        client,
        workspaceId,
        String(row.room_id),
        user.id,
        role,
      );
      return NextResponse.json({ metadata: row.metadata ?? {} });
    }

    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(
      client,
      topic.workspaceId,
      topic.roomId,
      user.id,
      role,
    );
    return NextResponse.json({ metadata: topic.metadata ?? {} });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed." },
      { status: 500 },
    );
  }
}
