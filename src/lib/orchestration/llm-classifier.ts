import { z } from "zod";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { generateObject as runtimeGenerateObject, planRoute } from "@/lib/ai/runtime";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { AIEmployeeProfile, OrchestrationIntent, OrchestrationPlan, OrchestratorInput } from "./types";
import { rankEmployeesForMessage } from "./employee-relevance";

const classifierSchema = z.object({
  intent: z.enum([
    "silent_note",
    "social_broadcast",
    "direct_reply",
    "panel_response",
    "lead_collaborator",
    "handoff",
    "ambient_smart_assist",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  selectedEmployeeIds: z.array(z.string()),
  leadEmployeeId: z.string().nullable().optional(),
  collaboratorEmployeeIds: z.array(z.string()).optional(),
  shouldRespond: z.boolean(),
  workLogRequired: z.boolean().optional(),
  workLogReason: z.string().nullable().optional(),
});

export type ClassifierObject = z.infer<typeof classifierSchema>;

export const orchestrationClassifierSchema = classifierSchema;

export type ClassifierGenerationOptions = {
  client?: SupabaseClient;
  sourceMessageCount?: number;
};

export type ClassifierRuntimeDispatch = "old" | "shadow" | "runtime-on";

export type ClassifierTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubOldResult?: Partial<OrchestrationPlan> | null;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
  /** @internal Test-only — records options passed into classifyWithLlm. */
  onOptionsReceived?: (options: ClassifierGenerationOptions) => void;
};

let classifierTestHooks: ClassifierTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setClassifierTestHooks(hooks: ClassifierTestHooks | null): void {
  classifierTestHooks = hooks;
}

export function getClassifierRuntimeDispatch(): ClassifierRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

function buildClassifierPrompt(input: OrchestratorInput, employees: AIEmployeeProfile[]): string {
  const employeeList = employees
    .map((e) => `- ${e.id}: ${e.name} (${e.role})`)
    .join("\n");

  const recent = input.recentMessages
    .slice(-8)
    .map((m) => `${m.senderType}: ${m.text}`)
    .join("\n");

  return `You are AdeHQ's Conversation Orchestrator.

AdeHQ is an operating system for AI employees. Your job is to decide how AI employees should participate in a workspace conversation without creating noise.

Classify the latest user message into exactly one intent:
- silent_note
- social_broadcast
- direct_reply
- panel_response
- lead_collaborator
- handoff
- ambient_smart_assist

You must select only the employees who should actually respond.
Do not trigger every employee.
Prefer silence when the user is making a note or having casual human discussion.
Prefer one concise response for greetings.
Use lead/collaborator when one employee should drive and others should support.
Use panel_response when the user clearly asks multiple employees for perspectives.
Use ambient_smart_assist only if Smart Assist is enabled or the message clearly asks for help.

Smart Assist enabled: ${input.smartAssistEnabled}

Room employees:
${employeeList}

Recent messages:
${recent}

Latest user message:
${input.messageText}

Return JSON only.`;
}

function mapClassifierObjectToPlan(
  object: ClassifierObject,
  employees: AIEmployeeProfile[],
): Partial<OrchestrationPlan> {
  const validIds = new Set(employees.map((e) => e.id));
  const selectedEmployeeIds = object.selectedEmployeeIds.filter((id) => validIds.has(id));
  const leadEmployeeId =
    object.leadEmployeeId && validIds.has(object.leadEmployeeId)
      ? object.leadEmployeeId
      : selectedEmployeeIds[0] ?? null;
  const collaboratorEmployeeIds = (object.collaboratorEmployeeIds ?? []).filter((id) =>
    validIds.has(id),
  );

  return {
    intent: object.intent as OrchestrationIntent,
    confidence: object.confidence,
    reason: object.reason,
    selectedEmployeeIds,
    leadEmployeeId,
    collaboratorEmployeeIds,
    shouldRespond: object.shouldRespond && selectedEmployeeIds.length > 0,
    suggestedActions: [],
    workLogRequired: Boolean(object.workLogRequired),
    workLogReason: object.workLogReason ?? null,
    responseOrder: buildResponseOrderFromSelection(
      object.intent as OrchestrationIntent,
      selectedEmployeeIds,
      leadEmployeeId,
      collaboratorEmployeeIds,
    ),
  };
}

/** Direct SiliconFlow path — unchanged from pre-Runtime V2 behavior. */
export async function classifyWithLlmOld(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
): Promise<Partial<OrchestrationPlan> | null> {
  if (classifierTestHooks?.stubOldResult !== undefined) {
    return classifierTestHooks.stubOldResult;
  }

  if (!isSiliconFlowConfigured()) return null;

  try {
    const { object } = await generateObject({
      model: siliconFlowChatModel(DEFAULT_SILICONFLOW_MODEL),
      providerOptions: siliconFlowProviderOptions(DEFAULT_SILICONFLOW_MODEL),
      schema: classifierSchema,
      prompt: buildClassifierPrompt(input, employees),
    });

    return mapClassifierObjectToPlan(object, employees);
  } catch (error) {
    console.warn("[AdeHQ orchestrator] LLM classifier failed", error);
    return null;
  }
}

async function recordClassifierShadowPlanning(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
  options: ClassifierGenerationOptions,
): Promise<void> {
  try {
    const prompt = buildClassifierPrompt(input, employees);
    const routing = planRoute(
      {
        capability: "classification",
        message: prompt.slice(0, 500),
        workspaceId: input.workspaceId,
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "orchestration_classify_shadow_plan",
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    if (options.client && input.workspaceId) {
      await createAiWorkUnit(options.client, {
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        topicId: input.topicId ?? undefined,
        workType: "orchestration_classify",
        capability: "classification",
        objective: "Shadow plan for orchestration classifier",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          topicId: input.topicId,
          roomId: input.roomId,
          messageId: input.messageId,
          sourceMessageCount: options.sourceMessageCount ?? input.recentMessages.length,
        },
      });
    }
  } catch (error) {
    console.warn("[AdeHQ orchestrator classifier shadow]", error);
  }
}

/** Runtime V2 path — used when AI_RUNTIME_V2_MODE=on. */
export async function classifyWithLlmRuntime(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
  options: ClassifierGenerationOptions = {},
): Promise<Partial<OrchestrationPlan> | null> {
  if (classifierTestHooks?.forceRuntimeFailure) {
    throw classifierTestHooks.forceRuntimeFailure instanceof Error
      ? classifierTestHooks.forceRuntimeFailure
      : new Error("Forced orchestration classifier runtime failure (test hook)");
  }

  let workUnitId: string | undefined;

  if (options.client && input.workspaceId) {
    try {
      const created = await createAiWorkUnit(options.client, {
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        topicId: input.topicId ?? undefined,
        workType: "orchestration_classify",
        capability: "classification",
        objective: "Classify orchestration intent",
        runtimeMode: "efficient",
        metadata: {
          topicId: input.topicId,
          roomId: input.roomId,
          messageId: input.messageId,
          workspaceId: input.workspaceId,
          sourceMessageCount: options.sourceMessageCount ?? input.recentMessages.length,
        },
      });
      workUnitId = created.id;
      await startAiWorkUnit(options.client, input.workspaceId, workUnitId, {
        runtimeMode: "efficient",
        reasoningProfile: "none",
      });
    } catch (error) {
      console.warn("[AdeHQ orchestrator classifier work unit]", error);
    }
  }

  const prompt = buildClassifierPrompt(input, employees);

  const result = await runtimeGenerateObject(
    {
      workspaceId: input.workspaceId,
      workUnitId,
      capability: "classification",
      runtimeMode: "efficient",
      reasoningProfile: "none",
      schema: classifierSchema,
      prompt,
      preferJsonMode: true,
      metadata: {
        topicId: input.topicId,
        roomId: input.roomId,
        messageId: input.messageId,
        workspaceId: input.workspaceId,
        sourceMessageCount: options.sourceMessageCount ?? input.recentMessages.length,
      },
    },
    { forceMode: "on" },
  );

  const parsed = classifierSchema.safeParse(result.object);
  if (!parsed.success) {
    throw new Error("Runtime orchestration classifier output failed schema validation.");
  }

  if (options.client && input.workspaceId && workUnitId) {
    try {
      await completeAiWorkUnit(options.client, input.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        metadata: {
          providerRoute: result.usage.providerRoute,
          modelId: result.usage.modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });
    } catch (error) {
      console.warn("[AdeHQ orchestrator classifier work unit complete]", error);
    }
  }

  recordAiRuntime({
    provider: result.usage.providerName,
    model: result.usage.modelId,
    mode: "live",
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.totalCostUsd,
    durationMs: result.usage.latencyMs,
    agentRunId: workUnitId,
  });

  return mapClassifierObjectToPlan(parsed.data, employees);
}

/**
 * Classify orchestration intent via LLM.
 * Dispatches by AI_RUNTIME_V2_MODE: off → old, shadow → old + shadow plan, on → runtime with fallback.
 */
export async function classifyWithLlm(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
  options: ClassifierGenerationOptions = {},
): Promise<Partial<OrchestrationPlan> | null> {
  classifierTestHooks?.onOptionsReceived?.(options);

  const dispatch = getClassifierRuntimeDispatch();

  if (dispatch === "runtime-on") {
    try {
      return await classifyWithLlmRuntime(input, employees, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "siliconflow",
        model: DEFAULT_SILICONFLOW_MODEL,
        mode: "fallback",
        fallbackReason: "orchestration_classify_runtime_failed",
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        error: message,
      });

      let workUnitFailed = false;
      if (options.client && input.workspaceId) {
        try {
          const failed = await createAiWorkUnit(options.client, {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            topicId: input.topicId ?? undefined,
            workType: "orchestration_classify",
            capability: "classification",
            objective: "Runtime classifier failed — fell back to legacy path",
            status: "failed",
            metadata: { fallback: true, error: message, messageId: input.messageId },
          });
          await failAiWorkUnit(options.client, input.workspaceId, failed.id, message);
          workUnitFailed = true;
        } catch {
          // debug only
        }
      }

      classifierTestHooks?.onRuntimeFallback?.({ error: message, workUnitFailed });

      return classifyWithLlmOld(input, employees);
    }
  }

  if (dispatch === "shadow") {
    void recordClassifierShadowPlanning(input, employees, options);
    return classifyWithLlmOld(input, employees);
  }

  return classifyWithLlmOld(input, employees);
}

export function buildResponseOrderFromSelection(
  intent: OrchestrationIntent,
  selectedEmployeeIds: string[],
  leadEmployeeId?: string | null,
  collaboratorEmployeeIds: string[] = [],
): OrchestrationPlan["responseOrder"] {
  if (!selectedEmployeeIds.length) return [];

  switch (intent) {
    case "social_broadcast":
      return [{ employeeId: selectedEmployeeIds[0], role: "social", delayMs: 0 }];
    case "direct_reply":
    case "direct_question":
    case "task_request":
    case "ask_for_opinion":
      return [{ employeeId: selectedEmployeeIds[0], role: "direct", delayMs: 0 }];
    case "panel_response":
    case "multi_employee_collaboration":
      return selectedEmployeeIds.map((employeeId, index) => ({
        employeeId,
        role: "panelist" as const,
        delayMs: index * 1500,
      }));
    case "lead_collaborator":
    case "ambient_smart_assist":
    case "answer_to_pending_question":
    case "employee_followup_needed":
    case "handoff_response":
    case "correction_or_clarification":
    case "offer_help": {
      const lead = leadEmployeeId ?? selectedEmployeeIds[0];
      const collaborators =
        collaboratorEmployeeIds.length > 0
          ? collaboratorEmployeeIds
          : selectedEmployeeIds.filter((id) => id !== lead);
      return [
        { employeeId: lead, role: "lead", delayMs: 0 },
        ...collaborators.map((employeeId, index) => ({
          employeeId,
          role: "collaborator" as const,
          delayMs: (index + 1) * 1200,
        })),
      ];
    }
    case "handoff": {
      const from = leadEmployeeId ?? selectedEmployeeIds[0];
      const to = collaboratorEmployeeIds[0] ?? selectedEmployeeIds[1];
      if (!to) return [{ employeeId: from, role: "lead", delayMs: 0 }];
      return [
        { employeeId: from, role: "lead", delayMs: 0 },
        { employeeId: to, role: "direct", delayMs: 1000 },
      ];
    }
    default:
      return [];
  }
}

export async function maybeEnhanceWithLlm(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
  deterministic: OrchestrationPlan,
  options: ClassifierGenerationOptions = {},
): Promise<OrchestrationPlan> {
  if (deterministic.confidence >= 0.75) return deterministic;

  const classifierOptions: ClassifierGenerationOptions = {
    ...options,
    sourceMessageCount: options.sourceMessageCount ?? input.recentMessages.length,
  };

  const llm = await classifyWithLlm(input, employees, classifierOptions);
  if (!llm || (llm.confidence ?? 0) < deterministic.confidence) return deterministic;

  const ranked = rankEmployeesForMessage(input.messageText, employees);
  const selectedEmployeeIds =
    llm.selectedEmployeeIds && llm.selectedEmployeeIds.length > 0
      ? llm.selectedEmployeeIds
      : ranked.slice(0, 2).map((r) => r.employeeId);

  return {
    ...deterministic,
    ...llm,
    selectedEmployeeIds,
    responseOrder:
      llm.responseOrder && llm.responseOrder.length > 0
        ? llm.responseOrder
        : buildResponseOrderFromSelection(
            llm.intent ?? deterministic.intent,
            selectedEmployeeIds,
            llm.leadEmployeeId,
            llm.collaboratorEmployeeIds,
          ),
    suggestedActions: deterministic.suggestedActions,
  };
}
