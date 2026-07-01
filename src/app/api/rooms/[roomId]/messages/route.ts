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
import { planConversation } from "@/lib/server/conversation-orchestrator";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { loadChannelGovernanceContext } from "@/lib/server/channel-governance";
import { isAiQueueingBlocked } from "@/lib/topic-ai-control";
import { getAiParticipationMode, isSmartAssistMode } from "@/lib/topics";
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
      const msg = err instanceof Error ? err.message : "Unable to send message.";
      if (msg.includes("archived")) {
        return messageError("channel_archived", msg, 400);
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
      if (msg.includes("channel is archived")) {
        return messageError("channel_archived", msg, 400, { topicId });
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
    const governance = await loadChannelGovernanceContext(
      client,
      workspaceId,
      params.roomId,
      topicId,
      humanMessage.id,
    );

    const planResult = isAiQueueingBlocked(topic)
      ? {
          plan: {
            mode: "silent" as const,
            collaborationId: `collab_${humanMessage.id}`,
            rootTriggerMessageId: humanMessage.id,
            status: "active" as const,
            participants: [],
            pendingParticipants: [],
          },
          decisions: [],
        }
      : planConversation(
          trimmed,
          topic,
          roomForDecisions,
          respondersCtx.employees,
          mentionsJson,
          { maxParallel, governance, rootTriggerMessageId: humanMessage.id },
        );

    const { plan: conversationPlan, decisions, debug: orchestratorDebug } = planResult;

    const { queued, blocked } = await queueAgentRuns(client, {
      workspaceId,
      roomId: params.roomId,
      topicId,
      triggerMessageId: humanMessage.id,
      responders: decisions,
      content: trimmed,
    });

    if (process.env.NODE_ENV === "development" || request.headers.get("X-AdeHQ-Debug") === "true") {
      console.info("[AdeHQ messages]", {
        roomId: params.roomId,
        topicId,
        humanMessageId: humanMessage.id,
        queued: queued.length,
        blocked: blocked.length,
        decisions: decisions.length,
        conversationMode: conversationPlan.mode,
        orchestratorDebug,
      });
    }

    const participation = getAiParticipationMode(topic);
    let hint: string | undefined;
    if (queued.length === 0 && decisions.length === 0) {
      if (participation === "manual_only" || participation === "silent_observation") {
        hint = "Mention an employee with @ to get a response";
      } else if (isSmartAssistMode(participation) || participation === "active_team") {
        hint =
          "No employee joined automatically. Mention someone with @ or switch this topic to Active Team.";
      }
    }

    return NextResponse.json({
      humanMessage,
      queuedRuns: queued,
      blockedRuns: blocked,
      collaborationPlan: conversationPlan,
      orchestratorDebug,
      aiResponses: [],
      aiMessages: [],
      hint,
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
