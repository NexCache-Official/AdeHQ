import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENABLE_DEMO_MODE,
  isSiliconFlowConfigured,
  normalizeLiveProvider,
  type LiveProvider,
} from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { callSiliconFlowEmployee } from "@/lib/ai/siliconflow-call";
import {
  inferOutputTokenCap,
  inferTemperature,
  sanitizeReplyForChat,
} from "@/lib/ai/normalize-model-response";
import {
  estimateCost,
  normalizeModelMode,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import { sendMessageToEmployee } from "./employee-engine";
import { buildEmployeeSystemPrompt, buildEmployeeUserPrompt } from "./prompts";
import type { EmployeeResponse, SendMessageInput } from "./types";

type RouteContext = {
  workspaceId?: string;
  roomId?: string;
  topicId?: string;
  agentRunId?: string;
  client?: SupabaseClient;
};

export type RouteOptions = {
  mode?: "mock" | "live";
  provider?: string;
  modelMode?: ModelMode;
  maxOutputTokens?: number;
  timeoutMs?: number;
  isGreetingRun?: boolean;
  collaborationRole?: string;
  leadEmployeeName?: string;
  leadReply?: string;
  conversationMode?: string;
  context?: RouteContext;
};

function normalizeHandoff(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value];
  return undefined;
}

function toEmployeeResponse(
  employeeId: string,
  employeeName: string,
  reply: string,
  effects: EmployeeResponse["effect"],
): EmployeeResponse {
  return {
    employeeId,
    employeeName,
    reply,
    effect: {
      workLog: effects.workLog ?? [],
      tasks: effects.tasks ?? [],
      memory: effects.memory ?? [],
      approvals: effects.approvals ?? [],
      emailDrafts: effects.emailDrafts ?? [],
      statusChange: effects.statusChange,
    handoffTo: normalizeHandoff(effects.handoffTo),
    currentTask: effects.currentTask,
    citations: effects.citations ?? [],
    artifacts: effects.artifacts ?? [],
    memorySuggestions: effects.memorySuggestions ?? [],
  },
};
}

function errorResponse(
  input: SendMessageInput,
  reason: string,
  ctx: RouteContext,
  provider: string,
  model: string,
  modelMode: string,
  error?: string,
): { response: EmployeeResponse; aiMode: string } {
  recordAiRuntime({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    employeeId: input.employee.id,
    agentRunId: ctx.agentRunId,
    provider,
    model,
    modelMode,
    mode: "fallback",
    fallbackReason: reason,
    error,
  });

  return {
    response: {
      employeeId: input.employee.id,
      employeeName: input.employee.name,
      reply:
        `I couldn't complete a live model response right now.\n\n` +
        `**Reason:** ${error ?? reason}\n\n` +
        `Check **Settings → AI Runtime** to verify provider keys and model configuration.`,
      effect: {
        workLog: [
          {
            action: "Model error",
            summary: error ?? reason,
            status: "failed",
          },
        ],
        tasks: [],
        memory: [],
        approvals: [],
        statusChange: "idle",
      },
    },
    aiMode: "error",
  };
}

async function scriptedFallback(
  input: SendMessageInput,
  reason: string,
  ctx: RouteContext,
  provider: string,
  model: string,
  modelMode: string,
  error?: string,
): Promise<{ response: EmployeeResponse; aiMode: string }> {
  const resolved = await sendMessageToEmployee(input);
  resolved.effect.workLog.push({
    action: "Model fallback",
    summary: reason,
    status: "failed",
  });
  recordAiRuntime({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    employeeId: input.employee.id,
    agentRunId: ctx.agentRunId,
    provider,
    model,
    modelMode,
    mode: "fallback",
    fallbackReason: reason,
    error,
  });
  return { response: resolved, aiMode: "fallback" };
}

export type LiveCallMetrics = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  fallbackTier?: number;
  fallbackUsed: boolean;
  estimatedCostUsd: number;
  durationMs: number;
};

