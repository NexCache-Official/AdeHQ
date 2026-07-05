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

/** Apply room ambient cooldown rules to a V19.4 orchestration plan. */
export function applyRoomGovernanceToPlan(
  plan: OrchestrationPlan,
  input: Pick<OrchestratorInput, "messageText" | "mentionedEmployeeIds" | "isDm">,
  governance: RoomGovernanceContext,
): OrchestrationPlan {
  if (!plan.shouldRespond || input.isDm) return plan;
  if (input.mentionedEmployeeIds.length > 0) return plan;
  if (isHelpRequest(input.messageText)) return plan;
  if (
    plan.intent === "answer_to_pending_question" ||
    plan.intent === "employee_followup_needed" ||
    plan.intent === "correction_or_clarification" ||
    plan.responseStyle === "continue_thread"
  ) {
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
