import { getExaSearchCostUsd, getGatewaySearchCostUsd } from "@/lib/ai/search/config";
import { getTavilySearchCostUsd } from "@/lib/ai/browser-research/provider-config";

export type SearchProviderKind = "exa" | "gateway" | "perplexity" | "tavily";

/**
 * Per-request search cost. Prefer Brain snapshot rates at ledger time;
 * these helpers remain for estimates and legacy call sites.
 */
export function calculateSearchCost(
  provider: SearchProviderKind,
  requests = 1,
): { costUsd: number; requests: number } {
  const count = Math.max(1, Math.round(requests));
  let unit: number;
  switch (provider) {
    case "exa":
      unit = getExaSearchCostUsd();
      break;
    case "tavily":
      unit = getTavilySearchCostUsd();
      break;
    case "perplexity":
    case "gateway":
    default:
      unit = getGatewaySearchCostUsd();
      break;
  }
  return { costUsd: unit * count, requests: count };
}
