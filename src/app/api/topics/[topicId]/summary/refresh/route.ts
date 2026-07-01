import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { refreshTopicSummary } from "@/lib/topic-summary/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { manual?: boolean };

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

    const result = await refreshTopicSummary(client, {
      workspaceId: topic.workspaceId,
      roomId: topic.roomId,
      topicId: params.topicId,
      topicTitle: topic.title,
      topicDescription: topic.description,
      manual: body.manual !== false,
      trigger: "manual",
      employeeId: user.id,
    });

    const { data: updatedTopic } = await client
      .from("channel_topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();

    return NextResponse.json({
      ...result,
      topic: updatedTopic ? topicFromRow(updatedTopic) : topic,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic summary refresh]", error);
    return NextResponse.json({ error: "Unable to refresh topic summary." }, { status: 500 });
  }
}
