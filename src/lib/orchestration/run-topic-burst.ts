import type { SupabaseClient } from "@supabase/supabase-js";
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
import {
  applyRoomStewardDecisionToState,
  loadTopicOrchestrationState,
  persistTopicOrchestrationState,
} from "@/lib/orchestration/room-steward";
import { filterTopicSuggestionsByGovernance } from "@/lib/orchestration/topic-governance";
import { suggestTopics } from "@/lib/orchestration/topic-steward";
import type { OrchestratorInput } from "@/lib/orchestration/types";
import {
  buildBurstStewardContext,
  burstMessagesSince,
  HUMAN_BURST_FLUSH_GRACE_MS,
  selectDistinctBurstMessages,
  type BurstHumanMessage,
} from "@/lib/orchestration/human-burst";
import { loadRoomGovernanceContext } from "@/lib/server/room-governance";
import {
  loadRespondersContext,
  parseEmployeeMentions,
} from "@/lib/server/room-messages";
import { queueAgentRuns, type QueuedRun } from "@/lib/server/queue-agent-runs";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
import { isAiQueueingBlocked } from "@/lib/topic-ai-control";
import { getAiParticipationMode, isHiringTopic, isSmartAssistMode } from "@/lib/topics";
import { isMayaEmployee } from "@/lib/maya-employee";
import type { RoomTopic } from "@/lib/types";
import { uid } from "@/lib/utils";

const LOCK_TTL_MS = 15_000;

export type RunTopicBurstResult = {
  deferred: false;
  queuedRuns: QueuedRun[];
  blockedRuns: { employeeId: string; reason: string }[];
  burstMessageIds: string[];
  triggerMessageId: string;
  combinedText: string;
  skipped: boolean;
  skipReason?: string;
};

async function tryAcquireBurstLock(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; topicId: string },
): Promise<{ ok: true; token: string } | { ok: false }> {
  const state = await loadTopicOrchestrationState(client, params);
  const now = Date.now();
  const untilMs = state.burstLockUntil ? new Date(state.burstLockUntil).getTime() : 0;
  if (state.burstLockToken && untilMs > now) {
    return { ok: false };
  }
  const token = uid("burst");
  const lockUntil = new Date(now + LOCK_TTL_MS).toISOString();
  await persistTopicOrchestrationState(client, {
    ...state,
    burstLockToken: token,
    burstLockUntil: lockUntil,
  });
  // Re-read to detect races (last writer wins — accept if we still hold token)
  const after = await loadTopicOrchestrationState(client, params);
  if (after.burstLockToken !== token) return { ok: false };
  return { ok: true, token };
}

async function releaseBurstLock(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; topicId: string },
  token: string,
  consumedIds: string[],
): Promise<void> {
  const state = await loadTopicOrchestrationState(client, params);
  if (state.burstLockToken !== token) return;
  const prior = new Set(state.burstConsumedMessageIds ?? []);
  for (const id of consumedIds) prior.add(id);
  await persistTopicOrchestrationState(client, {
    ...state,
    burstLockToken: undefined,
    burstLockUntil: undefined,
    burstConsumedMessageIds: [...prior].slice(-200),
    lastHumanMessageId: consumedIds[consumedIds.length - 1] ?? state.lastHumanMessageId,
    lastDecision: "human_burst_flushed",
  });
}

export async function loadTopicBurstHumanMessages(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; topicId: string },
): Promise<BurstHumanMessage[]> {
  const state = await loadTopicOrchestrationState(client, params);
  const sinceAi = state.lastAiMessageId
    ? (
        await client
          .from("messages")
          .select("created_at")
          .eq("workspace_id", params.workspaceId)
          .eq("id", state.lastAiMessageId)
          .maybeSingle()
      ).data?.created_at
    : null;

  const { data, error } = await client
    .from("messages")
    .select("id, sender_id, sender_name, content, created_at, sender_type")
    .eq("workspace_id", params.workspaceId)
    .eq("room_id", params.roomId)
    .eq("topic_id", params.topicId)
    .eq("sender_type", "human")
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) throw error;

  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    senderId: row.sender_id ? String(row.sender_id) : null,
    senderName: String(row.sender_name ?? "Human"),
    content: String(row.content ?? ""),
    createdAt: String(row.created_at),
  }));

  const windowed = burstMessagesSince(rows, {
    sinceIso: sinceAi ? String(sinceAi) : null,
  });
  const consumed = new Set(state.burstConsumedMessageIds ?? []);
  return windowed.filter((m) => !consumed.has(m.id));
}

