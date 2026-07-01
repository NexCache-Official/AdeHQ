import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { mapTopicCreateError } from "@/lib/server/supabase-errors";
import {
  ensureGeneralTopic,
  ensureRoomAiMembers,
  topicFromRow,
  topicMemberFromRow,
  slugifyTopicTitle,
  backfillOrphanMessagesToGeneralTopic,
} from "@/lib/server/topic-helpers";
import { refreshTopicStats } from "@/lib/server/topic-stats";
import { nowISO, uid } from "@/lib/utils";
import type { TopicPriority } from "@/lib/types";

export const runtime = "nodejs";

type CreateTopicBody = {
  title: string;
  description?: string;
  priority?: TopicPriority;
  aiEmployeeIds?: string[];
  starterMessage?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    await ensureGeneralTopic(client, workspaceId, params.roomId);
    await backfillOrphanMessagesToGeneralTopic(client, workspaceId, params.roomId);

    const [topicsResult, membersResult] = await Promise.all([
      client
        .from("room_topics")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId)
        .order("last_activity_at", { ascending: false }),
      client
        .from("topic_members")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId),
    ]);

    if (topicsResult.error) throw topicsResult.error;
    if (membersResult.error) throw membersResult.error;

    return NextResponse.json({
      topics: (topicsResult.data ?? []).map(topicFromRow),
      members: (membersResult.data ?? []).map(topicMemberFromRow),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topics GET]", error);
    return NextResponse.json({ error: "Unable to load topics." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  let createdTopicId: string | null = null;
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as CreateTopicBody;

    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Topic title is required." }, { status: 400 });
    }

    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const aiEmployeeIds = [...new Set((body.aiEmployeeIds ?? []).filter(Boolean))];
    await ensureRoomAiMembers(client, workspaceId, params.roomId, aiEmployeeIds);

    const title = body.title.trim();
    const slug = slugifyTopicTitle(title);

    const { data: topicRow, error: topicError } = await client
      .from("room_topics")
      .insert({
        workspace_id: workspaceId,
        room_id: params.roomId,
        title,
        slug,
        description: body.description?.trim() || null,
        priority: body.priority ?? "normal",
        created_by_type: "human",
        created_by_id: user.id,
        metadata: { aiParticipationMode: "smart_assist" },
      })
      .select("*")
      .single();
    if (topicError) throw topicError;

    const topic = topicFromRow(topicRow);
    createdTopicId = topic.id;

    const memberRows = [
      {
        workspace_id: workspaceId,
        room_id: params.roomId,
        topic_id: topic.id,
        member_type: "human",
        member_id: user.id,
        role: "owner",
      },
      ...aiEmployeeIds.map((employeeId) => ({
        workspace_id: workspaceId,
        room_id: params.roomId,
        topic_id: topic.id,
        member_type: "ai",
        member_id: employeeId,
        role: "participant",
      })),
    ];

    const { error: membersError } = await client.from("topic_members").insert(memberRows);
    if (membersError) throw membersError;

    const profile = await client
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const systemMessageId = uid("msg");
    const systemContent = `Topic created: ${title}`;
    const { error: messageError } = await client.from("messages").insert({
      workspace_id: workspaceId,
      id: systemMessageId,
      room_id: params.roomId,
      topic_id: topic.id,
      sender_type: "system",
      sender_id: "system",
      sender_name: "AdeHQ",
      content: systemContent,
      mentions: [],
      mentions_json: [],
      pending: false,
      created_at: nowISO(),
    });
    if (messageError) throw messageError;

    if (body.starterMessage?.trim()) {
      const starterId = uid("msg");
      const { error: starterError } = await client.from("messages").insert({
        workspace_id: workspaceId,
        id: starterId,
        room_id: params.roomId,
        topic_id: topic.id,
        sender_type: "human",
        sender_id: user.id,
        sender_name: profile.data?.name ?? user.email?.split("@")[0] ?? "You",
        content: body.starterMessage.trim(),
        mentions: [],
        mentions_json: [],
        pending: false,
        created_at: nowISO(),
      });
      if (starterError) throw starterError;
    }

    try {
      await refreshTopicStats(client, topic.id);
    } catch (statsError) {
      console.error("[AdeHQ topics POST] refreshTopicStats", statsError);
    }

    const { data: refreshed } = await client
      .from("room_topics")
      .select("*")
      .eq("id", topic.id)
      .single();

    return NextResponse.json({
      topic: refreshed ? topicFromRow(refreshed) : topic,
      systemMessageId,
    });
  } catch (error) {
    if (createdTopicId) {
      console.error("[AdeHQ topics POST] partial create; topic may need cleanup:", createdTopicId);
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topics POST]", error);
    const mapped = mapTopicCreateError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
