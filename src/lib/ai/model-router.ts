import { ENABLE_DEMO_MODE, DEFAULT_OPENAI_MODEL } from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { callOpenAiEmployee } from "@/lib/ai/openai-call";
import { sendMessageToEmployee } from "./employee-engine";
import { buildEmployeeSystemPrompt, buildEmployeeUserPrompt } from "./prompts";
import type { EmployeeResponse, SendMessageInput } from "./types";
import type { ModelProvider } from "./types";

type RouteContext = {
  workspaceId?: string;
  roomId?: string;
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
      statusChange: effects.statusChange,
      handoffTo: normalizeHandoff(effects.handoffTo),
      currentTask: effects.currentTask,
    },
  };
}

function errorResponse(
  input: SendMessageInput,
  reason: string,
  ctx: RouteContext,
  provider: string,
  model: string,
  error?: string,
): { response: EmployeeResponse; aiMode: string } {
  recordAiRuntime({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    employeeId: input.employee.id,
    provider,
    model,
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
        `Check **Settings → AI Runtime** to verify \`OPENAI_API_KEY\` and the model (\`${model}\`) are configured on the server.`,
      effect: {
        workLog: [
          {
            action: "OpenAI error",
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
    provider,
    model,
    mode: "fallback",
    fallbackReason: reason,
    error,
  });
  return { response: resolved, aiMode: "fallback" };
}

function normalizeProvider(raw?: string): ModelProvider {
  const value = (raw ?? "mock").toLowerCase();
  if (value === "openai") return "openai";
  if (value === "mock") return "mock";
  return value as ModelProvider;
}

export async function routeEmployeeResponse(
  input: SendMessageInput & {
    workspaceName: string;
    openTasks: { id: string; title: string; status: string; priority: string }[];
    humanParticipants: { id: string; name: string }[];
  },
  options: { mode?: "mock" | "live"; provider?: string; context?: RouteContext } = {},
): Promise<{ response: EmployeeResponse; aiMode: string }> {
  const ctx = options.context ?? {};
  const provider = normalizeProvider(input.employee.provider);
  const model =
    input.employee.model?.trim() ||
    process.env.ADEHQ_OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL;

  const promptContext = {
    employee: input.employee,
    workspace: { id: "", name: input.workspaceName, plan: "founder", workspaceMode: "real" as const },
    room: input.room,
    recentMessages: input.room.messages,
    recentMemory: input.recentMemory,
    openTasks: input.openTasks,
    roomEmployees: input.allEmployees.map((e) => ({ id: e.id, name: e.name, role: e.role })),
    humanParticipants: input.humanParticipants,
    userMessage: input.message,
  };

  if (provider === "mock" || options.mode === "mock") {
    const response = await sendMessageToEmployee(input);
    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      provider: "mock",
      model: "scripted",
      mode: "mock",
    });
    return { response, aiMode: "mock" };
  }

  if (provider !== "openai") {
    if (ENABLE_DEMO_MODE) {
      return scriptedFallback(
        input,
        "Provider unsupported; used fallback response.",
        ctx,
        provider,
        model,
      );
    }
    return errorResponse(
      input,
      "Provider unsupported.",
      ctx,
      provider,
      model,
      `Employee provider "${input.employee.provider}" is not supported. Set provider to openai.`,
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return errorResponse(
      input,
      "OPENAI_API_KEY is not configured on the server.",
      ctx,
      provider,
      model,
    );
  }

  const started = Date.now();
  try {
    const system = buildEmployeeSystemPrompt(promptContext);
    const prompt = buildEmployeeUserPrompt(promptContext);

    const result = await callOpenAiEmployee(system, prompt, model);

    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      provider: "openai",
      model: result.model,
      mode: "live",
      durationMs: Date.now() - started,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    return {
      response: toEmployeeResponse(
        input.employee.id,
        input.employee.name,
        result.response.reply,
        result.response.effect,
      ),
      aiMode: "openai",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed";
    if (ENABLE_DEMO_MODE) {
      return scriptedFallback(
        input,
        "OpenAI call failed; used fallback response.",
        ctx,
        provider,
        model,
        message,
      );
    }
    return errorResponse(
      input,
      "OpenAI call failed.",
      ctx,
      provider,
      model,
      message,
    );
  }
}
