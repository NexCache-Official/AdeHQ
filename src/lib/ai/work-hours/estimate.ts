import { estimateCost } from "@/lib/ai/model-catalog";
import { getWorkMinuteUsdRate } from "./constants";

/** Convert provider/model USD cost to estimated Work Minutes. */
export function estimateWorkMinutesFromCost(costUsd: number): number {
  const rate = getWorkMinuteUsdRate();
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((costUsd / rate) * 100) / 100;
}

export function resolveShadowCostUsd(params: {
  actualCostUsd?: number | null;
  estimatedCostUsd?: number | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number | null {
  if (params.actualCostUsd != null && params.actualCostUsd > 0) {
    return params.actualCostUsd;
  }
  if (params.estimatedCostUsd != null && params.estimatedCostUsd > 0) {
    return params.estimatedCostUsd;
  }
  if (params.modelId?.trim()) {
    const inputTokens = Math.max(0, params.inputTokens ?? 0);
    const outputTokens = Math.max(0, params.outputTokens ?? 0);
    if (inputTokens > 0 || outputTokens > 0) {
      const estimated = estimateCost(params.modelId, inputTokens, outputTokens);
      return estimated > 0 ? estimated : null;
    }
  }
  return null;
}
