import { classifyMessageFastPath } from "@/lib/ai/intelligence/classify-message-fast-path";
import { assignThinkingBudget } from "@/lib/ai/intelligence/thinking-budget";
import { createAmbientContext } from "@/lib/ai/ambient-context";
import { resolveInstantAnswer } from "@/lib/ai/intelligence/instant-answers";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cases = [
  ["hi everyone", "greeting"],
  ["what's the date today?", "instant_answer"],
  ["Whats the date today?", "instant_answer"],
  ["what time is it?", "instant_answer"],
  ["2 + 2 * 5", "instant_answer"],
  ["10 kg to lbs", "instant_answer"],
  ["write me an outreach email", "direct"],
  ["who are the biggest sponsors for this year's world cup?", "obvious_search"],
  ["what was Perplexity revenue in 2025?", "obvious_search"],
  ["latest funding for Acme", "obvious_search"],
  ["who is the current CEO of Stripe?", "obvious_search"],
  ["what was Apple's revenue in 2025?", "obvious_search"],
  ["what are the UK visa requirements for tech workers?", "obvious_search"],
  ["what is the score today?", "obvious_search"],
  ["find sources and screenshots for a competitor report", "obvious_browser_research"],
] as const;

for (const [message, expected] of cases) {
  const result = classifyMessageFastPath(message);
  assert(
    result.decision === expected,
    `${JSON.stringify(message)}: expected ${expected}, got ${result.decision}`,
  );
  console.log(`PASS  ${expected.padEnd(28)} ${message}`);
}

const greetingBudget = assignThinkingBudget({ fastPath: "greeting" });
assert(greetingBudget.assigned === 0, "greeting budget must be zero");

const instantBudget = assignThinkingBudget({ fastPath: "instant_answer" });
assert(instantBudget.assigned === 0, "instant answer budget must be zero");
assert(instantBudget.maxSearches === 0, "instant answer must not allow search");

const searchBudget = assignThinkingBudget({ fastPath: "obvious_search" });
assert(searchBudget.maxSearches === 1, "simple fact must allow exactly one search");

const researchBudget = assignThinkingBudget({
  fastPath: "obvious_browser_research",
  workMode: "research",
});
assert(researchBudget.assigned >= 7, "research mode should receive a larger budget");

const collaborationBudget = assignThinkingBudget({
  fastPath: "needs_router",
  workMode: "collaboration",
});
assert(
  collaborationBudget.allowCollaboration,
  "collaboration mode must allow collaboration",
);

console.log("\nAll intelligence fast-path tests passed.");

const ambient = createAmbientContext({
  now: new Date("2026-07-10T15:32:00.000Z"),
  timezone: "America/New_York",
  locale: "en-US",
  workspaceName: "NexCache",
  userName: "Shubham Kumar",
});

const dateAnswer = resolveInstantAnswer({
  message: "what's the date today?",
  ambient,
});
assert(Boolean(dateAnswer?.reply.includes("July 10, 2026")), "date answer should use ambient context");
assert(dateAnswer !== null, "date answer should resolve");
assert(dateAnswer.kind === "date", "date answer should be typed as date");

const dayAnswer = resolveInstantAnswer({
  message: "what day is it?",
  ambient,
});
assert(Boolean(dayAnswer?.reply.includes("Friday")), "day answer should use ambient weekday");

const arithmeticAnswer = resolveInstantAnswer({
  message: "2 + 2 * 5",
  ambient,
});
assert(arithmeticAnswer?.reply === "12.", "arithmetic answer should respect precedence");

const conversionAnswer = resolveInstantAnswer({
  message: "10 kg to lbs",
  ambient,
});
assert(Boolean(conversionAnswer?.reply.includes("22.0462 lb")), "unit conversion should work");

const peopleAnswer = resolveInstantAnswer({
  message: "who's in this room?",
  ambient,
  roomName: "Launch",
  humanParticipants: [{ id: "u1", name: "Shubham" }],
  roomEmployees: [{ id: "e1", name: "Maya", role: "Recruiting manager" }],
});
assert(Boolean(peopleAnswer?.reply.includes("Shubham")), "room people answer should include humans");
assert(Boolean(peopleAnswer?.reply.includes("Maya")), "room people answer should include employees");

console.log("All instant-answer tests passed.");
