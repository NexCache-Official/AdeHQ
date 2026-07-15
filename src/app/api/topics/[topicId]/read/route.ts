import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { nowISO } from "@/lib/utils";
import { isPersistedTopicId } from "@/lib/server/topic-id";

export const runtime = "nodejs";

type ReadBody = {
  lastReadMessageId?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    if (!isPersistedTopicId(params.topicId)) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    const body = (await request.json()) as ReadBody;

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

    const { data: member, error: memberFindError } = await client
      .from("topic_members")
      .select("id")
      .eq("topic_id", params.topicId)
      .eq("member_type", "human")
      .eq("member_id", user.id)
      .maybeSingle();
    if (memberFindError) throw memberFindError;

    const readAt = nowISO();
    if (member) {
      const { error: updateError } = await client
        .from("topic_members")
        .update({
          last_read_message_id: body.lastReadMessageId ?? null,
          last_read_at: readAt,
        })
        .eq("id", member.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await client.from("topic_members").insert({
        workspace_id: topic.workspaceId,
        room_id: topic.roomId,
        topic_id: params.topicId,
        member_type: "human",
        member_id: user.id,
        role: "participant",
        last_read_message_id: body.lastReadMessageId ?? null,
        last_read_at: readAt,
      });
      if (insertError) throw insertError;
    }

    return NextResponse.json({ ok: true, lastReadAt: readAt });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic read]", error);
    return NextResponse.json({ error: "Unable to mark topic read." }, { status: 500 });
  }
}
