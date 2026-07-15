import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership, getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { runTopicBurstOrchestration } from "@/lib/orchestration/run-topic-burst";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Flush a multi-human typing burst into one steward orchestration turn. */
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
    const topic = await assertTopicInRoom(client, workspaceId, params.roomId, params.topicId);

    const service = createSupabaseSecretClient();
    const result = await runTopicBurstOrchestration(service, {
      workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      userId: user.id,
      topic,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      waitingRuns: [],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ orchestrate-burst]", error);
    return NextResponse.json({ error: "Unable to orchestrate burst." }, { status: 500 });
  }
}
