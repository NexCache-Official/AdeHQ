import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanSendRoomMessage } from "@/lib/server/room-access";
import {
  getWorkspaceIdForRoom,
  insertHumanMessage,
  loadRespondersContext,
  parseEmployeeMentions,
} from "@/lib/server/room-messages";
import { assertTopicInRoom, ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { decideResponders } from "@/lib/server/decide-responders";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { loadMaxParallelRuns } from "@/lib/ai/cost-guard";
import { messageError } from "@/lib/server/message-errors";
import type { MentionRef, ProjectRoom } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageBody = {
  content: string;
  topicId?: string;
  clientMessageId?: string;
  mode?: "mock" | "live";
  mentionsJson?: MentionRef[];
  slashCommand?: string;
};

function displayNameFromUser(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const meta = user.user_metadata;
  const fromMeta =
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name);
  if (fromMeta) return fromMeta;
  return user.email?.split("@")[0] ?? "You";
}

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  let humanMessageSaved = false;
  let humanMessageId: string | undefined;

  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as MessageBody;

    if (!body.content?.trim()) {
      return messageError("message_required", "Message content is required.", 400);
    }

    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return messageError("room_not_found", "Room not found.", 404);
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    try {
      await assertCanSendRoomMessage(client, workspaceId, params.roomId, user.id, role);
    } catch (err) {
      if (err instanceof AuthError) {
        return messageError("not_room_member", err.message, err.status);
      }
      throw err;
    }

    let topicId = body.topicId;
    if (!topicId) {
      const general = await ensureGeneralTopic(client, workspaceId, params.roomId);
      topicId = general.id;
    }

    let topic;
    try {
      topic = await assertTopicInRoom(client, workspaceId, params.roomId, topicId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Topic not found.";
      if (msg.includes("archived")) {
        return messageError("topic_archived", msg, 400, { topicId });
      }
      return messageError("topic_not_in_room", msg, 404, { topicId });
    }

    const trimmed = body.content.trim();
    const mentionsJson = body.mentionsJson?.length ? body.mentionsJson : undefined;
    const senderName = displayNameFromUser(user);

    const [respondersCtx, humanMessage] = await Promise.all([
      loadRespondersContext(client, workspaceId, params.roomId),
      insertHumanMessage(
        client,
        workspaceId,
        params.roomId,
        { id: user.id, name: senderName },
        trimmed,
        topicId,
        body.clientMessageId,
        mentionsJson,
      ),
    ]);
    humanMessageSaved = true;
    humanMessageId = humanMessage.id;

    const roomForDecisions = {
      id: respondersCtx.room.id,
      kind: respondersCtx.room.kind,
      dmEmployeeId: respondersCtx.room.dmEmployeeId,
    } as ProjectRoom;

    const mentioned = parseEmployeeMentions(trimmed, respondersCtx.employees, mentionsJson);
    const mentions = mentioned.map((e) => e.id);

    if (mentions.length && !mentionsJson) {
      void client
        .from("messages")
        .update({ mentions })
        .eq("workspace_id", workspaceId)
        .eq("id", humanMessage.id);
    }
    humanMessage.mentions = mentions;
    if (mentionsJson) humanMessage.mentionsJson = mentionsJson;

    const maxParallel = await loadMaxParallelRuns(client, workspaceId);
    const decisions = decideResponders(
      trimmed,
      topic,
      roomForDecisions,
      respondersCtx.employees,
      mentionsJson,
      { maxParallel },
    );

    const { queued, blocked } = await queueAgentRuns(client, {
      workspaceId,
      roomId: params.roomId,
      topicId,
      triggerMessageId: humanMessage.id,
      responders: decisions,
      content: trimmed,
    });

    if (process.env.NODE_ENV === "development") {
      console.info("[AdeHQ messages]", {
        roomId: params.roomId,
        topicId,
        humanMessageId: humanMessage.id,
        queued: queued.length,
        blocked: blocked.length,
        decisions: decisions.length,
      });
    }

    return NextResponse.json({
      humanMessage,
      queuedRuns: queued,
      blockedRuns: blocked,
      aiResponses: [],
      aiMessages: [],
      hint:
        queued.length === 0 && decisions.length === 0
          ? "Mention an employee with @ to get a response"
          : undefined,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return messageError("not_room_member", error.message, error.status);
    }
    if (humanMessageSaved && humanMessageId) {
      return NextResponse.json(
        {
          error: "AI processing could not be queued, but your message was saved.",
          code: "ai_runtime_failed_but_message_saved",
          humanMessageId,
        },
        { status: 207 },
      );
    }
    console.error("[AdeHQ messages route]", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return messageError("send_failed", `Unable to send message: ${detail}`, 500);
  }
}
