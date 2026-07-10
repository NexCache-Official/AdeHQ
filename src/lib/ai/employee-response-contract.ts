import type { z } from "zod";
import {
  defaultModelModeForRole,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { createAmbientContext } from "@/lib/ai/ambient-context";
import {
  inferOutputTokenCap,
  inferTemperature,
  sanitizeReplyForChat,
} from "@/lib/ai/normalize-model-response";
import { buildEmployeeSystemPrompt, buildEmployeeUserPrompt } from "@/lib/ai/prompts";
import type { EmployeePromptTier } from "@/lib/ai/prompts";
import { getResearchCapabilities } from "@/lib/ai/research/research-planner";
import { messageLikelyNeedsStructuredEffects } from "@/lib/ai/message-intent";
import { ModelResponseSchema } from "@/lib/ai/schemas";
import type { AiCapability, ReasoningProfile } from "@/lib/ai/runtime/types";
import type { EmployeeResponse, EmployeeRoleKey, SendMessageInput } from "@/lib/types";

/** Shared schema for structured employee replies (legacy + Runtime V2). */
export { ModelResponseSchema };

/** Metrics shape returned by legacy routeEmployeeResponse live calls. */
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

/** Input contract shared by model-router and Runtime V2 hot-path helpers. */
export type EmployeeRouteInput = SendMessageInput & {
  workspaceName: string;
  openTasks: { id: string; title: string; status: string; priority: string }[];
  humanParticipants: { id: string; name: string }[];
};

export type EmployeePromptBuildOptions = {
  isGreetingRun?: boolean;
  collaborationRole?: string;
  leadEmployeeName?: string;
  leadReply?: string;
  conversationMode?: string;
  promptTier?: EmployeePromptTier;
  /** Emit a plain-prose contract instead of the JSON envelope (for streaming). */
  plainProse?: boolean;
};

export type EmployeeRouteGenerationParams = {
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
};

function normalizeHandoff(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value];
  return undefined;
}

/** Build prompt context — same fields as legacy model-router. */
export function buildEmployeePromptContext(input: EmployeeRouteInput) {
  const userName = input.humanParticipants[0]?.name;
  return {
    employee: input.employee,
    workspace: {
      id: "",
      name: input.workspaceName,
      plan: "founder" as const,
      workspaceMode: "real" as const,
    },
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
    researchCapabilities: getResearchCapabilities(input.employee),
    importedContextPrompt: input.importedContextPrompt,
    ambientContext: createAmbientContext({
      workspaceName: input.workspaceName,
      userName,
    }),
  };
}

/** Build system + user prompts without changing prompt text. */
export function buildEmployeePrompts(
  input: EmployeeRouteInput,
  options: EmployeePromptBuildOptions = {},
) {
  const promptContext = buildEmployeePromptContext(input);
  return {
    promptContext,
    system: buildEmployeeSystemPrompt(promptContext, {
      isGreetingRun: options.isGreetingRun,
      collaborationRole: options.collaborationRole,
      leadEmployeeName: options.leadEmployeeName,
      leadReply: options.leadReply,
      conversationMode: options.conversationMode,
      promptTier: options.promptTier,
      plainProse: options.plainProse,
    }),
    prompt: buildEmployeeUserPrompt(promptContext, {
      promptTier: options.promptTier,
    }),
  };
}

/** Map Runtime V2 ModelResponseSchema object → EmployeeResponse. */
export function mapModelSchemaToEmployeeResponse(
  employeeId: string,
  employeeName: string,
  object: z.infer<typeof ModelResponseSchema>,
): EmployeeResponse {
  return {
    employeeId,
    employeeName,
    reply: sanitizeReplyForChat(object.reply),
    effect: {
      workLog: object.effects.workLog ?? [],
      tasks: object.effects.tasks ?? [],
      memory: object.effects.memory ?? [],
      approvals: object.effects.approvals ?? [],
      emailDrafts: object.effects.emailDrafts ?? [],
      citations: object.effects.citations ?? [],
      artifacts: object.effects.artifacts ?? [],
      memorySuggestions: object.effects.memorySuggestions ?? [],
      toolCalls: object.effects.toolCalls ?? [],
      autopilot: object.effects.autopilot,
      statusChange: object.effects.statusChange,
      handoffTo: object.effects.handoffTo,
      currentTask: object.effects.currentTask,
    },
  };
}

/** Legacy SiliconFlow path — preserves handoff normalization. */
export function toEmployeeResponseFromReplyAndEffect(
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
      toolCalls: effects.toolCalls ?? [],
      autopilot: effects.autopilot,
    },
  };
}

/**
 * Minimum output budget for a message that needs the model to emit a real
 * effects.toolCalls entry. A short message ("just add this contact") maps to a
 * small token cap under the length-based heuristic below, but still needs room
 * for a natural reply PLUS a valid tool-call JSON block — a tight cap starves
 * the JSON and the tool call silently never gets populated.
 */
const TOOL_WORK_MIN_TOKENS = 900;

/** Token/temperature/timeout params shared by legacy + runtime paths. */
export function resolveRouteGenerationParams(
  message: string,
  options: { maxOutputTokens?: number; timeoutMs?: number } = {},
): EmployeeRouteGenerationParams {
  const baseMaxTokens = options.maxOutputTokens ?? 2000;
  const lengthBasedCap = inferOutputTokenCap(message, baseMaxTokens);
  const maxOutputTokens = messageLikelyNeedsStructuredEffects(message)
    ? Math.max(lengthBasedCap, Math.min(TOOL_WORK_MIN_TOKENS, baseMaxTokens))
    : lengthBasedCap;
  return {
    maxOutputTokens,
    temperature: inferTemperature(message),
    timeoutMs: options.timeoutMs ?? 45_000,
  };
}

/** Direct path model mode — employee override or role default (unchanged from d-2). */
export function resolveDirectEmployeeModelMode(
  employeeModelMode: ModelMode | null | undefined,
  roleKey: EmployeeRoleKey,
): ModelMode {
  return employeeModelMode ?? defaultModelModeForRole(roleKey);
}

export function reasoningProfileForCapability(capability: AiCapability): ReasoningProfile {
  return capability === "quick_reply" ? "none" : "low";
}

export function runtimeLiveMetricsFromUsage(usage: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  totalCostUsd: number;
  latencyMs: number;
}): LiveCallMetrics {
  return {
    model: usage.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cacheReadTokens,
    fallbackUsed: false,
    estimatedCostUsd: usage.totalCostUsd,
    durationMs: usage.latencyMs,
  };
}
