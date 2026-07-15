import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
import { roomIdFromRow } from "@/lib/server/db-row";
import { isPersistedTopicId } from "@/lib/server/topic-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    if (!isPersistedTopicId(params.topicId)) {
      return NextResponse.json({ artifacts: [] });
    }
    const { data: topicRow, error: topicError } = await client
      .from("topics")
      .select("workspace_id, room_id")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const workspaceId = String(topicRow.workspace_id);
    const roomId = roomIdFromRow(topicRow as Record<string, unknown>);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);

    const { data, error } = await client
      .from("artifacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", params.topicId)
      .neq("status", "archived")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      artifacts: (data ?? []).map((row) => artifactFromRow(row as Record<string, unknown>)),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic artifacts GET]", error);
    return NextResponse.json({ error: "Unable to load artifacts." }, { status: 500 });
  }
}
