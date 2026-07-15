import {
  type RoomGovernanceContext,
  isRoomCooldownActive,
} from "@/lib/server/room-governance";
import { isHelpRequest } from "@/lib/server/ambient-collaboration";
import type { OrchestrationPlan, OrchestratorInput } from "./types";

function blockedPlan(reason: string): OrchestrationPlan {
  return {
    intent: "silent_note",
    confidence: 0.95,
    reason,
    selectedEmployeeIds: [],
    leadEmployeeId: null,
    collaboratorEmployeeIds: [],
    shouldRespond: false,
    responseOrder: [],
    suggestedActions: [],
    workLogRequired: false,
    workLogReason: null,
  };
}

/** Intents that are real work — never treat as ambient chatter after an AI turn. */
const WORK_INTENTS = new Set<OrchestrationPlan["intent"]>([
  "answer_to_pending_question",
  "employee_followup_needed",
  "correction_or_clarification",
  "task_request",
  "direct_question",
  "multi_employee_collaboration",
  "brainstorm",
  "ask_for_opinion",
  "offer_help",
]);

/** Apply room ambient cooldown rules to a V19.4 orchestration plan. */
export function applyRoomGovernanceToPlan(
  plan: OrchestrationPlan,
  input: Pick<OrchestratorInput, "messageText" | "mentionedEmployeeIds" | "isDm">,
  governance: RoomGovernanceContext,
): OrchestrationPlan {
  if (!plan.shouldRespond || input.isDm) return plan;
  if (input.mentionedEmployeeIds.length > 0) return plan;
  if (isHelpRequest(input.messageText)) return plan;
  // Steward already classified this as work — do not silence after a prior AI
  // tool card / reply (that gate exists to stop AI ping-pong on social ambient).
  if (WORK_INTENTS.has(plan.intent) || plan.responseStyle === "continue_thread") {
    return plan;
  }

  if (governance.lastMessageSenderType === "ai") {
    return blockedPlan("Blocked — ambient reply skipped after AI message.");
  }

  if (isRoomCooldownActive(governance)) {
    return blockedPlan("Blocked — room ambient cooldown active.");
  }

  return plan;
}
