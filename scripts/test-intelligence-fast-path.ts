import { classifyMessageFastPath } from "@/lib/ai/intelligence/classify-message-fast-path";
import { assignThinkingBudget } from "@/lib/ai/intelligence/thinking-budget";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const cases = [
  ["hi everyone", "greeting"],
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
