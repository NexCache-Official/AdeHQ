import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { getTopicContextImportsForTopic } from "@/lib/topics/context-imports";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string; topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const imports = await getTopicContextImportsForTopic(client, workspaceId, params.topicId);
    return NextResponse.json({ imports });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic context imports GET]", error);
    return NextResponse.json({ error: "Unable to load imported context." }, { status: 500 });
  }
}
