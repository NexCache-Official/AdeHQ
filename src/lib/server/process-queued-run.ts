import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { sanitizeEffects } from "@/lib/ai/sanitize-effects";
import { applyMentionEtiquette } from "@/lib/mentions";
import { type LiveCallMetrics } from "@/lib/ai/model-router";
import { dispatchEmployeeQueuedResponse } from "@/lib/ai/runtime/employee-queued-runtime";
import { finalizeAiRun } from "@/lib/ai/cost-guard";
import {
  getOutputTokenCap,
  getTimeoutMs,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { resolveRunModelMode } from "@/lib/ai/resolve-run-model-mode";
import {
  appendRunStep,
  claimAgentRun,
  completeAgentRun,
  finalizeUsage,
} from "@/lib/supabase/ai-runtime";
import { loadTopicContext, persistEmployeeEffects } from "@/lib/server/room-messages";
import { ensureDefaultEmployeeToolGrants } from "@/lib/integrations/permissions";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { assertRoomActive } from "@/lib/server/room-helpers";
import {
  queueCollaboratorRuns,
  queueFollowUpRuns,
} from "@/lib/server/queue-follow-up-runs";
import { GREETING_MAX_OUTPUT_TOKENS } from "@/lib/server/room-governance";
import type { QueuedRun } from "@/lib/server/queue-agent-runs";
import type { CollaborationRole, ConversationPlan } from "@/lib/types";
import {
  finalizeOrchestrationIfComplete,
  updateOrchestrationEmployeeStatus,
} from "@/lib/orchestration/persistence";
import { scheduleTopicSummaryRefresh, refreshTopicSummary } from "@/lib/topic-summary/refresh";
import {
  buildMemorySuggestionArtifacts,
  filterDmMessageArtifacts,
} from "@/lib/topic-summary/message-artifacts";
import type { PersistedOrchestrationEmployeeStatus } from "@/lib/orchestration/types";
import { serializeUnknownError, toUserFacingToolError } from "@/lib/server/message-errors";
import { roomIdFromRow } from "@/lib/server/db-row";
import {
  buildFileContextPrompt,
  detectArtifactIntent,
  loadAttachmentFileIds,
  retrieveFileContext,
} from "@/lib/server/file-context";
import { nowISO } from "@/lib/utils";
import {
  planEmployeeReplyShadowRun,
  recordEmployeeReplyShadowResult,
  resolveEmployeeShadowOldModel,
} from "@/lib/ai/runtime/hot-path-shadow";
import { canEmployeeUseBrowserResearch } from "@/lib/ai/browser-research/permissions";
import {
  executePlannedResearch,
  getResearchCapabilities,
  planResearch,
  type ResearchPlan,
} from "@/lib/ai/research";
import {
  pickResearchProvider,
  getResearchProviderCapabilitiesFromEnv,
} from "@/lib/ai/research/research-provider";
import {
  decideSearchSteward,
  enrichSearchStewardDebugSnapshot,
  searchStewardDebugSnapshot,
} from "@/lib/ai/search/search-steward";
import { classifyDmMessageWithSteward } from "@/lib/orchestration/dm-steward";
import {
  fetchTopicSummary,
} from "@/lib/topic-summary/persistence";
import { fetchTopicChatClearedAtColumn, fetchTopicContextEpochId } from "@/lib/conversation-context/epochs";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  buildWorkStopAcknowledgment,
  detectWorkStopRequest,
} from "@/lib/orchestration/work-stop";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
import { isIntelligenceV1Enabled } from "@/lib/config/features";
import type {
  IntelligenceContext,
  WorkMode,
} from "@/lib/ai/intelligence/intelligence-context";
import type { SearchRoute } from "@/lib/ai/search/types";
import {
  enrichIntelligenceContext,
  shouldAnswerFromKnowledge,
} from "@/lib/ai/intelligence/pipeline";
import { intelligenceMetadata } from "@/lib/ai/intelligence/telemetry";
import {
  researchPlanFromIntelligence,
  shouldSkipLegacyResearchPlanner,
} from "@/lib/ai/intelligence/research-plan-from-intelligence";
import {
  composeKnowledgeReply,
  persistComposedIntelligenceReply,
  withComposerMetadata,
} from "@/lib/ai/intelligence/response-composer";
import { queueBackgroundLearningFromSearch } from "@/lib/ai/intelligence/background-learning";
import {
  attachArtifactToMessage,
  createGatewaySearchResearchReport,
} from "@/lib/ai/intelligence/gateway-search-report";
import { assignResearchLevel } from "@/lib/ai/intelligence/research-level";
import {
  buildConversationDebugTrace,
  type ConversationDebugTrace,
} from "@/lib/ai/intelligence/intelligence-debug-trace";
import { appendIntelligenceStep } from "@/lib/ai/intelligence/telemetry";

function formatResearchError(error: unknown): string {
  return serializeUnknownError(error);
}

async function persistRunOrchestrationPhase(
  client: SupabaseClient,
  workspaceId: string,
  runMetadata: Record<string, unknown>,
  employeeId: string,
  phase: PersistedOrchestrationEmployeeStatus["phase"],
  extra?: {
    detail?: string;
    waitingOnEmployeeName?: string;
    runId?: string;
  },
) {
  const orchestrationId =
    typeof runMetadata.orchestrationId === "string"
      ? runMetadata.orchestrationId
      : null;
  if (!orchestrationId) return;

  await updateOrchestrationEmployeeStatus(client, {
    workspaceId,
    orchestrationId,
    employeeId,
    phase,
    detail: extra?.detail ?? null,
    waitingOnEmployeeName: extra?.waitingOnEmployeeName ?? null,
    runId: extra?.runId ?? null,
  });

  if (phase === "completed" || phase === "failed") {
    await finalizeOrchestrationIfComplete(client, workspaceId, orchestrationId);
  }
}

type DbRow = Record<string, unknown>;

function dmStewardUsesArchivedSummary(chatClearedAt: string | null): boolean {
  return !chatClearedAt;
}

async function persistConversationDebugTrace(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  runMetadata: Record<string, unknown>,
  trace: ConversationDebugTrace,
) {
  runMetadata.debugTrace = trace;
  await client
    .from("agent_runs")
    .update({ run_metadata: runMetadata })
    .eq("workspace_id", workspaceId)
    .eq("id", runId);
}

async function buildAndPersistIntelligenceTrace(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    runId: string;
    runMetadata: Record<string, unknown>;
    roomKind: "dm" | "room" | "unknown";
    intelligence?: IntelligenceContext;
    employeeId: string;
    employeeName: string;
    triggerMessageId: string;
    aiMode?: string;
    dmSteward?: Record<string, unknown>;
    gatewaySearch?: Record<string, unknown>;
    extraTimeline?: ConversationDebugTrace["timeline"];
  },
): Promise<ConversationDebugTrace> {
  const trace = buildConversationDebugTrace({
    roomKind: params.roomKind,
    intelligence: params.intelligence,
    dmSteward: params.dmSteward,
    gatewaySearch: params.gatewaySearch,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    triggerMessageId: params.triggerMessageId,
    agentRunId: params.runId,
    aiMode: params.aiMode,
    extraTimeline: params.extraTimeline,
  });
  await persistConversationDebugTrace(
    client,
    params.workspaceId,
    params.runId,
    params.runMetadata,
    trace,
  );
  return trace;
}

