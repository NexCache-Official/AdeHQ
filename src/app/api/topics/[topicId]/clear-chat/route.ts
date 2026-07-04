import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { isGeneralTopic } from "@/lib/topics";
import { clearTopicChatHistory } from "@/lib/server/clear-chat-history";
import { topicFromRow } from "@/lib/server/topic-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const isAdmin = role === "owner" || role === "admin";
    const isCreator = topic.createdById === user.id;
    const canClear = isAdmin || isCreator || isGeneralTopic(topic);
    if (!canClear) {
      return NextResponse.json({ error: "You cannot clear chat history for this topic." }, { status: 403 });
    }

    const result = await clearTopicChatHistory(
      client,
      topic.workspaceId,
      topic.roomId,
      topic.id,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic clear-chat]", error);
    return NextResponse.json({ error: "Unable to clear chat history." }, { status: 500 });
  }
}
