import { applyRoomGovernanceToPlan } from "@/lib/orchestration/ambient-governance";
import type { OrchestrationPlan } from "@/lib/orchestration/types";
import type { RoomGovernanceContext } from "@/lib/server/room-governance";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const respondingPlan: OrchestrationPlan = {
  intent: "task_request",
  confidence: 0.9,
  reason: "CEO asked for a one-liner and demo plan",
  selectedEmployeeIds: ["emp_1"],
  leadEmployeeId: "emp_1",
  collaboratorEmployeeIds: [],
  shouldRespond: true,
  responseOrder: ["emp_1"],
  suggestedActions: [],
  workLogRequired: false,
  workLogReason: null,
};

const governance: RoomGovernanceContext = {
  lastMessageSenderType: "ai",
  lastAmbientResponseAt: new Date().toISOString(),
};

const kept = applyRoomGovernanceToPlan(
  respondingPlan,
  {
    messageText: "Quick sync — need a one-liner for Approvals Inbox",
    mentionedEmployeeIds: [],
    isDm: false,
  },
  governance,
);
assert(kept.shouldRespond === true, "task_request must not be silenced after AI message");

const social: OrchestrationPlan = {
  ...respondingPlan,
  intent: "social_ack",
  reason: "ambient ack",
};
const blocked = applyRoomGovernanceToPlan(
  social,
  { messageText: "lol nice", mentionedEmployeeIds: [], isDm: false },
  governance,
);
assert(blocked.shouldRespond === false, "social_ack after AI should still be blocked");

console.log("ambient-governance work intents: ok");
