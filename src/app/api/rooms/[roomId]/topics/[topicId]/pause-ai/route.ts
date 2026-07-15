import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership, getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Soft-pause AI for a topic while humans are typing (no stop-ack message). */
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

    const service = createSupabaseSecretClient();
    const result = await cancelActiveTopicWork(service, {
      workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      reason: "Paused — waiting for humans to finish typing.",
      cancelReasonCode: "human_typing_pause",
      skipBrowserResearch: true,
    });

    return NextResponse.json({
      ok: true,
      cancelledAgentRunIds: result.cancelledAgentRunIds,
      hadActiveWork: result.hadActiveWork,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ pause-ai]", error);
    return NextResponse.json({ error: "Unable to pause AI." }, { status: 500 });
  }
}
