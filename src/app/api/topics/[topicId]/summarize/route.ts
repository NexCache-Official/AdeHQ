import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { refreshTopicSummary } from "@/lib/topic-summary/refresh";

export const runtime = "nodejs";

/** @deprecated Use POST /api/topics/[topicId]/summary/refresh */
export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);

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

    const result = await refreshTopicSummary(client, {
      workspaceId: topic.workspaceId,
      roomId: topic.roomId,
      topicId: params.topicId,
      topicTitle: topic.title,
      topicDescription: topic.description,
      manual: true,
      trigger: "manual",
      employeeId: user.id,
    });

    const { data: updated } = await client
      .from("topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();

    return NextResponse.json({
      topic: updated ? topicFromRow(updated) : topic,
      summary: result.summary?.summary ?? "",
      topicSummary: result.summary,
      refreshed: result.refreshed,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic summarize]", error);
    return NextResponse.json({ error: "Unable to summarize topic." }, { status: 500 });
  }
}
