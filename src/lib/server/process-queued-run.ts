import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { sanitizeEffects } from "@/lib/ai/sanitize-effects";
import { routeEmployeeResponse, type LiveCallMetrics } from "@/lib/ai/model-router";
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
import { assertChannelActive } from "@/lib/server/channel-helpers";
import {
  queueCollaboratorRuns,
  queueFollowUpRuns,
} from "@/lib/server/queue-follow-up-runs";
import { GREETING_MAX_OUTPUT_TOKENS } from "@/lib/server/channel-governance";
import type { QueuedRun } from "@/lib/server/queue-agent-runs";
import type { CollaborationRole, ConversationPlan } from "@/lib/types";
import { serializeUnknownError } from "@/lib/server/message-errors";
import { nowISO } from "@/lib/utils";

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
  const roomId = String(run.channel_id);
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
  await assertChannelActive(client, workspaceId, roomId);

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

    const conversationMode =
      typeof runMetadata.conversationMode === "string"
        ? runMetadata.conversationMode
        : undefined;

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

    const { response, aiMode, metrics, failed, errorMessage } = await routeEmployeeResponse(
      {
        employee,
        room: roomWithMessages,
        topic: ctx.topic,
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
      },
      {
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
      },
    );

    let effect = enforceEmployeePermissions(employee, response.effect);
    effect = sanitizeEffects(effect, {
      isGreetingRun,
      stripAllEffects: collaborationOnly && !effect.tasks.length,
    });

    const { aiMessage, artifacts } = await persistEmployeeEffects(
      client,
      workspaceId,
      roomId,
      topicId,
      employee,
      response.reply,
      effect,
      triggerMessageId,
      runId,
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
