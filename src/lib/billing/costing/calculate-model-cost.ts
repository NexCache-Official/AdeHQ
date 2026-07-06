import { estimateCost } from "@/lib/ai/model-catalog";

export type ModelCostInput = {
  modelId?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  /** Provider-reported cost, if available (takes precedence). */
  actualCostUsd?: number | null;
  estimatedCostUsd?: number | null;
};

export type ModelCostResult = {
  costUsd: number;
  costSource: "provider_usage" | "estimated";
};

/**
 * Resolve the USD cost of an LLM/embedding call. Prefers a provider-reported cost,
 * then a caller estimate, then token-based estimation from the model catalog.
 */
export function calculateModelCost(input: ModelCostInput): ModelCostResult {
  if (input.actualCostUsd != null && input.actualCostUsd > 0) {
    return { costUsd: input.actualCostUsd, costSource: "provider_usage" };
  }
  if (input.estimatedCostUsd != null && input.estimatedCostUsd > 0) {
    return { costUsd: input.estimatedCostUsd, costSource: "estimated" };
  }
  const modelId = input.modelId?.trim();
  if (modelId) {
    const inputTokens = Math.max(0, input.inputTokens ?? 0);
    const outputTokens = Math.max(0, input.outputTokens ?? 0);
    if (inputTokens > 0 || outputTokens > 0) {
      const cost = estimateCost(modelId, inputTokens, outputTokens);
      if (cost > 0) return { costUsd: cost, costSource: "estimated" };
    }
  }
  return { costUsd: 0, costSource: "estimated" };
}
