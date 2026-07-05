import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { sanitizeEffects } from "@/lib/ai/sanitize-effects";
import { applyMentionEtiquette } from "@/lib/ai/mention-etiquette";
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
import { serializeUnknownError } from "@/lib/server/message-errors";
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
  planResearch,
} from "@/lib/ai/research";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
    const employee = ctx.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error("Employee not found in this room.");

    const { data: triggerMsg } = await client
      .from("messages")
      .select("content")
      .eq("workspace_id", workspaceId)
      .eq("id", triggerMessageId)
      .maybeSingle();

    let content = options.content ?? (triggerMsg?.content ? String(triggerMsg.content) : "");

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
    const fileContextPrompt = buildFileContextPrompt(fileContextBundle);
    const usedFileContext = fileContextBundle.chunks.length > 0;

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

    if (
      !isGreetingRun &&
      !collaborationOnly &&
      !artifactIntent &&
      canEmployeeUseBrowserResearch(employee)
    ) {
      const researchPlan = planResearch({
        messages: roomWithMessages.messages,
        userMessage: content,
        employee,
        preferTavily,
        preferAgentMode,
        excludeMessageId: triggerMessageId,
      });

      if (researchPlan.action === "search" || researchPlan.action === "browse") {
        await appendRunStep(client, {
          workspaceId,
          agentRunId: runId,
          roomId,
          topicId,
          employeeId,
          stepType: "tool_call",
          title: researchPlan.action === "browse" ? "Live browser research" : "Searching the web",
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

        try {
          const serviceClient = createServiceRoleClient();
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

          if (researchResult.async) {
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

            return {
              reply: "",
              aiMessageId: "",
              aiMode: "research_async",
              employeeId,
              employeeName: employee.name,
              researchRun: researchResult.run,
              pendingResearch: true,
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

          if (researchResult.chatReply) {
            await client
              .from("messages")
              .update({ agent_run_id: runId })
              .eq("workspace_id", workspaceId)
              .eq("id", researchResult.chatReply.id);

            await appendRunStep(client, {
              workspaceId,
              agentRunId: runId,
              roomId,
              topicId,
              employeeId,
              stepType: "tool_call",
              title: "Research complete",
              summary: `${researchResult.run.provider} · ${researchPlan.resolved.query.slice(0, 120)}`,
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
              actualCostUsd: researchResult.run.estimatedCostUsd ?? 0,
              failed: false,
            });

            await client
              .from("ai_employees")
              .update({ status: "idle", last_active_at: nowISO() })
              .eq("workspace_id", workspaceId)
              .eq("id", employeeId);

            if (!isGreetingRun) {
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

            return {
              reply: researchResult.chatReply.content,
              aiMessageId: researchResult.chatReply.id,
              aiMode: "research",
              employeeId,
              employeeName: employee.name,
              researchRun: researchResult.run,
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
        } catch (researchError) {
          console.warn("[AdeHQ research planner]", researchError);
          await appendRunStep(client, {
            workspaceId,
            agentRunId: runId,
            roomId,
            topicId,
            employeeId,
            stepType: "error",
            title: "Research failed",
            summary:
              researchError instanceof Error ? researchError.message : "Research failed",
            status: "failed",
          }).catch(() => undefined);
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
