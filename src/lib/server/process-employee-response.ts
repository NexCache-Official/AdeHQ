import type { SupabaseClient } from "@supabase/supabase-js";
import { createAmbientContext } from "@/lib/ai/ambient-context";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { dispatchEmployeeDirectResponse } from "@/lib/ai/runtime/employee-direct-runtime";
import { beginAiRun, finalizeAiRun } from "@/lib/ai/cost-guard";
import {
  defaultModelModeForRole,
  getOutputTokenCap,
  getTimeoutMs,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import type { EmployeeResponse } from "@/lib/types";
import { persistEmployeeEffects, type RoomContext } from "@/lib/server/room-messages";
import {
  buildFileContextPrompt,
  detectArtifactIntent,
  loadAttachmentFileIds,
  retrieveFileContext,
} from "@/lib/server/file-context";
import { executeVisionUnderstanding, shouldRunVision } from "@/lib/brain/vision";
import { buildWorkHoursBudgetPrompt } from "@/lib/brain/video";
import { isBrainVideoV1Enabled, isBrainImageV1Enabled } from "@/lib/brain/flags";
import { inferArtifactsFromReply } from "@/lib/artifacts/intelligence";
import { resolveRunModelMode } from "@/lib/ai/resolve-run-model-mode";
import { ensureDefaultEmployeeToolGrants } from "@/lib/integrations/permissions";
import {
  planEmployeeReplyShadowRun,
  recordEmployeeReplyShadowResult,
  resolveEmployeeShadowOldModel,
} from "@/lib/ai/runtime/hot-path-shadow";
import { resolveInstantAnswer } from "@/lib/ai/intelligence/instant-answers";
import { resolveEmployeePromptTier } from "@/lib/ai/employee-prompt-tier";

export type ProcessEmployeeOptions = {
  mode?: "mock" | "live";
  triggerMessageId?: string;
  skipCostGuard?: boolean;
  /** Human who initiated the response — stamps Brain reliability envelope. */
  initiatedByUserId?: string;
};

export async function processEmployeeResponse(
  client: SupabaseClient,
  ctx: RoomContext,
  employeeId: string,
  content: string,
  options: ProcessEmployeeOptions = {},
): Promise<EmployeeResponse & { aiMessageId: string; aiMode: string; agentRunId?: string }> {
  const roomEmployee = ctx.employees.find((e) => e.id === employeeId);
  if (!roomEmployee) {
    throw new Error("Employee not found in this room.");
  }

  if (!ctx.room.aiEmployees.includes(employeeId)) {
    throw new Error("Employee is not a member of this room.");
  }

  // Seed default integration tool grants for employees hired before the
  // Integration Layer, so the prompt lists the tools they can actually use.
  const employee = await ensureDefaultEmployeeToolGrants(client, ctx.workspaceId, roomEmployee);

  const instant = resolveInstantAnswer({
    message: content,
    ambient: createAmbientContext({
      workspaceName: ctx.workspaceName,
      userName: ctx.humanParticipants[0]?.name,
    }),
    employeeName: employee.name,
    roomName: ctx.room.name,
    topicTitle: ctx.topic.title,
    topicDescription: ctx.topic.description,
    topicSummary: ctx.topicSummary?.summary,
    openTasks: ctx.openTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
    })),
    roomEmployees: ctx.employees.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
    })),
    humanParticipants: ctx.humanParticipants,
  });

  if (instant) {
    const { aiMessage } = await persistEmployeeEffects(
      client,
      ctx.workspaceId,
      ctx.room.id,
      ctx.topic.id,
      employee,
      instant.reply,
      { workLog: [], tasks: [], memory: [], approvals: [] },
      options.triggerMessageId,
    );

    await client
      .from("ai_employees")
      .update({ status: "idle", last_active_at: new Date().toISOString() })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", employeeId);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      reply: instant.reply,
      effect: { workLog: [], tasks: [], memory: [], approvals: [] },
      aiMessageId: aiMessage.id,
      aiMode: "instant_answer",
    };
  }

  await client
    .from("ai_employees")
    .update({ status: "working", last_active_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", employeeId);

  const topicId = ctx.topic.id;
  const attachmentFileIds = options.triggerMessageId
    ? await loadAttachmentFileIds(client, ctx.workspaceId, options.triggerMessageId)
    : [];
  const artifactIntent = detectArtifactIntent(content);
  const fileContextBundle = await retrieveFileContext(client, ctx.workspaceId, topicId, {
    userMessage: content,
    priorityFileIds: attachmentFileIds,
  });
  let fileContextPrompt = buildFileContextPrompt(fileContextBundle);
  const usedFileContext = fileContextBundle.chunks.length > 0;

  if (
    shouldRunVision({
      attachmentFileIds,
      hasVisualAssets: attachmentFileIds.length > 0,
      userMessage: content,
    })
  ) {
    try {
      const vision = await executeVisionUnderstanding({
        client,
        workspaceId: ctx.workspaceId,
        roomId: ctx.room.id,
        topicId,
        employeeId,
        messageId: options.triggerMessageId,
        userMessage: content,
        attachmentFileIds,
      });
      if (vision?.promptBlock) {
        fileContextPrompt = [fileContextPrompt, vision.promptBlock].filter(Boolean).join("\n\n");
      }
    } catch (error) {
      console.warn(
        "[AdeHQ vision] skipped (direct)",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (isBrainVideoV1Enabled() || isBrainImageV1Enabled()) {
    try {
      const budgetPrompt = await buildWorkHoursBudgetPrompt(client, ctx.workspaceId);
      if (budgetPrompt) {
        fileContextPrompt = [fileContextPrompt, budgetPrompt].filter(Boolean).join("\n\n");
      }
    } catch (error) {
      console.warn(
        "[AdeHQ video] WH budget context skipped (direct)",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const roomWithMessages = {
    ...ctx.room,
    messages: [
      ...ctx.room.messages,
      {
        id: options.triggerMessageId ?? "trigger",
        roomId: ctx.room.id,
        topicId,
        senderType: "human" as const,
        senderId: "user",
        senderName: "User",
        content,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const isLive = options.mode !== "mock" && employee.provider.toLowerCase() !== "mock";
  const modelMode: ModelMode = employee.modelMode ?? defaultModelModeForRole(employee.roleKey);
  const provider = employee.provider.toLowerCase();
  const promptTier = resolveEmployeePromptTier({
    message: content,
    workMode: undefined,
    hasFileContext: usedFileContext,
    hasArtifactIntent: Boolean(artifactIntent),
    hasImportedContext: Boolean(ctx.importedContextBlock),
  });

  let runId: string | undefined;
  let brainRunId: string | undefined;
  let usageId: string | undefined;
  let maxOutputTokens: number | undefined;

  if (isLive && !options.skipCostGuard && options.triggerMessageId) {
    const begun = await beginAiRun({
      client,
      workspaceId: ctx.workspaceId,
      employeeId,
      roomId: ctx.room.id,
      topicId,
      triggerMessageId: options.triggerMessageId,
      provider,
      modelMode,
      promptLength: content.length,
      explicitModel: employee.model,
    });

    if (!begun.ok) {
      const blockedReply: EmployeeResponse = {
        employeeId: employee.id,
        employeeName: employee.name,
        reply: `I couldn't run right now.\n\n**Reason:** ${begun.reason}`,
        effect: {
          workLog: [{ action: "Run blocked", summary: begun.reason, status: "failed" }],
          tasks: [],
          memory: [],
          approvals: [],
          statusChange: "idle",
        },
      };

      const { aiMessage } = await persistEmployeeEffects(
        client,
        ctx.workspaceId,
        ctx.room.id,
        topicId,
        employee,
        blockedReply.reply,
        blockedReply.effect,
        options.triggerMessageId,
      );

      return { ...blockedReply, aiMessageId: aiMessage.id, aiMode: "blocked" };
    }

    runId = begun.runId;
    usageId = begun.usageId;
    maxOutputTokens = begun.maxOutputTokens;

    // PR-17.5: stamp unified Brain run + permission envelope (non-fatal)
    const initiatorId =
      options.initiatedByUserId ?? ctx.humanParticipants[0]?.id ?? null;
    if (initiatorId) {
      try {
        const { beginUnifiedBrainRun } = await import("@/lib/brain/reliability/lifecycle");
        const intensity =
          modelMode === "cheap"
            ? "fast"
            : modelMode === "strong"
              ? "deep"
              : modelMode === "long_context"
                ? "research"
                : "standard";
        const begunBrain = await beginUnifiedBrainRun(client, {
          workspaceId: ctx.workspaceId,
          initiatedByUserId: initiatorId,
          leadEmployeeId: employeeId,
          roomId: ctx.room.id,
          topicId,
          triggerMessageId: options.triggerMessageId,
          intensity,
          agentRunId: runId,
        });
        brainRunId = begunBrain.brainRunId;
        const { data: existingRun } = await client
          .from("agent_runs")
          .select("run_metadata")
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", runId)
          .maybeSingle();
        const priorMeta =
          existingRun?.run_metadata && typeof existingRun.run_metadata === "object"
            ? (existingRun.run_metadata as Record<string, unknown>)
            : {};
        await client
          .from("agent_runs")
          .update({
            run_metadata: { ...priorMeta, brainRunId, reliability: "pr17_5" },
          })
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", runId);
      } catch (err) {
        console.warn("[AdeHQ brain reliability] beginUnifiedBrainRun", err);
      }
    }

    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "thinking",
      title: "Preparing response",
      summary: `${provider} · ${modelMode}`,
      status: "running",
    });
  }

  const { oldProvider, oldModel, oldModelMode } = resolveEmployeeShadowOldModel({
    provider: employee.provider,
    modelMode,
    explicitModel: employee.model,
  });
  const shadowResolvedModelMode = resolveRunModelMode({
    roleKey: employee.roleKey,
    employeeModelMode: employee.modelMode,
    userMessage: content,
  });
  const dmId = ctx.room.kind === "dm" ? ctx.room.dmEmployeeId : undefined;

  const shadowPlan = await planEmployeeReplyShadowRun({
    client,
    workspaceId: ctx.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roleKey: employee.roleKey,
    roomId: ctx.room.id,
    topicId,
    dmId,
    messageId: options.triggerMessageId,
    userMessage: content,
    oldProvider,
    oldModel,
    oldModelMode,
    resolvedRunModelMode: shadowResolvedModelMode,
    artifactIntent: artifactIntent ?? undefined,
    agentRunId: runId,
    source: "employee_direct_response_shadow",
  });

  const routeInput = {
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
    fileContextPrompt: fileContextPrompt || undefined,
    artifactIntent,
    importedContextPrompt: ctx.importedContextBlock,
  };
  const routeOptions = {
    mode: options.mode,
    provider: employee.provider,
    modelMode,
    promptTier,
    maxOutputTokens: maxOutputTokens ?? getOutputTokenCap(modelMode),
    timeoutMs: getTimeoutMs(modelMode),
    context: {
      workspaceId: ctx.workspaceId,
      roomId: ctx.room.id,
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
  } = await dispatchEmployeeDirectResponse(routeInput, routeOptions);

  await recordEmployeeReplyShadowResult({
    client,
    workspaceId: ctx.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roleKey: employee.roleKey,
    roomId: ctx.room.id,
    topicId,
    dmId,
    messageId: options.triggerMessageId,
    userMessage: content,
    oldProvider,
    oldModel,
    oldModelMode,
    resolvedRunModelMode: shadowResolvedModelMode,
    artifactIntent: artifactIntent ?? undefined,
    agentRunId: runId,
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
    source: "employee_direct_response_shadow",
  });

  const effect = enforceEmployeePermissions(employee, response.effect);

  const inferred = inferArtifactsFromReply(
    content,
    response.reply,
    effect.artifacts ?? [],
    effect.emailDrafts ?? [],
  );
  const mergedEffect = {
    ...effect,
    artifacts: inferred.artifacts,
    emailDrafts: inferred.emailDrafts,
  };
  const finalReply = inferred.reply;

  if (runId && effect.memory.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "memory_write",
      title: "Saving memory",
      summary: `${effect.memory.length} entr${effect.memory.length === 1 ? "y" : "ies"}`,
      status: "success",
    });
  }
  if (runId && effect.tasks.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "task_create",
      title: "Creating tasks",
      summary: `${effect.tasks.length} task(s)`,
      status: "success",
    });
  }
  if (runId && effect.approvals.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "approval_request",
      title: "Requesting approval",
      summary: effect.approvals.map((a) => a.title).join(", "),
      status: "success",
    });
  }

  const { aiMessage } = await persistEmployeeEffects(
    client,
    ctx.workspaceId,
    ctx.room.id,
    topicId,
    employee,
    finalReply,
    mergedEffect,
    options.triggerMessageId,
    runId,
    {
      fileContext: fileContextBundle,
      usedFileContext,
    },
  );

  if (isLive && runId && usageId && !options.skipCostGuard) {
    await finalizeAiRun({
      client,
      workspaceId: ctx.workspaceId,
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
  }

  if (brainRunId) {
    try {
      const { finishBrainRun } = await import("@/lib/brain/reliability/lifecycle");
      await finishBrainRun(
        client,
        brainRunId,
        failed || aiMode === "error" ? "failed" : "completed",
      );
    } catch (err) {
      console.warn("[AdeHQ brain reliability] finishBrainRun", err);
    }
  }

  return {
    ...response,
    reply: finalReply,
    effect: mergedEffect,
    aiMessageId: aiMessage.id,
    aiMode,
    agentRunId: runId,
  };
}
