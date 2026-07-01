import { z } from "zod";
import { generateObject } from "ai";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
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

export async function classifyWithLlm(
  input: OrchestratorInput,
  employees: AIEmployeeProfile[],
): Promise<Partial<OrchestrationPlan> | null> {
  if (!isSiliconFlowConfigured()) return null;

  const employeeList = employees
    .map((e) => `- ${e.id}: ${e.name} (${e.role})`)
    .join("\n");

  const recent = input.recentMessages
    .slice(-8)
    .map((m) => `${m.senderType}: ${m.text}`)
    .join("\n");

  try {
    const { object } = await generateObject({
      model: siliconFlowChatModel(DEFAULT_SILICONFLOW_MODEL),
      providerOptions: siliconFlowProviderOptions(DEFAULT_SILICONFLOW_MODEL),
      schema: classifierSchema,
      prompt: `You are AdeHQ's Conversation Orchestrator.

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

Return JSON only.`,
    });

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
  } catch (error) {
    console.warn("[AdeHQ orchestrator] LLM classifier failed", error);
    return null;
  }
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
      return [{ employeeId: selectedEmployeeIds[0], role: "direct", delayMs: 0 }];
    case "panel_response":
      return selectedEmployeeIds.map((employeeId, index) => ({
        employeeId,
        role: "panelist" as const,
        delayMs: index * 1500,
      }));
    case "lead_collaborator":
    case "ambient_smart_assist": {
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
): Promise<OrchestrationPlan> {
  if (deterministic.confidence >= 0.75) return deterministic;

  const llm = await classifyWithLlm(input, employees);
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