/**
 * After room-wide quiet: orchestrate one steward turn for distinct multi-author human messages.
 */
export async function runTopicBurstOrchestration(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    userId: string;
    topic: RoomTopic;
  },
): Promise<RunTopicBurstResult> {
  const empty = (skipReason: string): RunTopicBurstResult => ({
    deferred: false,
    queuedRuns: [],
    blockedRuns: [],
    burstMessageIds: [],
    triggerMessageId: "",
    combinedText: "",
    skipped: true,
    skipReason,
  });

  if (isAiQueueingBlocked(params.topic)) {
    return empty("ai_stopped");
  }

  const pending = await loadTopicBurstHumanMessages(client, params);
  if (!pending.length) return empty("no_pending_messages");

  const newest = pending[pending.length - 1]!;
  const ageMs = Date.now() - new Date(newest.createdAt).getTime();
  if (ageMs < HUMAN_BURST_FLUSH_GRACE_MS) {
    return empty("still_hot");
  }

  const distinct = selectDistinctBurstMessages(pending);
  if (!distinct.length) return empty("all_duplicates");

  const lock = await tryAcquireBurstLock(client, params);
  if (!lock.ok) return empty("lock_held");

  try {
    // Re-load under lock
    const fresh = await loadTopicBurstHumanMessages(client, params);
    const distinctFresh = selectDistinctBurstMessages(fresh);
    if (!distinctFresh.length) {
      await releaseBurstLock(client, params, lock.token, []);
      return empty("no_pending_messages");
    }

    const burst = buildBurstStewardContext(distinctFresh);
    await cancelActiveTopicWork(client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      reason: "Paused — waiting for the room to finish typing.",
      cancelReasonCode: "human_typing_pause",
      skipBrowserResearch: true,
    });

    const respondersCtx = await loadRespondersContext(
      client,
      params.workspaceId,
      params.roomId,
    );
    const orchestrationEmployees = filterOrchestrationEmployees(respondersCtx.employees);
    const mentionsJson: never[] = [];
    const mentioned = parseEmployeeMentions(
      burst.combinedText,
      respondersCtx.employees,
      mentionsJson,
    );
    const nameRefs = resolveParticipantReferences(burst.combinedText, orchestrationEmployees, {
      excludeEmployeeIds: mentioned.map((employee) => employee.id),
    });
    const mentionedByName = employeesFromReferenceIds(
      orchestrationEmployees,
      nameRefs.actionableEmployeeIds,
    );
    const mentions = [
      ...new Set([...mentioned.map((e) => e.id), ...mentionedByName.map((e) => e.id)]),
    ];

    const [recentMessagesResult, topicsResult, topicOrchestrationState] = await Promise.all([
      client
        .from("messages")
        .select("id, sender_type, sender_id, content, created_at, topic_id")
        .eq("workspace_id", params.workspaceId)
        .eq("room_id", params.roomId)
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("topics")
        .select("id, title, summary")
        .eq("workspace_id", params.workspaceId)
        .eq("room_id", params.roomId)
        .neq("status", "archived"),
      loadTopicOrchestrationState(client, params),
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

    const participation = getAiParticipationMode(params.topic);
    const smartAssistEnabled =
      !isAiQueueingBlocked(params.topic) &&
      (isSmartAssistMode(participation) || participation === "active_team");

    const dmEmployee = respondersCtx.room.dmEmployeeId
      ? respondersCtx.employees.find((e) => e.id === respondersCtx.room.dmEmployeeId)
      : respondersCtx.employees.length === 1
        ? respondersCtx.employees[0]
        : undefined;
    const isMayaDm = Boolean(dmEmployee && isMayaEmployee(dmEmployee));

    const orchestratorInput: OrchestratorInput = {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      userId: params.userId,
      messageId: burst.triggerMessageId,
      messageText: burst.combinedText,
      mentionedEmployeeIds: mentions,
      mentionedHumanIds: [],
      roomEmployees: orchestrationEmployees,
      topicEmployees: orchestrationEmployees,
      recentMessages,
      existingTopics,
      smartAssistEnabled,
      participationMode: participation,
      topicState: topicOrchestrationState,
      isDm: respondersCtx.room.kind === "dm",
      dmEmployeeId: respondersCtx.room.dmEmployeeId,
      isMayaDm,
      isMayaHiringSession: isMayaDm && isHiringTopic(params.topic),
    };

    let orchestrationPlan = await orchestrateConversation(orchestratorInput, { client });
    const governance = await loadRoomGovernanceContext(
      client,
      params.workspaceId,
      params.roomId,
      params.topicId,
      burst.triggerMessageId,
    );
    orchestrationPlan = applyRoomGovernanceToPlan(
      orchestrationPlan,
      orchestratorInput,
      governance,
    );

    if (orchestrationPlan.stewardDecision) {
      const nextState = applyRoomStewardDecisionToState(
        topicOrchestrationState,
        orchestrationPlan.stewardDecision,
        { messageId: burst.triggerMessageId, messageContent: burst.combinedText },
      );
      await persistTopicOrchestrationState(client, {
        ...nextState,
        burstLockToken: lock.token,
        burstLockUntil: topicOrchestrationState.burstLockUntil,
        burstConsumedMessageIds: topicOrchestrationState.burstConsumedMessageIds,
      });
    }

    let orchestrationId: string | null = null;
    const isEmployeeDm = respondersCtx.room.kind === "dm";

    if (!isEmployeeDm) {
      try {
        orchestrationId = await persistOrchestrationPlan(client, {
          workspaceId: params.workspaceId,
          roomId: params.roomId,
          topicId: params.topicId,
          triggerMessageId: burst.triggerMessageId,
          createdBy: params.userId,
          plan: orchestrationPlan,
        });
        const suggestionGovernance = await fetchTopicSuggestionGovernance(
          client,
          params.workspaceId,
          params.roomId,
        );
        const rawStewardSuggestions = await suggestTopics(
          orchestratorInput,
          orchestrationPlan.intent,
          params.topic,
        );
        const stewardSuggestions = filterTopicSuggestionsByGovernance(
          rawStewardSuggestions,
          suggestionGovernance,
          orchestratorInput,
        );
        if (stewardSuggestions.length && orchestrationId) {
          await persistTopicSuggestions(client, {
            workspaceId: params.workspaceId,
            roomId: params.roomId,
            topicId: params.topicId,
            orchestrationId,
            triggerMessageId: burst.triggerMessageId,
            createdBy: params.userId,
            suggestions: stewardSuggestions,
          });
        }
      } catch (persistError) {
        console.warn("[AdeHQ burst] orchestration persist failed", persistError);
      }
    }

    const legacyResult = orchestrationPlanToLegacyResult(
      orchestrationPlan,
      orchestrationEmployees,
      burst.triggerMessageId,
    );
    const { decisions: rawDecisions } = legacyResult;
    const decisions = rawDecisions.map((d) => ({
      ...d,
      runMetadata: {
        ...d.runMetadata,
        orchestrationId: orchestrationId ?? undefined,
        humanBurst: true,
        burstMessageIds: burst.messageIds,
        burstAuthorSummary: burst.authorSummary,
      },
    }));

    const { queued, blocked } = await queueAgentRuns(client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      triggerMessageId: burst.triggerMessageId,
      responders: decisions,
      content: burst.combinedText,
      createdByType: "steward",
      createdById: params.userId,
    });

    if (orchestrationId && queued.length) {
      try {
        await attachRunIdsToOrchestration(
          client,
          params.workspaceId,
          orchestrationId,
          Object.fromEntries(queued.map((r) => [r.employeeId, r.runId])),
        );
      } catch (attachError) {
        console.warn("[AdeHQ burst] attach run ids failed", attachError);
      }
    }

    // Mark all pending (including duplicates) consumed so they are not re-flushed.
    await releaseBurstLock(
      client,
      params,
      lock.token,
      fresh.map((m) => m.id),
    );

    return {
      deferred: false,
      queuedRuns: queued,
      blockedRuns: blocked,
      burstMessageIds: burst.messageIds,
      triggerMessageId: burst.triggerMessageId,
      combinedText: burst.combinedText,
      skipped: queued.length === 0 && decisions.length === 0,
      skipReason: queued.length === 0 ? "no_responders" : undefined,
    };
  } catch (error) {
    try {
      await releaseBurstLock(client, params, lock.token, []);
    } catch {
      // best-effort
    }
    throw error;
  }
}
