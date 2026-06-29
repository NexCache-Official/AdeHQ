import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { routeEmployeeResponse } from "@/lib/ai/model-router";
import { finalizeAiRun } from "@/lib/ai/cost-guard";
import {
  defaultModelModeForRole,
  getOutputTokenCap,
  getTimeoutMs,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import { loadTopicContext, persistEmployeeEffects } from "@/lib/server/room-messages";

type DbRow = Record<string, unknown>;

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
}> {
  const { data: runRow, error: runError } = await client
    .from("agent_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .single();
  if (runError || !runRow) throw new Error("Agent run not found.");

  const run = runRow as DbRow;
  const status = String(run.status);
  if (status !== "queued" && status !== "running") {
    throw new Error(`Agent run is ${status}, not processable.`);
  }

  const employeeId = String(run.employee_id);
  const roomId = String(run.room_id);
  const topicId = run.topic_id ? String(run.topic_id) : "";
  const triggerMessageId = String(run.trigger_message_id);

  if (!topicId) throw new Error("Agent run missing topic.");

  const { data: usageRow } = await client
    .from("ai_usage_events")
    .select("id, estimated_max_output_tokens")
    .eq("agent_run_id", runId)
    .maybeSingle();

  const usageId = usageRow?.id ? String(usageRow.id) : undefined;
  const maxOutputTokens = usageRow?.estimated_max_output_tokens
    ? Number(usageRow.estimated_max_output_tokens)
    : undefined;

  await client
    .from("agent_runs")
    .update({ status: "running" })
    .eq("workspace_id", workspaceId)
    .eq("id", runId);

  const ctx = await loadTopicContext(client, workspaceId, roomId, topicId);
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) throw new Error("Employee not found in this room.");

  const { data: triggerMsg } = await client
    .from("messages")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("id", triggerMessageId)
    .maybeSingle();

  const content = options.content ?? (triggerMsg?.content ? String(triggerMsg.content) : "");

  await client
    .from("ai_employees")
    .update({ status: "working", last_active_at: new Date().toISOString() })
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

  const modelMode: ModelMode = employee.modelMode ?? defaultModelModeForRole(employee.roleKey);
  const isLive = options.mode !== "mock" && employee.provider.toLowerCase() !== "mock";

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
        createdAt: new Date().toISOString(),
      },
    ],
  };

  if (!isLive || !usageId) {
    const reply = `I'm ${employee.name}. Live AI is not configured for this employee.`;
    const { aiMessage } = await persistEmployeeEffects(
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
    return {
      reply,
      aiMessageId: aiMessage.id,
      aiMode: "mock",
      employeeId,
      employeeName: employee.name,
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
      maxOutputTokens: maxOutputTokens ?? getOutputTokenCap(modelMode),
      timeoutMs: getTimeoutMs(modelMode),
      context: {
        workspaceId,
        roomId,
        topicId,
        agentRunId: runId,
        client,
      },
    },
  );

  const effect = enforceEmployeePermissions(employee, response.effect);

  const { aiMessage } = await persistEmployeeEffects(
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
    .update({ status: "idle", last_active_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId);

  return {
    reply: response.reply,
    aiMessageId: aiMessage.id,
    aiMode,
    employeeId,
    employeeName: employee.name,
  };
}
