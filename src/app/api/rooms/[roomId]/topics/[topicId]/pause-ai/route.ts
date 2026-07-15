import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership, getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legacy endpoint: previously cancelled active AI work while humans typed.
 * Kept as a no-op so older clients do not error — typing indicators remain UI-only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string; topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId, getRequestWorkspaceId(request));
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);
    await assertTopicInRoom(client, workspaceId, params.roomId, params.topicId);

    return NextResponse.json({
      ok: true,
      cancelledAgentRunIds: [],
      hadActiveWork: false,
      noop: true,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ pause-ai]", error);
    return NextResponse.json({ error: "Unable to pause AI." }, { status: 500 });
  }
}
