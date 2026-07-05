/**
 * Research query resolver + planner heuristics tests.
 *
 * Usage: npm run test:research-query
 */

import {
  isMetaResearchInstruction,
  isMostlyMetaInstruction,
  planResearchSync,
  resolveResearchQuery,
  resolveUserDirectedResearchPlan,
  getResearchCapabilities,
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

run("find out + substantive topic does not recurse or mark as meta-only", () => {
  const text = "Find out what latest tech innovations Anduril has brought out.";
  assertEqual(isMetaResearchInstruction(text), false);
  assertEqual(isMostlyMetaInstruction(text), false);
  const resolved = resolveResearchQuery({
    messages: [msg("m1", text)],
    userMessage: text,
    excludeMessageId: "m1",
  });
  assertEqual(resolved.query, text);
  assertEqual(resolved.wasMetaInstruction, false);
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

run("user-directed: Browse toggle forces search", () => {
  const plan = planResearchSync({
    messages: [msg("m1", "How much did Conduct AI and Twelve Labs raise recently?")],
    userMessage: "How much did Conduct AI and Twelve Labs raise recently?",
    employee: researchEmployee(),
    preferTavily: true,
  });
  assertEqual(plan.action === "search" || plan.action === "browse", true);
});

run("user-directed: resolves browse follow-up to underlying query", () => {
  const messages = [
    msg("m1", "How much did Conduct AI and Twelve Labs raise recently?"),
    msg("m2", "Please find out using the browser"),
  ];
  const plan = planResearchSync({
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

run("user-directed: yes look it up after funding question", () => {
  const messages = [
    msg("m1", "How much did Supabase raise in their last round?"),
    msg("m2", "I believe they raised around $200M in 2024 but I'd need to verify that.", "ai"),
    msg("m3", "yes look it up"),
  ];
  const plan = planResearchSync({
    messages,
    userMessage: "yes look it up",
    employee: researchEmployee(),
    excludeMessageId: "m3",
  });
  assertEqual(plan.action === "search" || plan.action === "browse", true);
  assertEqual(plan.researchQuery, "How much did Supabase raise in their last round?");
});

run("no keyword auto-search without user direction", () => {
  const employee = researchEmployee();
  const resolved = resolveResearchQuery({
    messages: [msg("m1", "how much did Supabase raise in their last round?")],
    userMessage: "how much did Supabase raise in their last round?",
  });
  const caps = getResearchCapabilities(employee);
  const directed = resolveUserDirectedResearchPlan(
    {
      messages: [msg("m1", "how much did Supabase raise in their last round?")],
      userMessage: "how much did Supabase raise in their last round?",
      employee,
    },
    caps,
    resolved,
  );
  assertEqual(directed, null);
  const syncPlan = planResearchSync({
    messages: [msg("m1", "how much did Supabase raise in their last round?")],
    userMessage: "how much did Supabase raise in their last round?",
    employee,
  });
  assertEqual(syncPlan.action, "reply");
});

run("user-directed: Agent mode forces search", () => {
  const plan = planResearchSync({
    messages: [msg("m1", "Check the pricing page on example.com")],
    userMessage: "Check the pricing page on example.com",
    employee: researchEmployee(),
    preferAgentMode: true,
  });
  assertEqual(plan.action === "search" || plan.action === "browse", true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
