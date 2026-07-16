import { estimateCost } from "@/lib/ai/model-catalog";
import type { CostSource } from "./types";

export type ModelCostInput = {
  modelId?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  providerRoute?: string | null;
  /** Provider-reported cost, if available (takes precedence). */
  actualCostUsd?: number | null;
  estimatedCostUsd?: number | null;
};

export type ModelCostResult = {
  costUsd: number;
  /** token_rates = real token counts × curated/snapshot rates (not a guess). */
  costSource: Extract<CostSource, "provider_usage" | "token_rates" | "estimated">;
};

/**
 * Resolve the USD cost of an LLM/embedding call.
 * Prefer provider actual → tokens×rates (token_rates) → queue-time estimate.
 */
export function calculateModelCost(input: ModelCostInput): ModelCostResult {
  if (input.actualCostUsd != null && input.actualCostUsd > 0) {
    return { costUsd: input.actualCostUsd, costSource: "provider_usage" };
  }

  const modelId = input.modelId?.trim();
  if (modelId) {
    const inputTokens = Math.max(0, input.inputTokens ?? 0);
    const cachedInputTokens = Math.max(0, input.cachedInputTokens ?? 0);
    const outputTokens = Math.max(0, input.outputTokens ?? 0);
    if (inputTokens > 0 || cachedInputTokens > 0 || outputTokens > 0) {
      const promptTokens = inputTokens > 0 ? inputTokens : cachedInputTokens;
      const cost = estimateCost(modelId, promptTokens, outputTokens, {
        cachedInputTokens: inputTokens > 0 ? cachedInputTokens : 0,
        providerRoute: input.providerRoute,
      });
      if (cost > 0) return { costUsd: cost, costSource: "token_rates" };
    }
  }

  if (input.estimatedCostUsd != null && input.estimatedCostUsd > 0) {
    return { costUsd: input.estimatedCostUsd, costSource: "estimated" };
  }

  return { costUsd: 0, costSource: "estimated" };
}
