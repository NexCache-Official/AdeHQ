import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { routeEmployeeResponse } from "@/lib/ai/model-router";
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
import { inferArtifactsFromReply } from "@/lib/artifacts/intelligence";

export type ProcessEmployeeOptions = {
  mode?: "mock" | "live";
  triggerMessageId?: string;
  skipCostGuard?: boolean;
};

export async function processEmployeeResponse(
  client: SupabaseClient,
  ctx: RoomContext,
  employeeId: string,
  content: string,
  options: ProcessEmployeeOptions = {},
): Promise<EmployeeResponse & { aiMessageId: string; aiMode: string; agentRunId?: string }> {
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) {
    throw new Error("Employee not found in this room.");
  }

  if (!ctx.room.aiEmployees.includes(employeeId)) {
    throw new Error("Employee is not a member of this room.");
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
  const fileContextPrompt = buildFileContextPrompt(fileContextBundle);
  const usedFileContext = fileContextBundle.chunks.length > 0;

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

  let runId: string | undefined;
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
      fileContextPrompt: fileContextPrompt || undefined,
      artifactIntent,
    },
    {
      mode: options.mode,
      provider: employee.provider,
      modelMode,
      maxOutputTokens: maxOutputTokens ?? getOutputTokenCap(modelMode),
      timeoutMs: getTimeoutMs(modelMode),
      context: {
        workspaceId: ctx.workspaceId,
        roomId: ctx.room.id,
        topicId,
        agentRunId: runId,
        client,
      },
    },
  );

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

  return {
    ...response,
    reply: finalReply,
    effect: mergedEffect,
    aiMessageId: aiMessage.id,
    aiMode,
    agentRunId: runId,
  };
}
