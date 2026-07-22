import { generateObject } from "ai";
import { z } from "zod";
import { SILICONFLOW_CHEAP_MODEL, isSiliconFlowConfigured } from "@/lib/config/features";
import { resolveModel, getOutputTokenCap } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import type { IntelligenceContext } from "./intelligence-context";
import { appendIntelligenceStep } from "./telemetry";
import { spendBudget } from "./thinking-budget";

const RouterDecisionSchema = z.object({
  route: z.enum(["direct", "search", "browse", "clarify"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(400),
  searchQuery: z.string().max(500).optional(),
});

export type IntelligenceRouterResult = z.infer<typeof RouterDecisionSchema>;

/**
 * This step decides a single enum field ("route") — it is not a full reply —
 * so it must never eat into the "cheap" tier's full reply budget (30s via
 * getTimeoutMs("cheap")). Production traces showed this call consistently
 * timing out at exactly 30000ms whenever SiliconFlow's cheap tier was slow,
 * wasting a full 30s before the pipeline could even fall back to a direct
 * reply. A short, dedicated timeout means a slow provider fails fast here and
 * the employee still replies promptly via the direct/fallback path.
 */
const ROUTER_TIMEOUT_MS = 8_000;

const ROUTER_SYSTEM = `You are a lightweight intent router for AdeHQ AI employees.
Decide how to handle the latest user message before any expensive tools run.

Routes:
- direct: drafting, planning, opinions, stable knowledge, or continuation of prior context
- search: one-shot factual lookup that needs current web verification (news, sponsors, leadership, prices)
- browse: only when the user needs live-site interaction (login, multi-page navigation, screenshots, specific URLs)
- clarify: message is too vague to act on without more detail

Rules:
- Prefer search over browse for simple factual questions.
- Prefer direct when workspace context likely suffices.
- searchQuery must be a standalone search string when route is search or browse.
- Do not route to browse unless the user clearly needs live browser automation.`;

export async function runIntelligenceRouter(
  context: IntelligenceContext,
  options?: {
    recentMessages?: string;
    capabilitiesSummary?: string;
  },
): Promise<IntelligenceContext> {
  if (context.fastPath?.decision !== "needs_router") {
    return context;
  }
  if (context.thinkingBudget.maxRouterCalls <= 0) {
    return appendIntelligenceStep(context, {
      layer: "router",
      decision: "skipped_no_budget",
      confidence: 1,
      durationMs: 0,
    });
  }
  if (!isSiliconFlowConfigured()) {
    return appendIntelligenceStep(context, {
      layer: "router",
      decision: "skipped_unconfigured",
      confidence: 1,
      durationMs: 0,
    });
  }

  const startedAt = Date.now();
  const model = resolveModel("siliconflow", "cheap", SILICONFLOW_CHEAP_MODEL);

  try {
    const { object } = await generateObject({
      model: siliconFlowChatModel(model),
      schema: RouterDecisionSchema,
      system: ROUTER_SYSTEM,
      prompt: [
        options?.capabilitiesSummary ?? "Search and browser capabilities unknown.",
        "",
        options?.recentMessages
          ? `Recent conversation:\n${options.recentMessages}`
          : "",
        "",
        `Latest user message: ${context.userMessage.trim()}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxOutputTokens: getOutputTokenCap("cheap"),
      abortSignal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
      providerOptions: siliconFlowProviderOptions(model),
    });

    const decision = RouterDecisionSchema.parse(object);
    return {
      ...appendIntelligenceStep(context, {
        layer: "router",
        decision: decision.route,
        confidence: decision.confidence,
        durationMs: Date.now() - startedAt,
        metadata: {
          reasoning: decision.reasoning,
          searchQuery: decision.searchQuery,
        },
      }),
      router: {
        route: decision.route,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        searchQuery: decision.searchQuery?.trim() || undefined,
      },
      thinkingBudget: spendBudget(context.thinkingBudget, 1),
    };
  } catch (error) {
    console.warn("[AdeHQ intelligence-router]", error);
    return appendIntelligenceStep(context, {
      layer: "router",
      decision: "failed",
      confidence: 0,
      durationMs: Date.now() - startedAt,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
