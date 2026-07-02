import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { roomIdFromRow } from "@/lib/server/db-row";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workLogFromRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    employeeId: String(row.employee_id),
    action: String(row.action),
    summary: String(row.summary ?? ""),
    toolUsed: row.tool_used ? String(row.tool_used) : undefined,
    status: row.status as "success" | "failed" | "pending",
    relatedEntityType: row.related_entity_type ? String(row.related_entity_type) : undefined,
    relatedEntityId: row.related_entity_id ? String(row.related_entity_id) : undefined,
    createdAt: String(row.created_at),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const limit = Math.min(
      50,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 30)),
    );

    const { data: topicRow, error: topicError } = await client
      .from("topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const topic = topicFromRow(topicRow);
    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(client, topic.workspaceId, topic.roomId, user.id, role);

    const { data, error } = await client
      .from("work_log_events")
      .select("*")
      .eq("workspace_id", topic.workspaceId)
      .eq("topic_id", params.topicId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      events: (data ?? []).map((row) => workLogFromRow(row as Record<string, unknown>)),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic work-log GET]", error);
    return NextResponse.json({ error: "Could not load work log." }, { status: 500 });
  }
}
