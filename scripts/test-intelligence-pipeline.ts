import { classifyMessageFastPath } from "@/lib/ai/intelligence/classify-message-fast-path";
import {
  researchPlanFromIntelligence,
  shouldSkipLegacyResearchPlanner,
} from "@/lib/ai/intelligence/research-plan-from-intelligence";
import { createIntelligenceContext } from "@/lib/ai/intelligence/intelligence-context";
import {
  runIntelligencePrelude,
  shouldAnswerFromKnowledge,
  shouldAnswerInstantly,
} from "@/lib/ai/intelligence/pipeline";
import { normalizeSearchCacheKey } from "@/lib/ai/search/search-cache";
import { getResearchCapabilities } from "@/lib/ai/research/research-planner";
import { createAmbientContext } from "@/lib/ai/ambient-context";
import { resolveEmployeePromptTier } from "@/lib/ai/employee-prompt-tier";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const employee = {
  roleKey: "research" as const,
  modelMode: "balanced" as const,
  intelligencePolicy: {
    defaultMode: "balanced" as const,
    allowedModes: ["balanced" as const],
    workHourProfile: "moderate" as const,
    browserAccess: "none" as const,
    routingPreference: "auto" as const,
  },
};

const worldCupMessage = "who are the biggest sponsors for this year's world cup?";
const fastPath = classifyMessageFastPath(worldCupMessage);
assert(fastPath.decision === "obvious_search", "World Cup sponsors must be obvious_search");

let intelligence = createIntelligenceContext({
  workspaceId: "ws_test",
  roomId: "room_test",
  topicId: "topic_test",
  messageId: "msg_test",
  userMessage: worldCupMessage,
});
intelligence = {
  ...intelligence,
  fastPath: {
    decision: fastPath.decision,
    confidence: fastPath.confidence,
    reason: fastPath.reason,
    suggestedSearchQuery: fastPath.suggestedSearchQuery,
  },
};

const searchPlan = researchPlanFromIntelligence({
  intelligence,
  messages: [],
  userMessage: worldCupMessage,
  employee,
  capabilities: {
    ...getResearchCapabilities(employee),
    gatewaySearch: true,
    tavily: true,
    browserbase: false,
    canBrowse: false,
    canSearch: true,
  },
});
assert(searchPlan?.action === "search", "obvious_search must produce search plan");
assert(
  Boolean(searchPlan?.researchQuery?.includes("world cup")),
  "search plan must preserve topic",
);
assert(
  shouldSkipLegacyResearchPlanner(intelligence),
  "obvious_search must skip legacy planner",
);

const internalReviewMessage =
  "Review this internal brokerage product brief and identify failure modes with acceptance criteria.";
const directFastPath = classifyMessageFastPath(internalReviewMessage, {
  workMode: "collaboration",
  hasRecentContext: true,
});
assert(directFastPath.decision === "direct", "internal review work must be direct");
const directIntelligence = {
  ...createIntelligenceContext({
    workspaceId: "ws_test",
    roomId: "room_test",
    topicId: "topic_test",
    messageId: "msg_direct",
    userMessage: internalReviewMessage,
    workMode: "collaboration",
  }),
  fastPath: {
    decision: directFastPath.decision,
    confidence: directFastPath.confidence,
    reason: directFastPath.reason,
  },
};
assert(
  researchPlanFromIntelligence({
    intelligence: directIntelligence,
    messages: [],
    userMessage: internalReviewMessage,
    employee,
  }) === null,
  "direct internal review must not request research",
);
assert(
  shouldSkipLegacyResearchPlanner(directIntelligence),
  "direct internal review must not fall through to the legacy research planner",
);

const knowledgeContext = {
  ...intelligence,
  knowledge: {
    provider: "workspace_memory",
    found: true,
    confidence: 0.92,
    answer: "FIFA World Cup 2026 sponsors include Adidas and Coca-Cola.",
    sources: [],
  },
};
assert(
  shouldAnswerFromKnowledge(knowledgeContext),
  "high-confidence knowledge must short-circuit",
);

const cacheKeyA = normalizeSearchCacheKey("Who are the World Cup sponsors?");
const cacheKeyB = normalizeSearchCacheKey("who are the world cup sponsors");
assert(cacheKeyA === cacheKeyB, "cache keys must normalize equivalent queries");

assert(
  resolveEmployeePromptTier({ message: "hey", isGreetingRun: true }) === "core",
  "greetings should use core prompt tier",
);
assert(
  resolveEmployeePromptTier({ message: "draft an outreach email" }) === "work",
  "work requests should use work prompt tier",
);
assert(
  resolveEmployeePromptTier({ message: "summarize this file", hasFileContext: true }) === "full",
  "file-grounded requests should use full prompt tier",
);
assert(
  resolveEmployeePromptTier({
    message: "Add Marcus Webb (Webb Realty Group, marcus@webbrealty.com) as a CRM contact.",
  }) !== "core",
  // Regression: this message is short (<=120 chars) and its verb is "add", not a
  // WORK_SIGNAL verb like "create" — it used to fall through to "core" tier,
  // whose prompt explicitly says "Do not create tasks, memory, approvals,
  // artifacts, or tool calls" — directly contradicting the user's explicit CRM
  // request and silently suppressing the tool call the message asked for.
  "a short CRM/tool-work request must never get the core tier, which suppresses tool calls",
);

async function main() {
  const instantContext = await runIntelligencePrelude({} as never, {
    workspaceId: "ws_test",
    roomId: "room_test",
    topicId: "topic_test",
    messageId: "msg_instant",
    userMessage: "what's the date today?",
    ambientContext: createAmbientContext({
      now: new Date("2026-07-10T15:32:00.000Z"),
      timezone: "America/New_York",
      locale: "en-US",
      workspaceName: "NexCache",
      userName: "Shubham Kumar",
    }),
  });
  assert(shouldAnswerInstantly(instantContext), "instant answer must short-circuit prelude");
  assert(
    Boolean(instantContext.instantAnswer?.reply.includes("July 10, 2026")),
    "instant reply must use ambient date",
  );
  assert(instantContext.researchLevel === 0, "instant answer research level must be 0");

  console.log("PASS  obvious_search → research plan");
  console.log("PASS  knowledge threshold short-circuit");
  console.log("PASS  search cache key normalization");
  console.log("PASS  prompt tier routing");
  console.log("PASS  instant answer prelude short-circuit");
  console.log("\nAll intelligence pipeline tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
