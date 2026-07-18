/**
 * Maya Direct Chat must queue a brain reply (not silent_note).
 *   npx tsx scripts/test-maya-dm-orchestrator.ts
 */
import { orchestrateConversationDeterministic } from "../src/lib/orchestration/conversation-orchestrator";
import { MAYA_EMPLOYEE_ID } from "../src/lib/hiring/maya";
import { buildMayaEmployee } from "../src/lib/maya-employee";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const maya = buildMayaEmployee();

const plan = orchestrateConversationDeterministic({
  workspaceId: "ws-test",
  roomId: "dm_maya_test",
  topicId: "topic-general",
  userId: "user-1",
  messageId: "msg-1",
  messageText: "Hi Maya, what can AdeHQ do?",
  mentionedEmployeeIds: [],
  mentionedHumanIds: [],
  roomEmployees: [maya],
  topicEmployees: [maya],
  recentMessages: [],
  existingTopics: [],
  smartAssistEnabled: true,
  isDm: true,
  dmEmployeeId: MAYA_EMPLOYEE_ID,
  isMayaDm: true,
  isMayaHiringSession: false,
});

assert(plan.shouldRespond, "Maya DM should respond");
assert(plan.intent === "direct_reply", `expected direct_reply, got ${plan.intent}`);
assert(
  plan.selectedEmployeeIds.includes(MAYA_EMPLOYEE_ID),
  "Maya should be selected",
);

const hiring = orchestrateConversationDeterministic({
  workspaceId: "ws-test",
  roomId: "dm_maya_test",
  topicId: "topic-hire",
  userId: "user-1",
  messageId: "msg-2",
  messageText: "Hire a research analyst",
  mentionedEmployeeIds: [],
  mentionedHumanIds: [],
  roomEmployees: [maya],
  topicEmployees: [maya],
  recentMessages: [],
  existingTopics: [],
  smartAssistEnabled: true,
  isDm: true,
  dmEmployeeId: MAYA_EMPLOYEE_ID,
  isMayaDm: true,
  isMayaHiringSession: true,
});

assert(!hiring.shouldRespond, "hiring session stays client-side");
assert(hiring.intent === "silent_note", `expected silent_note, got ${hiring.intent}`);

console.log("ok — Maya DM queues brain reply; hiring session stays specialized");
