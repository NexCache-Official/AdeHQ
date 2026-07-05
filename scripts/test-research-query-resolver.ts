/**
 * Research query resolver + planner heuristics tests.
 *
 * Usage: npm run test:research-query
 */

import {
  isMetaResearchInstruction,
  isMostlyMetaInstruction,
  planResearch,
  resolveResearchQuery,
} from "@/lib/ai/research";
import type { RoomMessage } from "@/lib/types";

let passed = 0;
let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label?: string) {
  if (actual !== expected) {
    throw new Error(
      `${label ?? "assertEqual"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function msg(id: string, content: string, senderType: RoomMessage["senderType"] = "human"): RoomMessage {
  return {
    id,
    roomId: "room_1",
    topicId: "topic_1",
    senderType,
    senderId: senderType === "human" ? "user_1" : "ai_1",
    senderName: senderType === "human" ? "You" : "Priya",
    content,
    createdAt: "2026-07-05T00:00:00.000Z",
  };
}

console.log("\nResearch query resolver tests\n");

run("detects meta browser instruction", () => {
  assertEqual(isMetaResearchInstruction("Please find out using the browser"), true);
});

run("passes through funding question", () => {
  const text = "How much did Conduct AI and Twelve Labs raise recently?";
  assertEqual(isMetaResearchInstruction(text), false);
  assertEqual(isMostlyMetaInstruction(text), false);
});

run("resolves meta request to prior user question", () => {
  const messages = [
    msg("m1", "How much did Conduct AI and Twelve Labs raise recently?"),
    msg("m2", "I don't have live search.", "ai"),
    msg("m3", "Please find out using the browser"),
  ];
  const resolved = resolveResearchQuery({
    messages,
    userMessage: "Please find out using the browser",
    excludeMessageId: "m3",
  });
  assertEqual(
    resolved.query,
    "How much did Conduct AI and Twelve Labs raise recently?",
  );
  assertEqual(resolved.wasMetaInstruction, true);
  assertEqual(resolved.resolvedFrom, "thread");
});

function researchEmployee() {
  return {
    intelligencePolicy: {
      defaultMode: "balanced" as const,
      allowedModes: ["efficient", "balanced", "strong"],
      routingPreference: "auto" as const,
      browserAccess: "research_only" as const,
      workHourProfile: "moderate" as const,
    },
    modelMode: "balanced" as const,
    roleKey: "research" as const,
  };
}

run("planner auto-searches funding questions without browse toggle", () => {
  const plan = planResearch({
    messages: [
      msg("m1", "How much did Conduct AI and Twelve Labs raise recently?"),
    ],
    userMessage: "How much did Conduct AI and Twelve Labs raise recently?",
    employee: researchEmployee(),
  });
  assertEqual(plan.action === "search" || plan.action === "browse", true);
  assertEqual(
    plan.researchQuery?.includes("Conduct AI") ?? false,
    true,
  );
});

run("planner resolves browse follow-up to underlying query", () => {
  const messages = [
    msg("m1", "How much did Conduct AI and Twelve Labs raise recently?"),
    msg("m2", "Please find out using the browser"),
  ];
  const plan = planResearch({
    messages,
    userMessage: "Please find out using the browser",
    employee: researchEmployee(),
    preferTavily: true,
    excludeMessageId: "m2",
  });
  assertEqual(plan.action === "search" || plan.action === "browse", true);
  assertEqual(
    plan.researchQuery,
    "How much did Conduct AI and Twelve Labs raise recently?",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
