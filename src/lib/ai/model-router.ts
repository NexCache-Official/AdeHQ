import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { sendMessageToEmployee } from "./employee-engine";
import { buildEmployeeSystemPrompt, buildEmployeeUserPrompt } from "./prompts";
import { ModelResponseSchema } from "./schemas";
import type { EmployeeResponse, SendMessageInput } from "./types";
import type { ModelProvider } from "./types";

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

export async function routeEmployeeResponse(
  input: SendMessageInput & {
    workspaceName: string;
    openTasks: { id: string; title: string; status: string; priority: string }[];
    humanParticipants: { id: string; name: string }[];
  },
  options: { mode?: "mock" | "live"; provider?: string } = {},
): Promise<{ response: EmployeeResponse; aiMode: string }> {
  const provider = (input.employee.provider ?? "mock") as ModelProvider;
  const wantsLive = options.mode === "live" || provider === "openai";
  const useOpenAI = wantsLive && provider === "openai" && Boolean(process.env.OPENAI_API_KEY);

  if (provider === "mock" || !useOpenAI) {
    const response = await sendMessageToEmployee(input);
    return {
      response,
      aiMode: provider === "mock" ? "mock" : "mock-fallback",
    };
  }

  try {
    const model = input.employee.model || process.env.ADEHQ_OPENAI_MODEL || "gpt-4o-mini";
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
    console.error("[AdeHQ model-router] OpenAI failed, using scripted fallback", error);
    const response = await sendMessageToEmployee(input);
    response.effect.workLog.push({
      action: "Model fallback",
      summary: "Live model failed, used scripted fallback.",
      status: "failed",
    });
    return { response, aiMode: "mock-fallback" };
  }
}
