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
import { logOrchestrationWorkLog } from "@/lib/orchestration/persistence";
import { scheduleTopicSummaryRefresh } from "@/lib/topic-summary/refresh";
import {
  createTopicContextImport,
  fetchMessagesForImportSelection,
  selectMessagesForTopicImport,
} from "@/lib/topics/context-imports";
import { nowISO, uid } from "@/lib/utils";
import type { TopicPriority } from "@/lib/types";

export const runtime = "nodejs";

type CreateTopicBody = {
  title: string;
  description?: string;
  priority?: TopicPriority;
  aiEmployeeIds?: string[];
  starterMessage?: string;
  metadata?: Record<string, unknown>;
  contextImport?: {
    suggestionId?: string;
    sourceRoomId?: string;
    sourceTopicId?: string;
    sourceDmId?: string;
    triggerMessageId?: string;
    sourceMessageIds?: string[];
    suggestedTitle?: string;
    importReason?: string;
    sourceScope?: "room" | "topic" | "dm";
    migrateMessages?: boolean;
  };
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
        .from("topics")
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
      .from("topics")
      .insert({
        workspace_id: workspaceId,
        room_id: params.roomId,
        title,
        slug,
        description: body.description?.trim() || null,
        priority: body.priority ?? "normal",
        created_by_type: "human",
        created_by_id: user.id,
        metadata: { aiParticipationMode: "smart_assist", ...(body.metadata ?? {}) },
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

    let migratedMessageIds: string[] = [];
    let migrateWarning: string | undefined;
    if (
      body.contextImport?.migrateMessages !== false &&
      body.contextImport?.sourceMessageIds?.length
    ) {
      const candidateIds = [...new Set(body.contextImport.sourceMessageIds.filter(Boolean))];
      try {
        const { data: movable, error: movableError } = await client
          .from("messages")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("room_id", params.roomId)
          .in("id", candidateIds);
        if (movableError) throw movableError;
        migratedMessageIds = (movable ?? []).map((row) => String(row.id));
        if (migratedMessageIds.length) {
          const { error: migrateError } = await client
            .from("messages")
            .update({ topic_id: topic.id })
            .eq("workspace_id", workspaceId)
            .eq("room_id", params.roomId)
            .in("id", migratedMessageIds);
          if (migrateError) throw migrateError;
        }
      } catch (migrateErr) {
        console.warn("[AdeHQ topics POST] message migrate failed", migrateErr);
        migrateWarning =
          "Topic created, but some messages could not be moved. Context was still imported when possible.";
        migratedMessageIds = [];
      }
    }

    const systemMessageId = uid("msg");
    const systemContent =
      migratedMessageIds.length > 0
        ? `Topic created: ${title}\n\nMoved ${migratedMessageIds.length} related message${
            migratedMessageIds.length === 1 ? "" : "s"
          } here. Continue this workstream in this topic — pick up where you left off.`
        : `Topic created: ${title}`;
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
      if (body.contextImport?.sourceTopicId) {
        await refreshTopicStats(client, body.contextImport.sourceTopicId);
      }
    } catch (statsError) {
      console.error("[AdeHQ topics POST] refreshTopicStats", statsError);
    }

    try {
      await logOrchestrationWorkLog(client, {
        workspaceId,
        roomId: params.roomId,
        topicId: topic.id,
        employeeId: aiEmployeeIds[0] ?? "system",
        action: "topic_created",
        summary:
          migratedMessageIds.length > 0
            ? `Created topic: ${title} (moved ${migratedMessageIds.length} messages)`
            : `Created topic: ${title}`,
        relatedEntityType: "topic",
        relatedEntityId: topic.id,
      });
    } catch (workLogError) {
      console.warn("[AdeHQ topics POST] work log failed", workLogError);
    }

    scheduleTopicSummaryRefresh(client, {
      workspaceId,
      roomId: params.roomId,
      topicId: topic.id,
      topicTitle: title,
      topicDescription: body.description?.trim() || null,
      trigger: "topic_created",
      employeeId: user.id,
    });

    const { data: refreshed } = await client
      .from("topics")
      .select("*")
      .eq("id", topic.id)
      .single();

    let contextImportWarning: string | undefined;
    let contextImportId: string | undefined;
    if (body.contextImport) {
      try {
        const sourceRoomId = body.contextImport.sourceRoomId ?? params.roomId;
        const sourceTopicId = body.contextImport.sourceTopicId ?? null;
        const preferredIds = new Set(
          (body.contextImport.sourceMessageIds ?? []).filter(Boolean),
        );
        const allMessages = await fetchMessagesForImportSelection(client, workspaceId, {
          sourceRoomId,
          sourceTopicId: migratedMessageIds.length ? topic.id : sourceTopicId,
          limit: 50,
        });
        const preferred = allMessages.filter((m) => preferredIds.has(m.id));
        const selected =
          preferred.length > 0
            ? preferred.slice(-8)
            : selectMessagesForTopicImport({
                messages: allMessages,
                triggerMessageId:
                  body.contextImport.triggerMessageId ??
                  body.contextImport.sourceMessageIds?.[
                    body.contextImport.sourceMessageIds.length - 1
                  ] ??
                  "",
                suggestedTopicTitle: body.contextImport.suggestedTitle ?? title,
                maxMessages: 8,
              });
        const importRecord = await createTopicContextImport(client, {
          workspaceId,
          createdBy: user.id,
          targetRoomId: params.roomId,
          targetTopicId: topic.id,
          sourceRoomId,
          sourceTopicId,
          sourceDmId: body.contextImport.sourceDmId ?? null,
          triggerMessageId:
            body.contextImport.triggerMessageId ??
            selected[selected.length - 1]?.id ??
            "",
          suggestedTitle: body.contextImport.suggestedTitle ?? title,
          importReason: body.contextImport.importReason ?? "topic_suggestion",
          sourceMessages: selected,
          metadata: {
            sourceScope: body.contextImport.sourceScope ?? (sourceTopicId ? "topic" : "room"),
            suggestionId: body.contextImport.suggestionId ?? null,
            migratedMessageIds,
          },
        });
        contextImportId = importRecord.id;
      } catch (importError) {
        console.warn("[AdeHQ topics POST] context import failed", importError);
        contextImportWarning =
          "Topic created, but context import failed. You can still continue manually.";
      }
    }

    return NextResponse.json({
      topic: refreshed ? topicFromRow(refreshed) : topic,
      systemMessageId,
      contextImportId,
      contextImportWarning: contextImportWarning ?? migrateWarning,
      migratedMessageIds,
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
