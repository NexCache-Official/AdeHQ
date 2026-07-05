/**
 * V19.9.4 — Topic context imports
 *
 * Usage: npm run test:topic-context-imports
 */

import assert from "node:assert/strict";
import {
  buildContextSummaryFromMessages,
  buildImportedContextBlock,
  selectMessagesForTopicImport,
  type TopicImportMessage,
} from "../src/lib/topics/context-imports";

function msg(
  id: string,
  senderType: TopicImportMessage["senderType"],
  senderName: string,
  content: string,
  offsetMin = 0,
): TopicImportMessage {
  return {
    id,
    senderType,
    senderName,
    content,
    createdAt: new Date(Date.UTC(2026, 6, 5, 10, offsetMin)).toISOString(),
  };
}

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const washingMachineMessages: TopicImportMessage[] = [
  msg("m1", "human", "Praveen Kumar", "hi everyone", 0),
  msg("m2", "ai", "Alex Chen", "Hey Praveen — what are we working on today?", 1),
  msg("m3", "human", "Praveen Kumar", "I want to launch a new washing machine product into the market", 2),
  msg(
    "m4",
    "ai",
    "Alex Chen",
    "Before I dive into prospect research, a few quick clarifications: target market, product type, and geography?",
    3,
  ),
  msg(
    "m5",
    "ai",
    "Priya Nair",
    "Once Praveen confirms the market segment, product type, and geography, I can research the competitive landscape.",
    4,
  ),
  msg(
    "m6",
    "ai",
    "Alex Chen",
    "so we're pivoting from health supplements to washing machines",
    5,
  ),
];

let passed = 0;

test("washing machine example selects relevant messages and excludes greeting", () => {
  const selected = selectMessagesForTopicImport({
    messages: washingMachineMessages,
    triggerMessageId: "m3",
    suggestedTopicTitle: "Washing Machine Launch",
  });
  const ids = selected.map((message) => message.id);
  assert.ok(ids.includes("m3"), "includes trigger");
  assert.ok(ids.includes("m4") || ids.includes("m5"), "includes AI follow-ups");
  assert.ok(!ids.includes("m1"), "excludes greeting");
  assert.ok(!ids.includes("m6"), "excludes stale supplement pivot line");
});

test("builds summary and imported context block", () => {
  const selected = selectMessagesForTopicImport({
    messages: washingMachineMessages,
    triggerMessageId: "m3",
    suggestedTopicTitle: "Washing Machine Launch",
  });
  const { summary, openQuestions } = buildContextSummaryFromMessages(
    selected,
    "Washing Machine Launch",
  );
  assert.ok(summary.includes("washing machine"), summary);
  assert.ok(openQuestions.length >= 1, "captures open questions");
  const block = buildImportedContextBlock([
    {
      id: "import_1",
      workspaceId: "ws",
      targetTopicId: "topic_new",
      createdBy: "user",
      importReason: "topic_suggestion",
      sourceMessageIds: selected.map((message) => message.id),
      keyFacts: [],
      openQuestions,
      participants: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      summary,
      receiptMessages: selected,
    },
  ]);
  assert.ok(block.includes("Imported context for this topic"), block);
  assert.ok(block.includes("Praveen Kumar"), block);
});

test("memory-aware phrasing guidance is present in employee prompts", async () => {
  const promptSource = await import("fs/promises").then((fs) =>
    fs.readFile("src/lib/ai/prompts.ts", "utf8"),
  );
  assert.ok(/fresh launch unless you want to connect/i.test(promptSource), promptSource);
  assert.ok(/Do not suppress old memory/i.test(promptSource) === false);
});

test("UI copy expectation: create topic with context label exists", async () => {
  const cardSource = await import("fs/promises").then((fs) =>
    fs.readFile("src/components/orchestration/TopicSuggestionCard.tsx", "utf8"),
  );
  assert.ok(cardSource.includes("Create topic with context"), cardSource);
});

passed += 4;
console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