export async function routeEmployeeResponse(
  input: SendMessageInput & {
    workspaceName: string;
    openTasks: { id: string; title: string; status: string; priority: string }[];
    humanParticipants: { id: string; name: string }[];
  },
  options: RouteOptions = {},
): Promise<{
  response: EmployeeResponse;
  aiMode: string;
  metrics?: LiveCallMetrics;
  failed?: boolean;
  errorMessage?: string;
}> {
  const ctx = options.context ?? {};
  const provider: LiveProvider = normalizeLiveProvider(
    options.provider ?? input.employee.provider,
  );
  const modelMode = normalizeModelMode(
    options.modelMode ?? input.employee.modelMode,
  );
  const model = resolveModel(provider, modelMode, input.employee.model);
  const baseMaxTokens = options.maxOutputTokens ?? 2000;
  const maxOutputTokens = inferOutputTokenCap(input.message, baseMaxTokens);
  const temperature = inferTemperature(input.message);
  const timeoutMs = options.timeoutMs ?? 45_000;

  const promptContext = {
    employee: input.employee,
    workspace: { id: "", name: input.workspaceName, plan: "founder", workspaceMode: "real" as const },
    room: input.room,
    topic: input.topic,
    topicSummary: input.topicSummary,
    recentMessages: input.room.messages,
    recentMemory: input.recentMemory,
    openTasks: input.openTasks,
    roomEmployees: input.allEmployees.map((e) => ({ id: e.id, name: e.name, role: e.role })),
    humanParticipants: input.humanParticipants,
    userMessage: input.message,
    fileContextPrompt: input.fileContextPrompt,
    artifactIntent: input.artifactIntent,
  };

  if (provider === "mock" || options.mode === "mock") {
    const response = await sendMessageToEmployee(input);
    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider: "mock",
      model: "scripted",
      modelMode,
      mode: "mock",
    });
    return { response, aiMode: "mock" };
  }

  if (!isSiliconFlowConfigured()) {
    return errorResponse(
      input,
      "SILICONFLOW_API_KEY is not configured on the server.",
      ctx,
      provider,
      model,
      modelMode,
    );
  }

  const started = Date.now();
  try {
    const system = buildEmployeeSystemPrompt(promptContext, {
      isGreetingRun: options.isGreetingRun,
      collaborationRole: options.collaborationRole,
      leadEmployeeName: options.leadEmployeeName,
      leadReply: options.leadReply,
      conversationMode: options.conversationMode,
    });
    const prompt = buildEmployeeUserPrompt(promptContext);

    if (ctx.client && ctx.agentRunId && ctx.workspaceId && ctx.roomId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId,
        employeeId: input.employee.id,
        stepType: "model_call",
        title: "Calling model",
        summary: `${provider}/${model}`,
        status: "running",
      });
    }

    const result = await callSiliconFlowEmployee(
      system,
      prompt,
      model,
      maxOutputTokens,
      timeoutMs,
      temperature,
    );

    const durationMs = Date.now() - started;
    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const estimatedCostUsd = estimateCost(result.model, inputTokens, outputTokens);
    const fallbackUsed = !result.structuredOutputUsed || (result.fallbackTier ?? 1) > 1;

    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider,
      model: result.model,
      modelMode,
      mode: "live",
      durationMs,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
      estimatedCostUsd,
      fallbackTier: result.fallbackTier,
    });

    if (result.response.effect.handoffTo?.length && ctx.client && ctx.agentRunId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId!,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId!,
        employeeId: input.employee.id,
        stepType: "thinking",
        title: "Handoff suggested",
        summary: `Suggested: ${result.response.effect.handoffTo.join(", ")} (not auto-executed)`,
        status: "skipped",
      });
    }

    return {
      response: toEmployeeResponse(
        input.employee.id,
        input.employee.name,
        sanitizeReplyForChat(result.response.reply),
        result.response.effect,
      ),
      aiMode: provider,
      metrics: {
        model: result.model,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
        fallbackTier: result.fallbackTier,
        fallbackUsed,
        estimatedCostUsd,
        durationMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model request failed";
    if (ENABLE_DEMO_MODE) {
      return scriptedFallback(
        input,
        "Live call failed; used fallback response.",
        ctx,
        provider,
        model,
        modelMode,
        message,
      );
    }
    const err = errorResponse(input, "Model call failed.", ctx, provider, model, modelMode, message);
    return { ...err, failed: true, errorMessage: message };
  }
}
