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
  filterMessageIdsForTopicMigration,
  selectMessagesForTopicImport,
} from "@/lib/topics/context-imports";
import { cleanTopicDescription, cleanTopicTitle } from "@/lib/orchestration/topic-title";
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

    let aiEmployeeIds = [...new Set((body.aiEmployeeIds ?? []).filter(Boolean))];
    // Suggestion accepts often omit members — default to the room's AI employees
    // so the new topic is a usable hybrid workstream, not an empty shell.
    if (!aiEmployeeIds.length) {
      const { data: roomAi } = await client
        .from("room_members")
        .select("member_id")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId)
        .eq("member_type", "ai");
      aiEmployeeIds = [...new Set((roomAi ?? []).map((row) => String(row.member_id)).filter(Boolean))];
    }
    await ensureRoomAiMembers(client, workspaceId, params.roomId, aiEmployeeIds);

    const cleanedTitle = cleanTopicTitle(body.title) ?? body.title.trim();
    const title = cleanedTitle;
    const slug = slugifyTopicTitle(title);
    const description = cleanTopicDescription(body.description, title);

    const { data: topicRow, error: topicError } = await client
      .from("topics")
      .insert({
        workspace_id: workspaceId,
        room_id: params.roomId,
        title,
        slug,
        description: description || null,
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
          .select("id, content, sender_type")
          .eq("workspace_id", workspaceId)
          .eq("room_id", params.roomId)
          .in("id", candidateIds);
        if (movableError) throw movableError;
        const scopedIds = filterMessageIdsForTopicMigration({
          messages: (movable ?? []).map((row) => ({
            id: String(row.id),
            content: String(row.content ?? ""),
            senderType: row.sender_type ? String(row.sender_type) : undefined,
          })),
          candidateIds,
          suggestedTopicTitle: body.contextImport.suggestedTitle ?? title,
          triggerMessageId: body.contextImport.triggerMessageId,
        });
        migratedMessageIds = scopedIds;
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
          "Topic created, but some messages could not be moved. You can still continue in the new topic.";
        migratedMessageIds = [];
      }
    }

    // When messages were moved, stamp the system note just after the last moved
    // message so the timeline reads as the original chat, then a short continue cue.
    let systemCreatedAt = nowISO();
    if (migratedMessageIds.length) {
      const { data: lastMoved } = await client
        .from("messages")
        .select("created_at")
        .eq("workspace_id", workspaceId)
        .in("id", migratedMessageIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMoved?.created_at) {
        const base = new Date(String(lastMoved.created_at)).getTime();
        systemCreatedAt = new Date(base + 1).toISOString();
      }
    }

    const systemMessageId = uid("msg");
    const systemContent =
      migratedMessageIds.length > 0
        ? `Moved ${migratedMessageIds.length} message${
            migratedMessageIds.length === 1 ? "" : "s"
          } into “${title}”. Continue here.`
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
      created_at: systemCreatedAt,
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
      topicDescription: description || null,
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
    // Prefer real moved chats over an "Imported context" receipt card.
    // Only create a context-import receipt when nothing was migrated.
    if (body.contextImport && migratedMessageIds.length === 0) {
      try {
        const sourceRoomId = body.contextImport.sourceRoomId ?? params.roomId;
        const sourceTopicId = body.contextImport.sourceTopicId ?? null;
        const preferredIds = new Set(
          (body.contextImport.sourceMessageIds ?? []).filter(Boolean),
        );
        const allMessages = await fetchMessagesForImportSelection(client, workspaceId, {
          sourceRoomId,
          sourceTopicId,
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
        if (selected.length) {
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
        }
      } catch (importError) {
        console.warn("[AdeHQ topics POST] context import failed", importError);
        contextImportWarning =
          "Topic created, but relevant messages could not be attached. You can still continue manually.";
      }
    }

    // Return full moved rows so the client can render the original chat timeline
    // even when those messages were not already in the in-memory room cache.
    let migratedMessages: Array<Record<string, unknown>> = [];
    if (migratedMessageIds.length) {
      const { data: movedRows } = await client
        .from("messages")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("id", migratedMessageIds)
        .order("created_at", { ascending: true });
      migratedMessages = (movedRows ?? []).map((row) => ({
        id: String(row.id),
        roomId: params.roomId,
        topicId: topic.id,
        senderType: row.sender_type,
        senderId: String(row.sender_id ?? ""),
        senderName: String(row.sender_name ?? "Unknown"),
        content: String(row.content ?? ""),
        mentions: Array.isArray(row.mentions) ? row.mentions : [],
        mentionsJson: row.mentions_json ?? undefined,
        artifacts: row.artifacts ?? undefined,
        agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
        triggerMessageId: row.trigger_message_id ? String(row.trigger_message_id) : undefined,
        pending: row.pending === true,
        clientMessageId: row.client_message_id ? String(row.client_message_id) : undefined,
        createdAt: String(row.created_at ?? systemCreatedAt),
      }));
    }

    return NextResponse.json({
      topic: refreshed ? topicFromRow(refreshed) : topic,
      systemMessageId,
      systemMessage: {
        id: systemMessageId,
        roomId: params.roomId,
        topicId: topic.id,
        senderType: "system" as const,
        senderId: "system",
        senderName: "AdeHQ",
        content: systemContent,
        createdAt: systemCreatedAt,
        mentions: [] as string[],
        pending: false,
      },
      contextImportId,
      contextImportWarning: contextImportWarning ?? migrateWarning,
      migratedMessageIds,
      migratedMessages,
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
