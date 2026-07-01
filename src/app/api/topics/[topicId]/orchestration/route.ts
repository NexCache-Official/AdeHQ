import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { fetchLatestOrchestrationForTopic } from "@/lib/orchestration/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);

    const { data: topicRow, error: topicError } = await client
      .from("channel_topics")
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

    const orchestration = await fetchLatestOrchestrationForTopic(
      client,
      topic.workspaceId,
      params.topicId,
    );

    return NextResponse.json({ orchestration });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ orchestration GET]", error);
    return NextResponse.json({ error: "Could not load orchestration." }, { status: 500 });
  }
}
