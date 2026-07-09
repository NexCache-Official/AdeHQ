import { classifyMessageFastPath } from "@/lib/ai/intelligence/classify-message-fast-path";
import {
  researchPlanFromIntelligence,
  shouldSkipLegacyResearchPlanner,
} from "@/lib/ai/intelligence/research-plan-from-intelligence";
import { createIntelligenceContext } from "@/lib/ai/intelligence/intelligence-context";
import { shouldAnswerFromKnowledge } from "@/lib/ai/intelligence/pipeline";
import { normalizeSearchCacheKey } from "@/lib/ai/search/search-cache";
import { getResearchCapabilities } from "@/lib/ai/research/research-planner";

function assert(condition: boolean, message: string) {
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

console.log("PASS  obvious_search → research plan");
console.log("PASS  knowledge threshold short-circuit");
console.log("PASS  search cache key normalization");
console.log("\nAll intelligence pipeline tests passed.");
