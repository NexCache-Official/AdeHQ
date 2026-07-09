/**
 * V19.9.3 - Room Orchestration Steward V2 tests.
 *
 * Usage: npm run test:room-steward
 */

import {
  classifyRoomMessageWithSteward,
  extractPendingQuestionsFromAiMessage,
  setRoomStewardTestHooks,
  type RoomStewardInput,
  type RoomStewardRosterEmployee,
} from "@/lib/orchestration/room-steward";
import type { TopicOrchestrationState } from "@/lib/orchestration/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

const PRIYA_ID = "emp_priya";
const ALEX_ID = "emp_alex";

const baseRoster: RoomStewardRosterEmployee[] = [
  {
    employeeId: PRIYA_ID,
    name: "Priya Nair",
    roleTitle: "Launch Strategist",
    roleKey: "marketing",
    expertiseSummary: "Launch positioning, customer segmentation, GTM planning, product messaging.",
    isActiveInTopic: true,
  },
  {
    employeeId: ALEX_ID,
    name: "Alex Chen",
    roleTitle: "Sales Lead",
    roleKey: "sales",
    expertiseSummary: "Sales pitches, buyer pain, objection handling, revenue angles.",
    isActiveInTopic: true,
  },
];

const priyaQuestions = extractPendingQuestionsFromAiMessage({
  content:
    "What type of lawnmower are you building? Who's the target customer? What's the key differentiator?",
  askedByEmployeeId: PRIYA_ID,
  askedAtMessageId: "msg_priya_questions",
  createdAt: "2026-07-05T09:00:00.000Z",
});

