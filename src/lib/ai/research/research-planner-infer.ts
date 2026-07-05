import { generateObject } from "ai";
import { z } from "zod";
import { SILICONFLOW_CHEAP_MODEL } from "@/lib/config/features";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import {
  isBrowserResearchLiveReady,
  isTavilyConfigured,
} from "@/lib/ai/browser-research/provider-config";
import type { BrowserAccess } from "@/lib/ai/intelligence-policy";
import { resolveModel, getOutputTokenCap, getTimeoutMs } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import type { RoomMessage } from "@/lib/types";
import type { ResearchCapabilities, ResearchPlan, ResearchPlannerInput } from "./research-planner";
import type { ResolvedResearchQuery } from "./resolve-research-query";
import { pickResearchProvider } from "./research-provider";

const ResearchModelDecisionSchema = z.object({
  action: z.enum(["reply", "search", "browse", "clarify"]),
  researchQuery: z.string().optional(),
  suggestedProvider: z.enum(["tavily", "browserbase", "auto"]).optional(),
  reasoning: z.string().max(600),
  confidence: z.number().min(0).max(1),
});

export type ResearchModelDecision = z.infer<typeof ResearchModelDecisionSchema>;

function formatRecentMessages(messages: RoomMessage[], limit = 8): string {
  return messages
    .slice(-limit)
    .map((m) => `${m.senderType === "human" ? "User" : m.senderName}: ${m.content.trim()}`)
    .join("\n");
}

function capabilitySummary(caps: ResearchCapabilities): string {
  const lines = [`Browser access: ${caps.browserAccess}`];
  if (caps.tavily) lines.push("- Fast web search (Tavily) is configured.");
  else lines.push("- Fast web search (Tavily) is not configured.");
  if (caps.browserbase) lines.push("- Live browser agent (Browserbase) is configured.");
  else lines.push("- Live browser agent (Browserbase) is not configured.");
  return lines.join("\n");
}

const RESEARCH_PLANNER_SYSTEM = `You are a lightweight planning step for an AI employee in AdeHQ.
Your job is to decide whether to answer directly or run web research BEFORE the main reply is written.

Think briefly about:
- Whether the user needs verified, time-sensitive, or external facts
- Whether your training data could be stale (funding rounds, news, prices, leadership, product launches)
- What research tools are actually available (provided in the prompt)

Rules:
- Choose "reply" for casual chat, opinions, drafts, planning, or stable knowledge that does not need verification.
- Choose "search" when recent verified facts are needed and fast web search is available.
- Choose "browse" only for complex live-site tasks when browser agent is available (login flows, multi-page sites, specific URLs).
- Choose "clarify" only when the request is too vague to act on.
- Do NOT choose search/browse just because a message mentions funding, news, or a year — judge whether verification is needed now.
- If training data might be outdated but the user has not asked for verification, prefer "reply" and note that in reasoning (the main model can offer to search).
- researchQuery must be a standalone search string, not meta-instructions like "look it up".`;

function buildResearchPlannerPrompt(
  input: ResearchPlannerInput,
  resolved: ResolvedResearchQuery,
  caps: ResearchCapabilities,
): string {
  return [
    `Employee role: ${input.employee.roleKey ?? "general"}`,
    capabilitySummary(caps),
    "",
    "Recent conversation:",
    formatRecentMessages(input.messages) || "(empty)",
    "",
    `Latest user message: ${input.userMessage.trim()}`,
    resolved.query !== input.userMessage.trim()
      ? `Resolved research topic (if searching): ${resolved.query}`
      : "",
    "",
    "Decide the next step before the main model replies.",
  ]
    .filter(Boolean)
    .join("\n");
}

function mapModelDecisionToPlan(
  decision: ResearchModelDecision,
  resolved: ResolvedResearchQuery,
  caps: ResearchCapabilities,
  input: ResearchPlannerInput,
): ResearchPlan {
  const base = {
    userQuestion: resolved.userQuestion,
    resolved,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
  };

  if (decision.action === "reply" || decision.action === "clarify") {
    return { ...base, action: decision.action };
  }

  const query = (decision.researchQuery ?? resolved.query).trim();
  if (!query) {
    return {
      ...base,
      action: "reply",
      reasoning: `${decision.reasoning} (No searchable query — answering directly.)`,
    };
  }

  const preferTavily = decision.suggestedProvider === "tavily";
  const preferAgentMode = decision.suggestedProvider === "browserbase";
  const provider = pickResearchProvider(query, { preferTavily, preferAgentMode }, caps);
  const useBrowse =
    decision.action === "browse" && caps.browserbase && provider === "browserbase";

  if (!provider && !caps.tavily && !caps.browserbase) {
    return {
      ...base,
      action: "reply",
      reasoning: `${decision.reasoning} (Research tools unavailable — answering directly.)`,
    };
  }

  return {
    ...base,
    action: useBrowse ? "browse" : "search",
    researchQuery: query,
    provider: provider ?? (caps.tavily ? "tavily" : "browserbase"),
  };
}

/** Cheap-model planning step — no keyword triggers; decides reply vs search from context. */
export async function inferResearchPlanWithModel(
  input: ResearchPlannerInput,
  resolved: ResolvedResearchQuery,
  capabilities: ResearchCapabilities,
): Promise<ResearchPlan> {
  const base = {
    userQuestion: resolved.userQuestion,
    resolved,
  };

  if (!isSiliconFlowConfigured()) {
    return {
      ...base,
      action: "reply",
      reasoning: "Research planner unavailable — answering directly.",
      confidence: 0.6,
    };
  }

  const model = resolveModel("siliconflow", "cheap", SILICONFLOW_CHEAP_MODEL);
  const maxTokens = Math.min(500, getOutputTokenCap("cheap"));
  const timeoutMs = getTimeoutMs("cheap");

  try {
    const result = await generateObject({
      model: siliconFlowChatModel(model),
      schema: ResearchModelDecisionSchema,
      system: RESEARCH_PLANNER_SYSTEM,
      prompt: buildResearchPlannerPrompt(input, resolved, capabilities),
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions: siliconFlowProviderOptions(model),
    });

    return mapModelDecisionToPlan(result.object, resolved, capabilities, input);
  } catch (error) {
    console.warn("[AdeHQ research planner infer]", error);
    return {
      ...base,
      action: "reply",
      reasoning: "Research planner failed — answering directly.",
      confidence: 0.5,
    };
  }
}
