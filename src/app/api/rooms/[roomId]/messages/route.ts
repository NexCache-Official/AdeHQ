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
import { applyRoomGovernanceToPlan } from "@/lib/orchestration/ambient-governance";
import { orchestrateConversation } from "@/lib/orchestration/conversation-orchestrator";
import {
  employeesFromReferenceIds,
  resolveParticipantReferences,
} from "@/lib/orchestration/participant-reference-resolver";
import { orchestrationPlanToLegacyResult } from "@/lib/orchestration/legacy-adapter";
import {
  attachRunIdsToOrchestration,
  fetchTopicSuggestionGovernance,
  persistOrchestrationPlan,
  persistTopicSuggestions,
} from "@/lib/orchestration/persistence";
import { filterTopicSuggestionsByGovernance } from "@/lib/orchestration/topic-governance";
import { suggestTopics } from "@/lib/orchestration/topic-steward";
import type { OrchestratorInput } from "@/lib/orchestration/types";
import { loadRoomGovernanceContext } from "@/lib/server/room-governance";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { isAiQueueingBlocked } from "@/lib/topic-ai-control";
import { getAiParticipationMode, isHiringTopic, isSmartAssistMode } from "@/lib/topics";
import { isMayaEmployee } from "@/lib/maya-employee";
import { messageError } from "@/lib/server/message-errors";
import { detectArtifactIntent } from "@/lib/server/file-context";
import type { MentionRef, MessageArtifact } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageBody = {
  content: string;
  topicId?: string;
  clientMessageId?: string;
  mode?: "mock" | "live";
  /** Save the human message only — skip orchestration and agent run queue (e.g. Browse mode). */
  skipAiOrchestration?: boolean;
  mentionsJson?: MentionRef[];
  slashCommand?: string;
  attachmentFileIds?: string[];
  contextFileIds?: string[];
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
        return messageError("room_archived", msg, 400);
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
      if (msg.includes("room is archived")) {
        return messageError("room_archived", msg, 400, { topicId });
      }
      return messageError("topic_not_in_room", msg, 404, { topicId });
    }

    const trimmed = body.content.trim();
    const mentionsJson = body.mentionsJson?.length ? body.mentionsJson : undefined;
    const senderName = displayNameFromUser(user);

    const insertPromise = insertHumanMessage(
      client,
      workspaceId,
      params.roomId,
      { id: user.id, name: senderName },
      trimmed,
      topicId,
      body.clientMessageId,
      mentionsJson,
    ).then((message) => {
      humanMessageSaved = true;
      humanMessageId = message.id;
      return message;
    });

    const [respondersCtx, humanMessage] = await Promise.all([
      loadRespondersContext(client, workspaceId, params.roomId),
      insertPromise,
    ]);

    const orchestrationEmployees = filterOrchestrationEmployees(respondersCtx.employees);
    const mentioned = parseEmployeeMentions(trimmed, respondersCtx.employees, mentionsJson);
    const nameRefs = resolveParticipantReferences(trimmed, orchestrationEmployees, {
      excludeEmployeeIds: mentioned.map((employee) => employee.id),
    });
    const mentionedByName = employeesFromReferenceIds(orchestrationEmployees, nameRefs.actionableEmployeeIds);
    const allMentionedIds = [
      ...new Set([...mentioned.map((e) => e.id), ...mentionedByName.map((e) => e.id)]),
    ];
    const mentions = allMentionedIds;

    if (mentions.length && !mentionsJson) {
      void client
        .from("messages")
        .update({ mentions })
        .eq("workspace_id", workspaceId)
        .eq("id", humanMessage.id);
    }
    humanMessage.mentions = mentions;
    if (mentionsJson) humanMessage.mentionsJson = mentionsJson;

    const attachmentFileIds = [...new Set((body.attachmentFileIds ?? []).filter(Boolean))];
    const contextFileIds = [...new Set((body.contextFileIds ?? []).filter(Boolean))];
    const priorityFileIds = [...new Set([...attachmentFileIds, ...contextFileIds])];
    const artifactIntent = detectArtifactIntent(trimmed);
    if (attachmentFileIds.length) {
      const { data: fileRows, error: fileError } = await client
        .from("workspace_files")
        .select("id, display_name, extension, size_bytes, status")
        .eq("workspace_id", workspaceId)
        .eq("room_id", params.roomId)
        .eq("topic_id", topicId)
        .in("id", attachmentFileIds);
      if (fileError) throw fileError;
      if ((fileRows ?? []).length !== attachmentFileIds.length) {
        return messageError("attachment_not_found", "One or more files are not available in this topic.", 400);
      }

      const fileArtifacts: MessageArtifact[] = (fileRows ?? []).map((file) => ({
        type: "file",
        id: String(file.id),
        label: String(file.display_name),
        meta: {
          fileName: String(file.display_name),
          fileExtension: String(file.extension),
          fileSizeLabel:
            Number(file.size_bytes) < 1024 * 1024
              ? `${Math.max(1, Math.round(Number(file.size_bytes) / 1024))} KB`
              : `${(Number(file.size_bytes) / 1024 / 1024).toFixed(1)} MB`,
          fileStatus: file.status === "ready" ? "ready" : file.status === "failed" ? "failed" : "processing",
        },
      }));

      const { error: attachError } = await client.from("message_attachments").insert(
        attachmentFileIds.map((fileId) => ({
          workspace_id: workspaceId,
          message_id: humanMessage.id,
          file_id: fileId,
          attachment_type: "file",
        })),
      );
      if (attachError) throw attachError;

      const { error: updateMessageError } = await client
        .from("messages")
        .update({ artifacts: fileArtifacts })
        .eq("workspace_id", workspaceId)
        .eq("id", humanMessage.id);
      if (updateMessageError) throw updateMessageError;
      humanMessage.artifacts = fileArtifacts;
    }

    if (body.skipAiOrchestration) {
      return NextResponse.json({
        humanMessage,
        queuedRuns: [],
        blockedRuns: [],
        skippedOrchestration: true,
      });
    }

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

    let orchestrationPlan = await orchestrateConversation(orchestratorInput, { client });

    const governance = await loadRoomGovernanceContext(
      client,
      workspaceId,
      params.roomId,
      topicId,
      humanMessage.id,
    );
    orchestrationPlan = applyRoomGovernanceToPlan(
      orchestrationPlan,
      orchestratorInput,
      governance,
    );

    let orchestrationId: string | null = null;
    let topicSuggestions: Record<string, unknown>[] = [];

    const isEmployeeDm = respondersCtx.room.kind === "dm";

    if (!isAiQueueingBlocked(topic)) {
      try {
        if (!isEmployeeDm) {
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
          runMetadata: {
            ...d.runMetadata,
            orchestrationId,
            attachmentFileIds: priorityFileIds,
            contextFileIds,
            artifactIntent: artifactIntent ?? undefined,
          },
        }))
      : rawDecisions.map((d) => ({
          ...d,
          runMetadata: {
            ...d.runMetadata,
            attachmentFileIds: priorityFileIds,
            contextFileIds,
            artifactIntent: artifactIntent ?? undefined,
          },
        }));
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
