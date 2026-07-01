import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicMemberFromRow } from "@/lib/server/topic-helpers";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { employeeId?: string };

    if (!body.employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const { data: topicRow, error: topicError } = await client
      .from("channel_topics")
      .select("workspace_id, channel_id")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const workspaceId = String(topicRow.workspace_id);
    const roomId = String(topicRow.channel_id);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);

    const { data: existing } = await client
      .from("topic_members")
      .select("id")
      .eq("topic_id", params.topicId)
      .eq("member_type", "ai")
      .eq("member_id", body.employeeId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, alreadyMember: true });
    }

    const { data, error } = await client
      .from("topic_members")
      .insert({
        workspace_id: workspaceId,
        channel_id: roomId,
        topic_id: params.topicId,
        member_type: "ai",
        member_id: body.employeeId,
        role: "participant",
      })
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ member: topicMemberFromRow(data) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic members POST]", error);
    return NextResponse.json({ error: "Unable to add topic member." }, { status: 500 });
  }
}