function baseTopicState(overrides: Partial<TopicOrchestrationState> = {}): TopicOrchestrationState {
  return {
    workspaceId: "ws_test",
    roomId: "room_test",
    topicId: "topic_test",
    activeEmployeeIds: [PRIYA_ID, ALEX_ID],
    lastAiMessageId: "msg_alex_reply",
    pendingQuestions: priyaQuestions,
    currentWorkIntent: "launch_pitch",
    lastProjectEntity: "lawnmower",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<RoomStewardInput> = {},
): RoomStewardInput {
  return {
    workspaceId: "ws_test",
    roomId: "room_test",
    topicId: "topic_test",
    messageId: "msg_human_robotic",
    messageContent: "its a robotic lawnmower",
    authorType: "human",
    participationMode: "smart_assist",
    roster: baseRoster,
    recentMessages: [
      {
        id: "msg_human_launch",
        authorType: "human",
        authorName: "Human",
        content:
          "hi guys, i need help creating a new launch and sales pitch for a new lawnmower im inventing.",
        createdAt: "2026-07-05T08:58:00.000Z",
      },
      {
        id: "msg_priya_questions",
        authorType: "ai",
        authorName: "Priya Nair",
        employeeId: PRIYA_ID,
        content:
          "What type of lawnmower are you building? Who's the target customer? What's the key differentiator?",
        createdAt: "2026-07-05T09:00:00.000Z",
      },
      {
        id: "msg_human_ask_alex",
        authorType: "human",
        authorName: "Human",
        content: "@Alex Chen what do you think of priya's questions",
        createdAt: "2026-07-05T09:01:00.000Z",
      },
      {
        id: "msg_alex_reply",
        authorType: "ai",
        authorName: "Alex Chen",
        employeeId: ALEX_ID,
        content: "Priya's questions are spot-on from a launch and sales angle.",
        createdAt: "2026-07-05T09:02:00.000Z",
      },
    ],
    topicState: baseTopicState(),
    ...overrides,
  };
}

function seventyEmployeeRoster(): RoomStewardRosterEmployee[] {
  const extras = Array.from({ length: 68 }, (_, index) => ({
    employeeId: `emp_extra_${index}`,
    name: `Extra Employee ${index}`,
    roleTitle: index % 2 === 0 ? "Operations Specialist" : "Research Specialist",
    roleKey: index % 2 === 0 ? "operations" : "research",
    expertiseSummary: "General workspace support.",
    isActiveInTopic: false,
  }));
  return [...baseRoster, ...extras];
}

async function main() {
  console.log("AdeHQ Room Steward V2 tests\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("pending question answer selects Priya, not silent_note", async () => {
    const decision = await classifyRoomMessageWithSteward(baseInput());
    assert(decision.intent === "answer_to_pending_question", `expected answer intent, got ${decision.intent}`);
    assert(decision.shouldRespond, "expected steward to request a response");
    assert(decision.selectedEmployeeIds.includes(PRIYA_ID), "expected Priya to continue");
    assert(!decision.selectedEmployeeIds.includes(ALEX_ID), "Smart Assist should not include Alex by default");
    assert(decision.pendingQuestionUpdates.length === 1, "expected one pending question update");
    assert(
      decision.pendingQuestionUpdates[0].questionId === priyaQuestions[0].id,
      "expected only product type question to be answered",
    );
    assert(
      !decision.reason.includes("@") && /Priya/i.test(decision.reason),
      "debug reason should mention Priya and avoid @mention hints",
    );
  });

  await run("Manual Only stays quiet for pending answer unless mentioned", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({ participationMode: "manual_only" }),
    );
    assert(
      decision.intent === "answer_to_pending_question",
      `expected answer_to_pending_question, got ${decision.intent}`,
    );
    assert(!decision.shouldRespond, "manual only should not respond");
    assert(decision.selectedEmployeeIds.length === 0, "manual only should select nobody");
    assert(decision.pendingQuestionUpdates.length === 1, "manual only should still mark pending answer");
  });

  await run("Smart Assist greets the room on hey team", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageContent: "hey team",
        topicState: baseTopicState({ pendingQuestions: [] }),
      }),
    );
    assert(decision.intent === "social_broadcast", `expected social_broadcast, got ${decision.intent}`);
    assert(decision.shouldRespond, "expected one employee to greet");
    assert(decision.selectedEmployeeIds.length === 1, "expected exactly one greeter");
  });

  await run("Smart Assist selects exactly Priya for pending answer", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({ participationMode: "smart_assist" }),
    );
    assert(decision.selectedEmployeeIds.length === 1, "Smart Assist should select one employee");
    assert(decision.selectedEmployeeIds[0] === PRIYA_ID, "Smart Assist should select Priya");
    assert(decision.costPolicy.estimatedEmployeeCalls === 1, "expected one employee call");
  });

  await run("Active Team may include Alex but never more than three", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({ participationMode: "active_team" }),
    );
    assert(decision.selectedEmployeeIds.includes(PRIYA_ID), "Active Team should include Priya");
    assert(decision.selectedEmployeeIds.length <= 3, "Active Team must cap selected employees at three");
    assert(decision.costPolicy.estimatedEmployeeCalls <= 3, "employee call estimate must be capped");
  });

  await run("Talent Observation offers help instead of full work", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({ participationMode: "talent_observation" }),
    );
    assert(decision.intent === "answer_to_pending_question", "should still understand the pending answer");
    assert(!decision.shouldRespond, "Talent Observation should not do full work by default");
    assert(decision.selectedEmployeeIds.length === 0, "Talent Observation should not select full responders");
    assert(decision.offerOnlyEmployeeIds.includes(PRIYA_ID), "Talent Observation should offer Priya");
  });

  await run("70 employees still selects at most three and records suppression", async () => {
    const roster = seventyEmployeeRoster();
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        participationMode: "active_team",
        roster,
        topicState: baseTopicState({ activeEmployeeIds: [PRIYA_ID, ALEX_ID] }),
      }),
    );
    assert(decision.costPolicy.stewardCall === true, "expected one steward classification");
    assert(decision.selectedEmployeeIds.length <= 3, "selected employees must be capped at three");
    assert(
      decision.costPolicy.suppressedEmployeeCount >= 67,
      "expected most employees to stay suppressed",
    );
  });

  await run("@mention selects Alex regardless of pending question", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageId: "msg_mention_alex",
        messageContent: "@Alex Chen what do you think?",
        mentionedEmployeeIds: [ALEX_ID],
      }),
    );
    assert(decision.intent === "direct_question", `expected direct_question, got ${decision.intent}`);
    assert(decision.selectedEmployeeIds[0] === ALEX_ID, "expected Alex to be selected");
    assert(decision.shouldRespond, "expected @mention to respond");
  });

  await run("silent note saves context without employee call", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageId: "msg_green",
        messageContent: "remember the mower is green",
      }),
    );
    assert(
      decision.intent === "work_update" || decision.intent === "silent_note",
      `expected work_update or silent_note, got ${decision.intent}`,
    );
    assert(!decision.shouldRespond, "silent note should not call employees");
    assert(decision.costPolicy.estimatedEmployeeCalls === 0, "expected zero employee calls");
  });

  await run("topic shift is not misread as pending answer", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageId: "msg_topic_shift",
        messageContent: "new project: robotic lawnmower",
        topicState: baseTopicState({ pendingQuestions: [], activeEmployeeIds: [] }),
      }),
    );
    assert(
      decision.intent === "topic_shift" || decision.intent === "work_update",
      `expected topic shift/work update, got ${decision.intent}`,
    );
    assert(decision.selectedEmployeeIds.length === 0, "topic shift should not fan out");
  });

  await run("runtime steward cannot suppress greeting response", async () => {
    setRoomStewardTestHooks({
      stubRuntimeDecision: {
        intent: "social_ack",
        confidence: 0.1,
        shouldRespond: false,
        selectedEmployeeIds: [],
        offerOnlyEmployeeIds: [],
        responseStyle: "silent",
        reason: "Greeting does not require a response from AI employees",
        pendingQuestionUpdates: [],
      },
    });
    try {
      const decision = await classifyRoomMessageWithSteward(
        baseInput({
          messageContent: "Hi everyone",
          topicState: baseTopicState({ pendingQuestions: [] }),
        }),
      );
      assert(
        decision.intent === "social_broadcast",
        `expected social_broadcast, got ${decision.intent}`,
      );
      assert(decision.shouldRespond, "greeting should queue one employee");
      assert(decision.selectedEmployeeIds.length === 1, "expected exactly one greeter");
    } finally {
      setRoomStewardTestHooks(null);
    }
  });

  await run("runtime steward cannot suppress task request", async () => {
    setRoomStewardTestHooks({
      stubRuntimeDecision: {
        intent: "social_ack",
        confidence: 0.1,
        shouldRespond: false,
        selectedEmployeeIds: [],
        offerOnlyEmployeeIds: [],
        responseStyle: "silent",
        reason: "No response needed",
        pendingQuestionUpdates: [],
      },
    });
    try {
      const decision = await classifyRoomMessageWithSteward(
        baseInput({
          messageContent: "Can you help me draft a launch pitch for our lawnmower?",
          topicState: baseTopicState({ pendingQuestions: [] }),
        }),
      );
      assert(decision.shouldRespond, "task request should still respond");
      assert(decision.selectedEmployeeIds.length >= 1, "expected at least one employee");
    } finally {
      setRoomStewardTestHooks(null);
    }
  });

  await run("fallback handles pending answers when runtime steward fails", async () => {
    let fallbackObserved = false;
    setRoomStewardTestHooks({
      forceRuntimeFailure: true,
      onFallback: () => {
        fallbackObserved = true;
      },
    });
    try {
      const decision = await classifyRoomMessageWithSteward(baseInput(), {
        forceMode: "on",
        forceProviderPref: "mock",
      });
      assert(fallbackObserved, "expected runtime fallback to be observed");
      assert(decision.intent === "answer_to_pending_question", "fallback should preserve pending answer");
      assert(decision.selectedEmployeeIds.includes(PRIYA_ID), "fallback should select Priya");
    } finally {
      setRoomStewardTestHooks(null);
    }
  });

  await run("debug reason is human-readable", async () => {
    const decision = await classifyRoomMessageWithSteward(baseInput());
    assert(decision.reason.length > 20, "expected a detailed reason");
    assert(/pending|answered|question/i.test(decision.reason), "reason should explain the pending answer");
    assert(decision.costPolicy.selectedEmployeeCalls === decision.selectedEmployeeIds.length, "cost metadata should match selection");
  });

  await run("human-only mention keeps AI silent without role relevance", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageContent: "@Shubham can you review this?",
        mentionedHumanIds: ["human_shubham"],
        mentionedEmployeeIds: [],
        topicState: baseTopicState({ pendingQuestions: [] }),
      }),
    );
    assert(!decision.shouldRespond, "AI should stay silent for a human-only mention");
    assert(
      /human-only/i.test(decision.reason),
      "reason should identify the human-only mention gate",
    );
  });

  await run("strong profession match may assist a human-only mention", async () => {
    const decision = await classifyRoomMessageWithSteward(
      baseInput({
        messageContent: "@Shubham our sales pipeline needs an outreach plan",
        mentionedHumanIds: ["human_shubham"],
        mentionedEmployeeIds: [],
        topicState: baseTopicState({ pendingQuestions: [] }),
      }),
    );
    assert(decision.shouldRespond, "strong sales relevance should select a specialist");
    assert(
      decision.selectedEmployeeIds.includes(ALEX_ID),
      "sales specialist should be selected",
    );
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  setRoomStewardTestHooks(null);
  process.exitCode = 1;
});
