import { getGatewaySearchCostUsd } from "@/lib/ai/search/config";
import { getTavilySearchCostUsd } from "@/lib/ai/browser-research/provider-config";

export type SearchProviderKind = "gateway" | "tavily";

/**
 * Per-request search cost. Gateway (Perplexity/Exa/Parallel) and Tavily use configurable
 * assumed costs so pricing stays safe even when startup credits mask the real charge.
 */
export function calculateSearchCost(
  provider: SearchProviderKind,
  requests = 1,
): { costUsd: number; requests: number } {
  const count = Math.max(1, Math.round(requests));
  const unit = provider === "tavily" ? getTavilySearchCostUsd() : getGatewaySearchCostUsd();
  return { costUsd: unit * count, requests: count };
}
