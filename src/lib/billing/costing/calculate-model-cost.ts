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
 * Resolve the USD cost of an LLM/embedding call.
 * Prefer provider actual → token×catalog rates → queue-time estimate.
 */
export function calculateModelCost(input: ModelCostInput): ModelCostResult {
  if (input.actualCostUsd != null && input.actualCostUsd > 0) {
    return { costUsd: input.actualCostUsd, costSource: "provider_usage" };
  }

  const modelId = input.modelId?.trim();
  if (modelId) {
    const billedInput =
      Math.max(0, input.inputTokens ?? 0) + Math.max(0, input.cachedInputTokens ?? 0);
    const outputTokens = Math.max(0, input.outputTokens ?? 0);
    if (billedInput > 0 || outputTokens > 0) {
      const cost = estimateCost(modelId, billedInput, outputTokens);
      if (cost > 0) return { costUsd: cost, costSource: "estimated" };
    }
  }

  if (input.estimatedCostUsd != null && input.estimatedCostUsd > 0) {
    return { costUsd: input.estimatedCostUsd, costSource: "estimated" };
  }

  return { costUsd: 0, costSource: "estimated" };
}
