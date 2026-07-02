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
import { filterOrchestrationEmployees } from "@/lib/orchestration/collaboration-permissions";
import { applyChannelGovernanceToPlan } from "@/lib/orchestration/ambient-governance";
import { orchestrateConversation } from "@/lib/orchestration/conversation-orchestrator";
import { orchestrationPlanToLegacyResult } from "@/lib/orchestration/legacy-adapter";
import {
  attachRunIdsToOrchestration,
  fetchTopicSuggestionGovernance,
  logOrchestrationWorkLog,
  persistOrchestrationPlan,
  persistTopicSuggestions,
} from "@/lib/orchestration/persistence";
import { filterTopicSuggestionsByGovernance } from "@/lib/orchestration/topic-governance";
import { suggestTopics } from "@/lib/orchestration/topic-steward";
import type { OrchestratorInput } from "@/lib/orchestration/types";
import { loadChannelGovernanceContext } from "@/lib/server/channel-governance";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { isAiQueueingBlocked } from "@/lib/topic-ai-control";
import { getAiParticipationMode, isHiringTopic, isSmartAssistMode } from "@/lib/topics";
import { isMayaEmployee } from "@/lib/maya-employee";
import { messageError } from "@/lib/server/message-errors";
import type { MentionRef } from "@/lib/types";

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

    const orchestrationEmployees = filterOrchestrationEmployees(respondersCtx.employees);

    const [recentMessagesResult, topicsResult] = await Promise.all([
      client
        .from("messages")
        .select("id, sender_type, sender_id, content, created_at, topic_id")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId)
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("topics")
        .select("id, title, summary")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId)
        .neq("status", "archived"),
    ]);

    const recentMessages = ((recentMessagesResult.data ?? []) as Record<string, unknown>[])
      .reverse()
      .map((row) => ({
        id: String(row.id),
        senderType: row.sender_type as "human" | "ai" | "system",
        senderId: row.sender_id ? String(row.sender_id) : null,
        text: String(row.content ?? ""),
        createdAt: String(row.created_at),
        topicId: row.topic_id ? String(row.topic_id) : null,
      }));

    const existingTopics = ((topicsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      summary: row.summary ? String(row.summary) : null,
    }));

    const participation = getAiParticipationMode(topic);
    const smartAssistEnabled =
      !isAiQueueingBlocked(topic) &&
      (isSmartAssistMode(participation) || participation === "active_team");

    const dmEmployee = respondersCtx.room.dmEmployeeId
      ? respondersCtx.employees.find((e) => e.id === respondersCtx.room.dmEmployeeId)
      : respondersCtx.employees.length === 1
        ? respondersCtx.employees[0]
        : undefined;
    const isMayaDm = Boolean(dmEmployee && isMayaEmployee(dmEmployee));

    const orchestratorInput: OrchestratorInput = {
      workspaceId,
      roomId: params.roomId,
      topicId,
      userId: user.id,
      messageId: humanMessage.id,
      messageText: trimmed,
      mentionedEmployeeIds: mentions,
      roomEmployees: orchestrationEmployees,
      topicEmployees: orchestrationEmployees,
      recentMessages,
      existingTopics,
      smartAssistEnabled,
      isDm: respondersCtx.room.kind === "dm",
      dmEmployeeId: respondersCtx.room.dmEmployeeId,
      isMayaDm,
      isMayaHiringSession: isMayaDm && isHiringTopic(topic),
    };

    let orchestrationPlan = await orchestrateConversation(orchestratorInput);

    const governance = await loadChannelGovernanceContext(
      client,
      workspaceId,
      params.roomId,
      topicId,
      humanMessage.id,
    );
    orchestrationPlan = applyChannelGovernanceToPlan(
      orchestrationPlan,
      orchestratorInput,
      governance,
    );

    let orchestrationId: string | null = null;
    let topicSuggestions: Record<string, unknown>[] = [];

    if (!isAiQueueingBlocked(topic)) {
      try {
        orchestrationId = await persistOrchestrationPlan(client, {
          workspaceId,
          roomId: params.roomId,
          topicId,
          triggerMessageId: humanMessage.id,
          createdBy: user.id,
          plan: orchestrationPlan,
        });

        const suggestionGovernance = await fetchTopicSuggestionGovernance(
          client,
          workspaceId,
          params.roomId,
        );
        const stewardSuggestions = filterTopicSuggestionsByGovernance(
          suggestTopics(orchestratorInput, orchestrationPlan.intent, topic),
          suggestionGovernance,
          orchestratorInput,
        );
        if (stewardSuggestions.length) {
          topicSuggestions = await persistTopicSuggestions(client, {
            workspaceId,
            roomId: params.roomId,
            topicId,
            orchestrationId,
            triggerMessageId: humanMessage.id,
            createdBy: user.id,
            suggestions: stewardSuggestions,
          });

          const first = stewardSuggestions[0];
          if (first.confidence >= 0.78) {
            await logOrchestrationWorkLog(client, {
              workspaceId,
              roomId: params.roomId,
              topicId,
              employeeId: orchestrationEmployees[0]?.id ?? mentions[0] ?? "system",
              action: "topic_suggested",
              summary: `Suggested topic: ${first.type === "move_to_existing_topic" ? first.topicTitle : first.title}`,
              relatedEntityType: "topic_suggestion",
              relatedEntityId: String(topicSuggestions[0]?.id ?? ""),
            });
          }
        }
      } catch (persistError) {
        console.warn("[AdeHQ messages] orchestration persist failed", persistError);
      }
    } else {
      orchestrationPlan = {
        ...orchestrationPlan,
        shouldRespond: false,
        selectedEmployeeIds: [],
        responseOrder: [],
        reason: "AI stopped for this topic.",
      };
    }

    const legacyResult = isAiQueueingBlocked(topic)
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
      : orchestrationPlanToLegacyResult(
          orchestrationPlan,
          orchestrationEmployees,
          humanMessage.id,
        );

    const { plan: conversationPlan, decisions: rawDecisions } = legacyResult;
    const decisions = orchestrationId
      ? rawDecisions.map((d) => ({
          ...d,
          runMetadata: { ...d.runMetadata, orchestrationId },
        }))
      : rawDecisions;
    const orchestratorDebug =
      process.env.NEXT_PUBLIC_ORCHESTRATION_DEBUG === "true" ||
      request.headers.get("X-AdeHQ-Debug") === "true"
        ? {
            intent: orchestrationPlan.intent,
            confidence: orchestrationPlan.confidence,
            reason: orchestrationPlan.reason,
            selectedEmployeeIds: orchestrationPlan.selectedEmployeeIds,
            orchestrationId,
          }
        : undefined;

    const { queued, blocked } = await queueAgentRuns(client, {
      workspaceId,
      roomId: params.roomId,
      topicId,
      triggerMessageId: humanMessage.id,
      responders: decisions,
      content: trimmed,
    });

    if (orchestrationId && queued.length) {
      try {
        await attachRunIdsToOrchestration(
          client,
          workspaceId,
          orchestrationId,
          Object.fromEntries(queued.map((r) => [r.employeeId, r.runId])),
        );
      } catch (attachError) {
        console.warn("[AdeHQ messages] attach run ids failed", attachError);
      }
    }

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

    const participationMode = getAiParticipationMode(topic);
    let hint: string | undefined;
    if (queued.length === 0 && decisions.length === 0) {
      if (orchestrationPlan.suggestedActions.length > 0) {
        const invites = orchestrationPlan.suggestedActions.filter((a) => a.type === "invite_employee");
        if (invites.length) {
          hint = `Ask ${invites.map((a) => (a.type === "invite_employee" ? a.employeeName ?? "an employee" : "")).filter(Boolean).join(" and ")} to help.`;
        }
      } else if (respondersCtx.room.kind === "dm") {
        hint = "No AI reply was queued for this DM. Try sending the message again.";
      } else if (participationMode === "manual_only" || participationMode === "silent_observation") {
        hint = "Mention an employee with @ to get a response";
      } else if (isSmartAssistMode(participationMode) || participationMode === "active_team") {
        hint =
          "No employee joined automatically. Mention someone with @ or switch this topic to Active Team.";
      }
    }

    return NextResponse.json({
      humanMessage,
      queuedRuns: queued,
      blockedRuns: blocked,
      collaborationPlan: conversationPlan,
      orchestrationPlan,
      orchestrationId,
      orchestratorDebug,
      topicSuggestions,
      smartAssistSuggestions: orchestrationPlan.suggestedActions.filter(
        (a) => a.type === "invite_employee",
      ),
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