export class AgentRunClaimError extends Error {
  code: "already_claimed_or_not_ready" | "cancelled" | "not_found";
  constructor(code: AgentRunClaimError["code"]) {
    super(code);
    this.code = code;
    this.name = "AgentRunClaimError";
  }
}

function planFromMetadata(
  runMetadata: Record<string, unknown>,
  rootTriggerMessageId: string,
): ConversationPlan | undefined {
  if (!runMetadata.collaborationId) return undefined;
  return {
    mode: (runMetadata.conversationMode as ConversationPlan["mode"]) ?? "lead_collaborator",
    collaborationId: String(runMetadata.collaborationId),
    rootTriggerMessageId,
    status: (runMetadata.collaborationStatus as ConversationPlan["status"]) ?? "active",
    participants: Array.isArray(runMetadata.participants)
      ? (runMetadata.participants as ConversationPlan["participants"])
      : [],
    pendingParticipants: [],
  };
}

export async function processQueuedAgentRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  options: { mode?: "mock" | "live"; content?: string } = {},
): Promise<{
  reply: string;
  aiMessageId: string;
  aiMode: string;
  employeeId: string;
  employeeName: string;
  artifacts?: import("@/lib/types").MessageArtifact[];
  researchRun?: import("@/lib/ai/browser-research/types").BrowserResearchRun;
  pendingResearch?: boolean;
  metrics?: LiveCallMetrics & {
    provider: string;
    modelMode: string;
    usageId?: string;
    agentRunId: string;
    fallbackTier?: number;
    structuredOutputSuccess?: boolean;
  };
  followUpRuns?: QueuedRun[];
  activatedRuns?: QueuedRun[];
  collaborationPlan?: ConversationPlan;
  searchMeta?: import("@/lib/ai/search/types").GatewaySearchRunMeta;
  dmSteward?: Record<string, unknown>;
  intelligenceTrace?: ConversationDebugTrace;
}> {
  const claim = await claimAgentRun(client, workspaceId, runId);
  if (!claim.ok) {
    throw new AgentRunClaimError(claim.code);
  }

  const run = claim.run;
  const employeeId = String(run.employee_id);
  const roomId = roomIdFromRow(run);
  const topicId = run.topic_id ? String(run.topic_id) : "";
  const triggerMessageId = String(run.trigger_message_id);
  const rootTriggerMessageId = run.root_trigger_message_id
    ? String(run.root_trigger_message_id)
    : triggerMessageId;
  const handoffDepth = Number(run.handoff_depth ?? 0);
  const runMetadata = (run.run_metadata as Record<string, unknown> | null) ?? {};
  const isGreetingRun = Boolean(runMetadata.isGreetingRun);
  const collaborationOnly = Boolean(runMetadata.collaborationOnly);
  const collaborationRole = runMetadata.collaborationRole as CollaborationRole | undefined;
  const leadReply =
    typeof runMetadata.leadReply === "string" ? runMetadata.leadReply : undefined;
  const leadEmployeeName =
    typeof runMetadata.leadEmployeeName === "string" ? runMetadata.leadEmployeeName : undefined;

  if (!topicId) throw new Error("Agent run missing topic.");

  await assertTopicInRoom(client, workspaceId, roomId, topicId);
  await assertRoomActive(client, workspaceId, roomId);

  const { data: usageRow } = await client
    .from("ai_usage_events")
    .select("id, estimated_max_output_tokens")
    .eq("workspace_id", workspaceId)
    .eq("agent_run_id", runId)
    .maybeSingle();

  const usageId = usageRow?.id ? String(usageRow.id) : undefined;
  const maxOutputTokens = usageRow?.estimated_max_output_tokens
    ? Number(usageRow.estimated_max_output_tokens)
    : undefined;

  try {
    const ctx = await loadTopicContext(client, workspaceId, roomId, topicId, {
      lean: true,
    });
    const roomEmployee = ctx.employees.find((e) => e.id === employeeId);
    if (!roomEmployee) throw new Error("Employee not found in this room.");
    // Seed default integration tool grants so the prompt lists usable tools.
    const employee = await ensureDefaultEmployeeToolGrants(client, workspaceId, roomEmployee);

    const { data: triggerMsg } = await client
      .from("messages")
      .select("content")
      .eq("workspace_id", workspaceId)
      .eq("id", triggerMessageId)
      .maybeSingle();

    let content = options.content ?? (triggerMsg?.content ? String(triggerMsg.content) : "");

    const stopDetection = detectWorkStopRequest(content);
    const workStopAck = Boolean(runMetadata.workStopAck) || stopDetection.isStop;

    if (workStopAck) {
      const cancelledBrowserResearchCount = Number(
        runMetadata.cancelledBrowserResearchCount ?? 0,
      );
      const cancelledAgentRunCount = Number(runMetadata.cancelledAgentRunCount ?? 0);

      let browserCount = cancelledBrowserResearchCount;
      let agentCount = cancelledAgentRunCount;

      if (stopDetection.isStop && browserCount === 0 && agentCount === 0) {
        const fallbackCancel = await cancelActiveTopicWork(client, {
          workspaceId,
          roomId,
          topicId,
          employeeId,
          reason: stopDetection.reason,
          exceptAgentRunId: runId,
        });
        browserCount = fallbackCancel.cancelledBrowserResearchRuns.length;
        agentCount = fallbackCancel.cancelledAgentRunIds.length;
      }

      const reply = buildWorkStopAcknowledgment({
        employeeName: employee.name,
        cancelledBrowserResearchCount: browserCount,
        cancelledAgentRunCount: agentCount,
      });

      const { aiMessage, artifacts } = await persistEmployeeEffects(
        client,
        workspaceId,
        roomId,
        topicId,
        employee,
        reply,
        { workLog: [], tasks: [], memory: [], approvals: [] },
        triggerMessageId,
        runId,
      );

      await persistRunOrchestrationPhase(
        client,
        workspaceId,
        runMetadata,
        employeeId,
        "completed",
        { runId },
      );

      if (usageId) {
        await finalizeAiRun({
          client,
          workspaceId,
          runId,
          usageId,
          responseMessageId: aiMessage.id,
          actualCostUsd: 0,
          failed: false,
        });
      }

      await client
        .from("ai_employees")
        .update({ status: "idle", last_active_at: nowISO() })
        .eq("workspace_id", workspaceId)
        .eq("id", employeeId);

      return {
        reply,
        aiMessageId: aiMessage.id,
        aiMode: "work_stop_ack",
        employeeId,
        employeeName: employee.name,
        artifacts,
        metrics: {
          provider: employee.provider,
          model: "template",
          modelMode: "efficient",
          inputTokens: 0,
          outputTokens: 0,
          fallbackUsed: false,
          estimatedCostUsd: 0,
          durationMs: 0,
          usageId,
          agentRunId: runId,
        },
      };
    }

    // Greeting runs never touch files — skip retrieval to save a round-trip and tokens.
    const attachmentFileIds = isGreetingRun
      ? []
      : [
          ...new Set([
            ...((runMetadata.attachmentFileIds as string[] | undefined) ?? []),
            ...((runMetadata.contextFileIds as string[] | undefined) ?? []),
            ...(await loadAttachmentFileIds(client, workspaceId, triggerMessageId)),
          ]),
        ];
    const artifactIntent = isGreetingRun
      ? undefined
      : (runMetadata.artifactIntent as { type: import("@/lib/types").SavedArtifactType; instruction?: string } | undefined) ??
        detectArtifactIntent(content);

    const fileContextBundle = isGreetingRun
      ? { chunks: [], files: [], chunkIds: new Set<string>(), fileIds: new Set<string>() }
      : await retrieveFileContext(client, workspaceId, topicId, {
          userMessage: content,
          priorityFileIds: attachmentFileIds,
        });
    let fileContextPrompt = buildFileContextPrompt(fileContextBundle);
    const usedFileContext = fileContextBundle.chunks.length > 0;
    let intelligence: IntelligenceContext | undefined;

    if (isIntelligenceV1Enabled()) {
      const rawWorkMode = runMetadata.workMode;
      const workMode: WorkMode | undefined =
        rawWorkMode === "fast" ||
        rawWorkMode === "balanced" ||
        rawWorkMode === "deep" ||
        rawWorkMode === "research" ||
        rawWorkMode === "collaboration"
          ? rawWorkMode
          : undefined;
      intelligence = await enrichIntelligenceContext(client, {
        workspaceId,
        roomId,
        topicId,
        messageId: triggerMessageId,
        userMessage: content,
        selectedEmployeeId: employeeId,
        workMode,
        preferFastSearch: Boolean(
          runMetadata.preferTavily ?? runMetadata.preferResearch,
        ),
        preferAgentMode: Boolean(
          runMetadata.preferAgentMode ?? runMetadata.preferBrowserbase,
        ),
        hasRecentContext: ctx.room.messages.length > 1,
        memoryEntries: ctx.recentMemory,
        topicSummary: ctx.topicSummary?.summary ?? null,
        fileContext: fileContextBundle,
        recentMessages: ctx.room.messages,
        capabilitiesSummary: (() => {
          const caps = getResearchCapabilities(employee);
          const lines = [
            caps.gatewaySearch
              ? "- Fast web search (Vercel AI Gateway) is configured."
              : "- Fast web search is not configured.",
            caps.tavily
              ? "- Backup web search (Tavily) is configured."
              : "- Backup web search is not configured.",
            caps.browserbase
              ? "- Live browser agent is configured."
              : "- Live browser agent is not configured.",
          ];
          return lines.join("\n");
        })(),
      });
      runMetadata.intelligence = intelligenceMetadata(intelligence);
      await client
        .from("agent_runs")
        .update({ run_metadata: runMetadata })
        .eq("workspace_id", workspaceId)
        .eq("id", runId);

      if (shouldAnswerFromKnowledge(intelligence) && intelligence.knowledge?.answer) {
        const composed = composeKnowledgeReply(intelligence);
        intelligence = withComposerMetadata(intelligence, composed);
        runMetadata.intelligence = intelligenceMetadata(intelligence);
        await client
          .from("agent_runs")
          .update({ run_metadata: runMetadata })
          .eq("workspace_id", workspaceId)
          .eq("id", runId);

        const knowledgeReply = await persistComposedIntelligenceReply(client, {
          workspaceId,
          roomId,
          topicId,
          employeeId,
          employeeName: employee.name,
          composed,
          agentRunId: runId,
          triggerMessageId,
        });

        await persistRunOrchestrationPhase(
          client,
          workspaceId,
          runMetadata,
          employeeId,
          "completed",
          { runId },
        );

        if (usageId) {
          await finalizeAiRun({
            client,
            workspaceId,
            runId,
            usageId,
            responseMessageId: knowledgeReply.id,
            actualCostUsd: 0,
            failed: false,
          });
        } else {
          await completeAgentRun(client, workspaceId, runId, {
            status: "completed",
            responseMessageId: knowledgeReply.id,
          });
        }

        await client
          .from("ai_employees")
          .update({ status: "idle", last_active_at: nowISO() })
          .eq("workspace_id", workspaceId)
          .eq("id", employeeId);

        if (!isGreetingRun) {
          if (ctx.room.kind === "dm") {
            try {
              await refreshTopicSummary(client, {
                workspaceId,
                roomId,
                topicId,
                topicTitle: ctx.topic.title,
                topicDescription: ctx.topic.description,
                trigger: "meaningful_ai_reply",
                employeeId,
                logWorkEvents: false,
              });
            } catch (error) {
              console.warn("[AdeHQ dm summary refresh]", error);
            }
          } else {
            scheduleTopicSummaryRefresh(client, {
              workspaceId,
              roomId,
              topicId,
              topicTitle: ctx.topic.title,
              topicDescription: ctx.topic.description,
              trigger: "meaningful_ai_reply",
              employeeId,
            });
          }
        }

        const intelligenceTrace = buildConversationDebugTrace({
          roomKind: ctx.room.kind === "dm" ? "dm" : "room",
          intelligence,
          employeeId,
          employeeName: employee.name,
          triggerMessageId,
          agentRunId: runId,
          aiMode: "knowledge",
        });
        await persistConversationDebugTrace(
          client,
          workspaceId,
          runId,
          runMetadata,
          intelligenceTrace,
        );

        return {
          reply: knowledgeReply.content,
          aiMessageId: knowledgeReply.id,
          aiMode: "knowledge",
          employeeId,
          employeeName: employee.name,
          artifacts: knowledgeReply.artifacts,
          intelligenceTrace,
          metrics: {
            provider: employee.provider,
            model: "knowledge",
            modelMode: "efficient",
            inputTokens: 0,
            outputTokens: 0,
            fallbackUsed: false,
            estimatedCostUsd: 0,
            durationMs: 0,
            usageId,
            agentRunId: runId,
          },
        };
      }

      fileContextPrompt = [
        fileContextPrompt,
        intelligence.knowledge?.found && intelligence.knowledge.answer
          ? [
              "Related workspace knowledge (use when helpful; search may still be needed):",
              intelligence.knowledge.answer,
            ].join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    if (
      (collaborationRole === "collaborator" || collaborationRole === "panelist") &&
      leadReply &&
      leadEmployeeName
    ) {
      const label =
        collaborationRole === "panelist" ? "panel perspective" : "lead";
      content = `${content}\n\n---\n${leadEmployeeName} (${label}) completed:\n${leadReply}`;
    }

    await client
      .from("ai_employees")
      .update({ status: "working", last_active_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId);

    await appendRunStep(client, {
      workspaceId,
      agentRunId: runId,
      roomId,
      topicId,
      employeeId,
      stepType: "thinking",
      title: "Reading context",
      summary: "Reviewed topic messages and workspace context",
      status: "running",
    });

    await persistRunOrchestrationPhase(
      client,
      workspaceId,
      runMetadata,
      employeeId,
      "reading",
      { runId },
    );

    const conversationMode =
      typeof runMetadata.conversationMode === "string"
        ? runMetadata.conversationMode
        : undefined;

    await persistRunOrchestrationPhase(
      client,
      workspaceId,
      runMetadata,
      employeeId,
      "replying",
      { runId },
    );

    const modelMode: ModelMode = resolveRunModelMode({
      roleKey: employee.roleKey,
      employeeModelMode: employee.modelMode,
      isGreetingRun,
      conversationMode,
      collaborationRole,
      userMessage: content,
    });
    const isLive = options.mode !== "mock" && employee.provider.toLowerCase() !== "mock";
    const outputCap = isGreetingRun
      ? GREETING_MAX_OUTPUT_TOKENS
      : maxOutputTokens ?? getOutputTokenCap(modelMode);

    const roomWithMessages = {
      ...ctx.room,
      messages: [
        ...ctx.room.messages,
        {
          id: triggerMessageId,
          roomId,
          topicId,
          senderType: "human" as const,
          senderId: "user",
          senderName: "User",
          content,
          createdAt: nowISO(),
        },
      ],
    };

    if (!isLive || !usageId) {
      const reply = `I'm ${employee.name}. Live AI is not configured for this employee.`;
      const { aiMessage, artifacts } = await persistEmployeeEffects(
        client,
        workspaceId,
        roomId,
        topicId,
        employee,
        reply,
        { workLog: [], tasks: [], memory: [], approvals: [] },
        triggerMessageId,
        runId,
      );
      await completeAgentRun(client, workspaceId, runId, {
        status: "completed",
        responseMessageId: aiMessage.id,
      });
      return {
        reply,
        aiMessageId: aiMessage.id,
        aiMode: "mock",
        employeeId,
        employeeName: employee.name,
        artifacts,
        metrics: {
          provider: employee.provider,
          model: "mock",
          modelMode,
          inputTokens: 0,
          outputTokens: 0,
          fallbackUsed: false,
          estimatedCostUsd: 0,
          durationMs: 0,
          usageId,
          agentRunId: runId,
        },
      };
    }

    const preferTavily = Boolean(runMetadata.preferTavily ?? runMetadata.preferResearch);
    const preferAgentMode = Boolean(runMetadata.preferAgentMode ?? runMetadata.preferBrowserbase);
    const isDmRoom = ctx.room.kind === "dm";

    if (
      !isGreetingRun &&
      !collaborationOnly &&
      !artifactIntent &&
      !shouldAnswerFromKnowledge(intelligence) &&
      (getResearchCapabilities(employee).canSearch ||
        canEmployeeUseBrowserResearch(employee))
    ) {
      let researchPlan: ResearchPlan | null = null;

      if (isIntelligenceV1Enabled() && intelligence) {
        researchPlan = researchPlanFromIntelligence({
          intelligence,
          messages: roomWithMessages.messages,
          userMessage: content,
          employee,
          preferTavily,
          preferAgentMode,
          excludeMessageId: triggerMessageId,
        });
        if (researchPlan) {
          runMetadata.intelligenceResearchPlan = {
            action: researchPlan.action,
            provider: researchPlan.provider,
            query: researchPlan.researchQuery,
            reasoning: researchPlan.reasoning,
            confidence: researchPlan.confidence,
          };
        }
      }

      if (
        !researchPlan &&
        isDmRoom &&
        !(isIntelligenceV1Enabled() && shouldSkipLegacyResearchPlanner(intelligence))
      ) {
        const [chatClearedAt, epochId, topicSummary] = await Promise.all([
          fetchTopicChatClearedAtColumn(client, workspaceId, topicId),
          fetchTopicContextEpochId(client, workspaceId, topicId),
          fetchTopicSummary(client, workspaceId, topicId),
        ]);

        const dmSteward = classifyDmMessageWithSteward({
          workspaceId,
          dmRoomId: roomId,
          topicId,
          employeeId,
          employeeName: employee.name,
          employeeRole: employee.role,
          messageId: triggerMessageId,
          messageContent: content,
          recentMessages: roomWithMessages.messages.slice(-12).map((m) => ({
            id: m.id,
            authorType: m.senderType === "human" ? "human" : "ai",
            content: m.content,
            createdAt: m.createdAt,
          })),
          currentSummary: dmStewardUsesArchivedSummary(chatClearedAt)
            ? topicSummary?.summary ?? null
            : null,
          chatClearedAt,
          currentEpochId: epochId,
          preferAgentMode,
          preferFastSearch: preferTavily,
        });

        runMetadata.dmSteward = {
          intent: dmSteward.intent,
          route: dmSteward.route,
          reason: dmSteward.reason,
          browserRequired: dmSteward.browserRequired,
          searchRequired: dmSteward.searchRequired,
          avoidBrowserbaseReason: dmSteward.costPolicy.avoidBrowserbaseReason,
        };

        if (dmSteward.route === "gateway_search" || dmSteward.route === "tavily_search") {
          const dmCapabilities = {
            ...getResearchProviderCapabilitiesFromEnv(),
            browserbase: canEmployeeUseBrowserResearch(employee),
          };
          const dmProvider =
            pickResearchProvider(content.trim(), { preferTavily, preferAgentMode }, dmCapabilities) ??
            (dmSteward.route === "tavily_search" ? "tavily" : "gateway_perplexity");
          const stewardDecision = decideSearchSteward(
            content.trim(),
            { preferAgentMode, preferFastSearch: preferTavily },
            dmCapabilities,
          );
          runMetadata.searchSteward = searchStewardDebugSnapshot(stewardDecision);
          researchPlan = {
            action: "search",
            researchQuery: content.trim(),
            provider: dmProvider,
            reasoning: dmSteward.reason,
            confidence: 0.95,
            userQuestion: content.trim(),
            resolved: {
              query: content.trim(),
              userQuestion: content.trim(),
              resolvedFrom: "user_message",
              wasMetaInstruction: false,
            },
          };
        } else if (dmSteward.route === "browser_research") {
          researchPlan = {
            action: "browse",
            researchQuery: content.trim(),
            provider: "browserbase",
            reasoning: dmSteward.reason,
            confidence: 0.95,
            userQuestion: content.trim(),
            resolved: {
              query: content.trim(),
              userQuestion: content.trim(),
              resolvedFrom: "user_message",
              wasMetaInstruction: false,
            },
          };
        } else if (dmSteward.route === "employee_model" || dmSteward.route === "ask_clarification") {
          researchPlan = null;
        }
      }

      if (!researchPlan) {
        researchPlan = await planResearch({
          messages: roomWithMessages.messages,
          userMessage: content,
          employee,
          preferTavily,
          preferAgentMode,
          excludeMessageId: triggerMessageId,
        });
      }

      if (isIntelligenceV1Enabled() && intelligence) {
        const level = assignResearchLevel(intelligence, researchPlan);
        intelligence = {
          ...intelligence,
          researchLevel: level,
        };
        intelligence = appendIntelligenceStep(intelligence, {
          layer: "tool",
          decision: `research_level_${level}`,
          confidence: 1,
          durationMs: 0,
          metadata: {
            action: researchPlan?.action,
            provider: researchPlan?.provider,
          },
        });
        runMetadata.intelligence = intelligenceMetadata(intelligence);
      }

      if (researchPlan.action === "search" || researchPlan.action === "browse") {
        const isGatewaySearch =
          researchPlan.provider === "gateway_perplexity" ||
          researchPlan.provider === "gateway_exa" ||
          researchPlan.provider === "gateway_parallel";
        await appendRunStep(client, {
          workspaceId,
          agentRunId: runId,
          roomId,
          topicId,
          employeeId,
          stepType: "tool_call",
          title:
            researchPlan.action === "browse"
              ? "Live browser research"
              : isGatewaySearch
                ? "Quick web search"
                : "Searching the web",
          summary: researchPlan.reasoning,
          status: "running",
        });

        const { data: triggerSender } = await client
          .from("messages")
          .select("sender_id")
          .eq("workspace_id", workspaceId)
          .eq("id", triggerMessageId)
          .maybeSingle();
        const createdBy = triggerSender?.sender_id ? String(triggerSender.sender_id) : "unknown";
        const researchStartedAt = Date.now();

        try {
          const serviceClient = createSupabaseSecretClient();
          const researchResult = await executePlannedResearch(serviceClient, {
            workspaceId,
            roomId,
            topicId,
            employeeId,
            createdBy,
            plan: researchPlan,
            triggerMessageId,
            agentRunId: runId,
          });

          if (researchResult.async && researchResult.run) {
            await appendRunStep(client, {
              workspaceId,
              agentRunId: runId,
              roomId,
              topicId,
              employeeId,
              stepType: "tool_call",
              title: "Live session started",
              summary: researchPlan.resolved.query.slice(0, 120),
              status: "running",
            });

            await persistRunOrchestrationPhase(
              client,
              workspaceId,
              runMetadata,
              employeeId,
              "completed",
              { runId },
            );

            await finalizeAiRun({
              client,
              workspaceId,
              runId,
              usageId,
              actualCostUsd: researchResult.run.estimatedCostUsd ?? 0,
              failed: false,
            });

            const intelligenceTrace =
              isIntelligenceV1Enabled() && intelligence
                ? await buildAndPersistIntelligenceTrace(client, {
                    workspaceId,
                    runId,
                    runMetadata,
                    roomKind: isDmRoom ? "dm" : "room",
                    intelligence: appendIntelligenceStep(intelligence, {
                      layer: "tool",
                      decision: "research_async_started",
                      confidence: 1,
                      durationMs: 0,
                      metadata: { runId: researchResult.run.id },
                    }),
                    employeeId,
                    employeeName: employee.name,
                    triggerMessageId,
                    aiMode: "research_async",
                    dmSteward: runMetadata.dmSteward as Record<string, unknown> | undefined,
                  })
                : undefined;

            return {
              reply: "",
              aiMessageId: "",
              aiMode: "research_async",
              employeeId,
              employeeName: employee.name,
              researchRun: researchResult.run,
              pendingResearch: true,
              intelligenceTrace,
              metrics: {
                provider: researchResult.run.provider,
                model: researchResult.run.provider,
                modelMode,
                inputTokens: 0,
                outputTokens: 0,
                fallbackUsed: false,
                estimatedCostUsd: researchResult.run.estimatedCostUsd ?? 0,
                durationMs: 0,
                usageId,
                agentRunId: runId,
              },
            };
          }

          if (researchResult.chatReply?.content?.trim()) {
            await client
              .from("messages")
              .update({ agent_run_id: runId })
              .eq("workspace_id", workspaceId)
              .eq("id", researchResult.chatReply.id);

            const completionLabel = researchResult.searchAnswer
              ? `gateway search · ${researchPlan.resolved.query.slice(0, 120)}`
              : `${researchResult.run?.provider ?? "search"} · ${researchPlan.resolved.query.slice(0, 120)}`;

            await appendRunStep(client, {
              workspaceId,
              agentRunId: runId,
              roomId,
              topicId,
              employeeId,
              stepType: "tool_call",
              title: researchResult.searchAnswer ? "Quick search complete" : "Research complete",
              summary: completionLabel,
              status: "success",
            });

            await persistRunOrchestrationPhase(
              client,
              workspaceId,
              runMetadata,
              employeeId,
              "completed",
              { runId },
            );

            await finalizeAiRun({
              client,
              workspaceId,
              runId,
              usageId,
              responseMessageId: researchResult.chatReply.id,
              actualCostUsd:
                researchResult.searchAnswer?.estimatedCostUsd ??
                researchResult.run?.estimatedCostUsd ??
                0,
              failed: false,
            });

            await client
              .from("ai_employees")
              .update({ status: "idle", last_active_at: nowISO() })
              .eq("workspace_id", workspaceId)
              .eq("id", employeeId);

            if (!isGreetingRun) {
              if (isDmRoom) {
                try {
                  await refreshTopicSummary(client, {
                    workspaceId,
                    roomId,
                    topicId,
                    topicTitle: ctx.topic.title,
                    topicDescription: ctx.topic.description,
                    trigger: "meaningful_ai_reply",
                    employeeId,
                    logWorkEvents: false,
                  });
                } catch (error) {
                  console.warn("[AdeHQ dm summary refresh]", error);
                }
              } else {
                scheduleTopicSummaryRefresh(client, {
                  workspaceId,
                  roomId,
                  topicId,
                  topicTitle: ctx.topic.title,
                  topicDescription: ctx.topic.description,
                  trigger: "meaningful_ai_reply",
                  employeeId,
                });
              }
            }

            const searchProvider =
              researchResult.searchAnswer?.route ?? researchResult.run?.provider ?? "search";
            const searchMeta = researchResult.searchAnswer?.searchMeta;
            const totalLatencyMs = searchMeta?.totalLatencyMs ?? Date.now() - researchStartedAt;

            if (searchMeta) {
              runMetadata.gatewaySearch = searchMeta;
            }

            const stewardMeta = researchResult.searchAnswer?.stewardMeta;
            if (runMetadata.searchSteward && stewardMeta?.steward) {
              runMetadata.searchSteward = enrichSearchStewardDebugSnapshot(stewardMeta.steward, {
                cacheHit: researchResult.searchAnswer?.fromCache,
                cacheKey: researchResult.searchAnswer?.cacheKey,
                sessionId: stewardMeta.sessionId,
                sessionReused: stewardMeta.sessionReused,
                attempts: stewardMeta.attempts,
              });
            } else if (stewardMeta?.steward) {
              runMetadata.searchSteward = enrichSearchStewardDebugSnapshot(stewardMeta.steward, {
                cacheHit: researchResult.searchAnswer?.fromCache,
                cacheKey: researchResult.searchAnswer?.cacheKey,
                sessionId: stewardMeta.sessionId,
                sessionReused: stewardMeta.sessionReused,
                attempts: stewardMeta.attempts,
              });
            }

            if (isIntelligenceV1Enabled() && intelligence && researchResult.searchAnswer) {
              const activeIntelligence = intelligence;
              if (researchResult.searchAnswer.fromCache) {
                intelligence = {
                  ...activeIntelligence,
                  cache: {
                    hit: true,
                    key: researchResult.searchAnswer.cacheKey,
                  },
                  composer: {
                    skippedEmployeeModel: true,
                    answerSource: "cache",
                  },
                };
              } else {
                intelligence = {
                  ...activeIntelligence,
                  search: {
                    route: researchResult.searchAnswer.route as SearchRoute,
                    provider: researchResult.searchAnswer.providerRoute,
                    query: researchPlan.resolved.query,
                    sourceCount: searchMeta?.usedSourceCount,
                  },
                  composer: {
                    skippedEmployeeModel: true,
                    answerSource: "search",
                  },
                };
              }

              const learning = await queueBackgroundLearningFromSearch(client, {
                workspaceId,
                roomId,
                topicId,
                employeeId,
                userQuestion: content,
                searchQuery: researchPlan.resolved.query,
                searchAnswer: researchResult.chatReply.content,
                messageId: researchResult.chatReply.id,
                agentRunId: runId,
                searchConfidence: searchMeta?.usedSourceCount
                  ? Math.min(0.98, 0.7 + searchMeta.usedSourceCount * 0.05)
                  : 0.85,
                sourcesArtifact: researchResult.chatReply.artifacts?.find(
                  (artifact) => artifact.type === "search_sources" || artifact.type === "web_sources",
                ),
              });
              intelligence = {
                ...intelligence,
                backgroundLearning: {
                  queued: learning.queued,
                  memoryId: learning.memoryId ?? learning.memorySuggestionKey,
                  autoSaved: learning.autoSaved,
                },
              };

              if (learning.queued) {
                const { data: refreshedMessage } = await client
                  .from("messages")
                  .select("artifacts")
                  .eq("workspace_id", workspaceId)
                  .eq("id", researchResult.chatReply.id)
                  .maybeSingle();
                if (refreshedMessage?.artifacts) {
                  researchResult.chatReply.artifacts =
                    refreshedMessage.artifacts as typeof researchResult.chatReply.artifacts;
                }
              }

              if (
                intelligence.researchLevel === 2 &&
                researchResult.searchAnswer &&
                !researchResult.searchAnswer.fromCache
              ) {
                try {
                  const report = await createGatewaySearchResearchReport(client, {
                    workspaceId,
                    roomId,
                    topicId,
                    employeeId,
                    createdBy,
                    query: researchPlan.resolved.query,
                    answer: researchResult.chatReply.content,
                    sourcesArtifact: researchResult.chatReply.artifacts?.find(
                      (artifact) =>
                        artifact.type === "search_sources" || artifact.type === "web_sources",
                    ),
                    agentRunId: runId,
                    provider: researchResult.searchAnswer.route,
                  });
                  if (report) {
                    researchResult.chatReply.artifacts = await attachArtifactToMessage(client, {
                      workspaceId,
                      messageId: researchResult.chatReply.id,
                      artifact: report.messageArtifact,
                    });
                    intelligence = appendIntelligenceStep(intelligence, {
                      layer: "tool",
                      decision: "l2_gateway_report",
                      confidence: 1,
                      durationMs: 0,
                      metadata: { artifactId: report.artifactId },
                    });
                  }
                } catch (error) {
                  console.warn("[AdeHQ L2 gateway report]", error);
                }
              }

              runMetadata.intelligence = intelligenceMetadata(intelligence);
            }

            if (searchMeta || runMetadata.intelligence) {
              await client
                .from("agent_runs")
                .update({ run_metadata: runMetadata })
                .eq("workspace_id", workspaceId)
                .eq("id", runId);
            }

            const intelligenceTrace = buildConversationDebugTrace({
              roomKind: isDmRoom ? "dm" : "room",
              intelligence,
              dmSteward: runMetadata.dmSteward as Record<string, unknown> | undefined,
              searchSteward: runMetadata.searchSteward as Record<string, unknown> | undefined,
              gatewaySearch: {
                ...(searchMeta ?? {}),
              },
              employeeId,
              employeeName: employee.name,
              triggerMessageId,
              agentRunId: runId,
              aiMode: researchResult.searchAnswer ? "gateway_search" : "research",
            });
            await persistConversationDebugTrace(
              client,
              workspaceId,
              runId,
              runMetadata,
              intelligenceTrace,
            );

            return {
              reply: researchResult.chatReply.content,
              aiMessageId: researchResult.chatReply.id,
              aiMode: researchResult.searchAnswer ? "gateway_search" : "research",
              employeeId,
              employeeName: employee.name,
              artifacts: researchResult.chatReply.artifacts,
              researchRun: researchResult.run,
              searchMeta,
              dmSteward: runMetadata.dmSteward as Record<string, unknown> | undefined,
              intelligenceTrace,
              metrics: {
                provider: searchProvider,
                model: searchMeta?.synthesisModel ?? searchProvider,
                modelMode,
                inputTokens: 0,
                outputTokens: 0,
                fallbackUsed: false,
                estimatedCostUsd:
                  researchResult.searchAnswer?.estimatedCostUsd ??
                  researchResult.run?.estimatedCostUsd ??
                  0,
                durationMs: totalLatencyMs,
                usageId,
                agentRunId: runId,
              },
            };
          }

          throw new Error("Research completed without a chat reply.");
        } catch (researchError) {
          console.warn("[AdeHQ research planner]", researchError);
          const researchErrorMessage = formatResearchError(researchError);
          const userFacingError = toUserFacingToolError(researchError);
          await appendRunStep(client, {
            workspaceId,
            agentRunId: runId,
            roomId,
            topicId,
            employeeId,
            stepType: "error",
            title: "Research failed",
            summary: researchErrorMessage,
            status: "failed",
          }).catch(() => undefined);

          const normalizedUserError = userFacingError.replace(/\.$/, "");
          const fallbackReply = `I tried to look that up, but ${normalizedUserError.charAt(0).toLowerCase()}${normalizedUserError.slice(1)}. Want me to try again?`;
          const { aiMessage, artifacts } = await persistEmployeeEffects(
            client,
            workspaceId,
            roomId,
            topicId,
            employee,
            fallbackReply,
            { workLog: [], tasks: [], memory: [], approvals: [] },
            triggerMessageId,
            runId,
          );
          await completeAgentRun(client, workspaceId, runId, {
            status: "completed",
            responseMessageId: aiMessage.id,
          });
          await finalizeAiRun({
            client,
            workspaceId,
            runId,
            usageId,
            responseMessageId: aiMessage.id,
            actualCostUsd: 0,
            failed: false,
          });
          await client
            .from("ai_employees")
            .update({ status: "idle", last_active_at: nowISO() })
            .eq("workspace_id", workspaceId)
            .eq("id", employeeId);

          const intelligenceTrace =
            isIntelligenceV1Enabled() && intelligence
              ? await buildAndPersistIntelligenceTrace(client, {
                  workspaceId,
                  runId,
                  runMetadata,
                  roomKind: isDmRoom ? "dm" : "room",
                  intelligence: appendIntelligenceStep(intelligence, {
                    layer: "tool",
                    decision: "research_failed",
                    confidence: 0,
                    durationMs: 0,
                    metadata: { error: researchErrorMessage },
                  }),
                  employeeId,
                  employeeName: employee.name,
                  triggerMessageId,
                  aiMode: "research_failed",
                  dmSteward: runMetadata.dmSteward as Record<string, unknown> | undefined,
                })
              : undefined;

          return {
            reply: fallbackReply,
            aiMessageId: aiMessage.id,
            aiMode: "research_failed",
            employeeId,
            employeeName: employee.name,
            artifacts,
            intelligenceTrace,
            metrics: {
              provider: employee.provider,
              model: employee.model,
              modelMode,
              inputTokens: 0,
              outputTokens: 0,
              fallbackUsed: false,
              estimatedCostUsd: 0,
              durationMs: 0,
              usageId,
              agentRunId: runId,
            },
          };
        }
      }
    }

    await appendRunStep(client, {
      workspaceId,
      agentRunId: runId,
      roomId,
      topicId,
      employeeId,
      stepType: "model_call",
      title: "Thinking",
      summary: `${employee.provider} · ${modelMode}`,
      status: "running",
    });

    const { oldProvider, oldModel, oldModelMode } = resolveEmployeeShadowOldModel({
      provider: employee.provider,
      modelMode,
      explicitModel: employee.model,
    });
    const collaborationId =
      typeof runMetadata.collaborationId === "string"
        ? runMetadata.collaborationId
        : undefined;
    const dmId = ctx.room.kind === "dm" ? ctx.room.dmEmployeeId : undefined;

    const shadowPlan = await planEmployeeReplyShadowRun({
      client,
      workspaceId,
      employeeId: employee.id,
      employeeName: employee.name,
      roleKey: employee.roleKey,
      roomId,
      topicId,
      dmId,
      messageId: triggerMessageId,
      userMessage: content,
      oldProvider,
      oldModel,
      oldModelMode,
      resolvedRunModelMode: modelMode,
      conversationMode,
      isGreetingRun,
      artifactIntent: artifactIntent ?? undefined,
      runId,
      usageId,
      collaborationId,
      collaborationRole,
      source: "employee_queued_response_shadow",
    });

    const queuedMeta = {
      runId,
      usageId,
      messageId: triggerMessageId,
      conversationMode,
      collaborationId,
      collaborationRole,
      resolvedRunModelMode: modelMode,
      oldProvider,
      oldModel,
      oldModelMode,
    };

    const routeInput = {
      employee,
      room: roomWithMessages,
      topic: ctx.topic,
      topicSummary: ctx.topicSummary,
      message: content,
      allEmployees: ctx.employees,
      recentMemory: ctx.recentMemory,
      topicTasks: ctx.openTasks,
      topicApprovals: ctx.topicApprovals,
      topicWorkLogs: ctx.topicWorkLogs,
      workspaceName: ctx.workspaceName,
      openTasks: ctx.openTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
      })),
      humanParticipants: ctx.humanParticipants,
      fileContextPrompt: fileContextPrompt || undefined,
      artifactIntent,
      importedContextPrompt: ctx.importedContextBlock,
    };
    const routeOptions = {
      mode: options.mode,
      provider: employee.provider,
      modelMode,
      maxOutputTokens: outputCap,
      timeoutMs: getTimeoutMs(modelMode),
      isGreetingRun,
      collaborationRole,
      leadEmployeeName,
      leadReply,
      conversationMode:
        typeof runMetadata.conversationMode === "string"
          ? runMetadata.conversationMode
          : undefined,
      context: {
        workspaceId,
        roomId,
        topicId,
        agentRunId: runId,
        client,
      },
    };

    const {
      response,
      aiMode,
      metrics,
      failed,
      errorMessage,
      usedRuntime,
    } = await dispatchEmployeeQueuedResponse(routeInput, routeOptions, queuedMeta);

    await recordEmployeeReplyShadowResult({
      client,
      workspaceId,
      employeeId: employee.id,
      employeeName: employee.name,
      roleKey: employee.roleKey,
      roomId,
      topicId,
      dmId,
      messageId: triggerMessageId,
      userMessage: content,
      oldProvider,
      oldModel,
      oldModelMode,
      resolvedRunModelMode: modelMode,
      conversationMode,
      isGreetingRun,
      artifactIntent: artifactIntent ?? undefined,
      runId,
      usageId,
      collaborationId,
      collaborationRole,
      workUnitId: shadowPlan?.workUnitId,
      routing: shadowPlan?.routing,
      actualProvider: metrics ? (usedRuntime ? "runtime-v2" : oldProvider) : undefined,
      actualModel: metrics?.model,
      actualModelMode: modelMode,
      actualCostUsd: metrics?.estimatedCostUsd,
      inputTokens: metrics?.inputTokens,
      outputTokens: metrics?.outputTokens,
      durationMs: metrics?.durationMs,
      aiMode,
      failed: failed || aiMode === "error",
      source: "employee_queued_response_shadow",
    });

    let effect = enforceEmployeePermissions(employee, response.effect);
    effect = sanitizeEffects(effect, {
      isGreetingRun,
      stripAllEffects: collaborationOnly && !effect.tasks.length,
    });

    const mentionParticipants = [
      ...ctx.employees.map((e) => ({
        id: e.id,
        name: e.name,
        type: "ai_employee" as const,
      })),
      ...ctx.humanParticipants.map((h) => ({
        id: h.id,
        name: h.name,
        type: "human" as const,
      })),
    ];
    const etiquette = applyMentionEtiquette(response.reply, mentionParticipants);

    let { aiMessage, artifacts } = await persistEmployeeEffects(
      client,
      workspaceId,
      roomId,
      topicId,
      employee,
      etiquette.content,
      effect,
      triggerMessageId,
      runId,
      {
        fileContext: fileContextBundle,
        usedFileContext,
        mentionsJson: etiquette.mentionsJson,
      },
    );

    const isDm = ctx.room.kind === "dm";
    if (isDm) {
      artifacts = filterDmMessageArtifacts(artifacts);
    }

    await persistRunOrchestrationPhase(
      client,
      workspaceId,
      runMetadata,
      employeeId,
      "completed",
      { runId },
    );

    await finalizeAiRun({
      client,
      workspaceId,
      runId,
      usageId,
      responseMessageId: aiMessage.id,
      inputTokens: metrics?.inputTokens,
      outputTokens: metrics?.outputTokens,
      cachedTokens: metrics?.cachedTokens,
      actualCostUsd: metrics?.estimatedCostUsd,
      latencyMs: metrics?.durationMs,
      fallbackUsed: metrics?.fallbackUsed,
      failed: failed || aiMode === "error",
      errorMessage,
    });

    await client
      .from("ai_employees")
      .update({ status: "idle", last_active_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId);

    let followUpRuns: QueuedRun[] = [];
    let activatedRuns: QueuedRun[] = [];

    if (!isGreetingRun && isLive) {
      const pendingCollaborators = Array.isArray(runMetadata.pendingCollaboratorIds)
        ? (runMetadata.pendingCollaboratorIds as string[])
        : [];

      const isFollowUpCollaborator =
        collaborationRole === "collaborator" || collaborationRole === "panelist";

      if (pendingCollaborators.length && !isFollowUpCollaborator) {
        const collab = await queueCollaboratorRuns(client, {
          workspaceId,
          roomId,
          topic: ctx.topic,
          employees: ctx.employees,
          leadRunId: runId,
          leadEmployee: employee,
          leadReply: response.reply,
          leadAiMessageId: aiMessage.id,
          rootTriggerMessageId,
          runMetadata,
        });
        activatedRuns = collab.activatedRuns;
        for (const activated of activatedRuns) {
          await persistRunOrchestrationPhase(
            client,
            workspaceId,
            runMetadata,
            activated.employeeId,
            "waiting",
            {
              runId: activated.runId,
              detail: `Reviewing ${employee.name}'s response…`,
              waitingOnEmployeeName: employee.name,
            },
          );
        }
      }

      const followUp = await queueFollowUpRuns(client, {
        workspaceId,
        roomId,
        topic: ctx.topic,
        employees: ctx.employees,
        aiMessageId: aiMessage.id,
        aiReply: response.reply,
        sourceEmployee: employee,
        parentRunId: runId,
        rootTriggerMessageId,
        handoffTo: response.effect.handoffTo,
        handoffDepth,
        isGreetingRun,
        runMetadata,
      });
      followUpRuns = followUp.followUpRuns;
    }

    const collaborationPlan = planFromMetadata(runMetadata, rootTriggerMessageId);

    if (!isGreetingRun && !failed && aiMode !== "error") {
      const refreshTrigger =
        effect.tasks.length > 0
          ? ("task_created" as const)
          : effect.approvals.length > 0
            ? ("approval_requested" as const)
            : (effect.memorySuggestions ?? []).length > 0
              ? ("memory_suggested" as const)
              : effect.memory.length > 0
              ? ("memory_suggested" as const)
              : (effect.artifacts ?? []).length > 0 || response.reply.trim().length > 80
                ? ("meaningful_ai_reply" as const)
                : null;

      if (refreshTrigger) {
        if (isDm) {
          // Summary refresh is advisory — never let it fail an already-posted reply.
          try {
            const refreshResult = await refreshTopicSummary(client, {
              workspaceId,
              roomId,
              topicId,
              topicTitle: ctx.topic.title,
              topicDescription: ctx.topic.description,
              trigger: refreshTrigger,
              employeeId,
              logWorkEvents: false,
            });
            if (refreshResult.summary?.suggestedMemory.length) {
              artifacts = [
                ...artifacts,
                ...buildMemorySuggestionArtifacts(refreshResult.summary.suggestedMemory, topicId),
              ];
            }
          } catch (error) {
            console.warn("[AdeHQ dm summary refresh]", error);
          }
        } else {
          scheduleTopicSummaryRefresh(client, {
            workspaceId,
            roomId,
            topicId,
            topicTitle: ctx.topic.title,
            topicDescription: ctx.topic.description,
            trigger: refreshTrigger,
            employeeId,
          });
        }
      }
    }

    if (isDm) {
      const payload = artifacts.length ? artifacts : null;
      await client
        .from("messages")
        .update({ artifacts: payload })
        .eq("workspace_id", workspaceId)
        .eq("id", aiMessage.id);
      aiMessage = { ...aiMessage, artifacts: payload ?? undefined };
    }

    let intelligenceTrace: ConversationDebugTrace | undefined;
    if (isIntelligenceV1Enabled() && intelligence) {
      intelligence = appendIntelligenceStep(intelligence, {
        layer: "composer",
        decision:
          failed || aiMode === "error" ? "employee_model_failed" : "employee_model_reply",
        confidence: failed || aiMode === "error" ? 0.2 : metrics?.fallbackUsed ? 0.7 : 0.95,
        durationMs: metrics?.durationMs ?? 0,
        metadata: {
          aiMode,
          provider: employee.provider,
          model: metrics?.model,
          inputTokens: metrics?.inputTokens,
          outputTokens: metrics?.outputTokens,
        },
      });
      runMetadata.intelligence = intelligenceMetadata(intelligence);
      intelligenceTrace = await buildAndPersistIntelligenceTrace(client, {
        workspaceId,
        runId,
        runMetadata,
        roomKind: ctx.room.kind === "dm" ? "dm" : "room",
        intelligence,
        employeeId,
        employeeName: employee.name,
        triggerMessageId,
        aiMode,
        dmSteward: runMetadata.dmSteward as Record<string, unknown> | undefined,
      });
    }

    return {
      reply: response.reply,
      aiMessageId: aiMessage.id,
      aiMode,
      employeeId,
      employeeName: employee.name,
      artifacts,
      followUpRuns,
      activatedRuns,
      collaborationPlan,
      intelligenceTrace,
      metrics: metrics
        ? {
            ...metrics,
            provider: employee.provider,
            modelMode,
            usageId,
            agentRunId: runId,
            fallbackTier: metrics.fallbackTier,
            structuredOutputSuccess: !metrics.fallbackUsed,
          }
        : undefined,
    };
  } catch (error) {
    const message = serializeUnknownError(error);
    await persistRunOrchestrationPhase(
      client,
      workspaceId,
      runMetadata,
      employeeId,
      "failed",
      { runId, detail: message },
    );
    await completeAgentRun(client, workspaceId, runId, {
      status: "failed",
      errorMessage: message,
    });
    if (usageId) {
      await finalizeUsage(client, usageId, {
        status: "failed",
        errorMessage: message,
      }).catch(() => {});
    }
    await appendRunStep(client, {
      workspaceId,
      agentRunId: runId,
      roomId,
      topicId,
      employeeId,
      stepType: "error",
      title: "Run failed",
      summary: message,
      status: "failed",
    }).catch(() => undefined);
    await client
      .from("ai_employees")
      .update({ status: "idle", last_active_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId);
    throw error;
  }
}
