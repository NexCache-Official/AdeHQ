import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { DEFAULT_OPENAI_MODEL } from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { sendMessageToEmployee } from "./employee-engine";
import { buildEmployeeSystemPrompt, buildEmployeeUserPrompt } from "./prompts";
import { ModelResponseSchema } from "./schemas";
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
  effects: {
    workLog?: EmployeeResponse["effect"]["workLog"];
    tasks?: EmployeeResponse["effect"]["tasks"];
    memory?: EmployeeResponse["effect"]["memory"];
    approvals?: EmployeeResponse["effect"]["approvals"];
    statusChange?: EmployeeResponse["effect"]["statusChange"];
    handoffTo?: unknown;
    currentTask?: string;
  },
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

async function fallbackResponse(
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

export async function routeEmployeeResponse(
  input: SendMessageInput & {
    workspaceName: string;
    openTasks: { id: string; title: string; status: string; priority: string }[];
    humanParticipants: { id: string; name: string }[];
  },
  options: { mode?: "mock" | "live"; provider?: string; context?: RouteContext } = {},
): Promise<{ response: EmployeeResponse; aiMode: string }> {
  const ctx = options.context ?? {};
  const providerRaw = (input.employee.provider ?? "mock").toLowerCase();
  const provider = (
    providerRaw === "openai" ? "openai" : providerRaw === "mock" ? "mock" : providerRaw
  ) as ModelProvider;
  const model =
    input.employee.model?.trim() ||
    process.env.ADEHQ_OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL;

  if (provider === "mock") {
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
    return fallbackResponse(
      input,
      "Provider unsupported; used fallback response.",
      ctx,
      provider,
      model,
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return fallbackResponse(
      input,
      "OpenAI call failed; used fallback response. (OPENAI_API_KEY not configured)",
      ctx,
      provider,
      model,
    );
  }

  const started = Date.now();
  try {
    const system = buildEmployeeSystemPrompt({
      employee: input.employee,
      workspace: { id: "", name: input.workspaceName, plan: "founder", workspaceMode: "real" },
      room: input.room,
      recentMessages: input.room.messages,
      recentMemory: input.recentMemory,
      openTasks: input.openTasks,
      roomEmployees: input.allEmployees.map((e) => ({ id: e.id, name: e.name, role: e.role })),
      humanParticipants: input.humanParticipants,
      userMessage: input.message,
    });

    const prompt = buildEmployeeUserPrompt({
      employee: input.employee,
      workspace: { id: "", name: input.workspaceName, plan: "founder", workspaceMode: "real" },
      room: input.room,
      recentMessages: input.room.messages,
      recentMemory: input.recentMemory,
      openTasks: input.openTasks,
      roomEmployees: input.allEmployees.map((e) => ({ id: e.id, name: e.name, role: e.role })),
      humanParticipants: input.humanParticipants,
      userMessage: input.message,
    });

    const result = await generateObject({
      model: openai(model),
      schema: ModelResponseSchema,
      system,
      prompt,
      temperature: 0.45,
    });

    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      provider: "openai",
      model,
      mode: "live",
      durationMs: Date.now() - started,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });

    return {
      response: toEmployeeResponse(
        input.employee.id,
        input.employee.name,
        result.object.reply,
        result.object.effects,
      ),
      aiMode: "openai",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed";
    return fallbackResponse(
      input,
      "OpenAI call failed; used fallback response.",
      ctx,
      provider,
      model,
      message,
    );
  }
}
