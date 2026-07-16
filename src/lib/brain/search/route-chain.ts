import type { SearchRoute } from "@/lib/ai/search/types";
import {
  isExaSearchConfigured,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "@/lib/ai/search/config";
import type { BrainSearchNeed } from "./types";

export type SearchProviderSlot = "exa" | "perplexity" | "tavily" | "browserbase";

function envProvider(raw: string | undefined): SearchProviderSlot | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === "exa" || v === "gateway_exa") return "exa";
  if (v === "perplexity" || v === "gateway_perplexity") return "perplexity";
  if (v === "tavily") return "tavily";
  if (v === "browserbase") return "browserbase";
  return null;
}

export function slotToSearchRoute(slot: SearchProviderSlot): SearchRoute {
  switch (slot) {
    case "exa":
      return "gateway_exa";
    case "perplexity":
      return "gateway_perplexity";
    case "tavily":
      return "tavily";
    case "browserbase":
      return "browserbase";
  }
}

export function isSlotConfigured(slot: SearchProviderSlot): boolean {
  switch (slot) {
    case "exa":
      return isExaSearchConfigured() || isGatewaySearchConfigured();
    case "perplexity":
      return isGatewaySearchConfigured();
    case "tavily":
      return isTavilySearchConfigured();
    case "browserbase":
      return true;
  }
}

/**
 * Ordered provider chain for a Brain search need.
 * Browserbase is interaction-only — never in the ordinary fact ladder.
 */
export function mapNeedToSearchRouteChain(need: BrainSearchNeed): SearchRoute[] {
  if (need === "website_interaction") {
    return ["browserbase"];
  }

  const primary = envProvider(process.env.ADEHQ_SEARCH_PRIMARY) ?? "exa";
  const fallback1 = envProvider(process.env.ADEHQ_SEARCH_FALLBACK_1) ?? "perplexity";
  const fallback2 = envProvider(process.env.ADEHQ_SEARCH_FALLBACK_2) ?? "tavily";

  const ordered: SearchProviderSlot[] = [];
  for (const slot of [primary, fallback1, fallback2]) {
    if (slot === "browserbase") continue;
    if (!ordered.includes(slot)) ordered.push(slot);
  }
  // Ensure full ladder even if env misconfigured.
  for (const slot of ["exa", "perplexity", "tavily"] as SearchProviderSlot[]) {
    if (!ordered.includes(slot)) ordered.push(slot);
  }

  // Return the logical chain; callers filter by capabilities / isSlotConfigured.
  return ordered.map(slotToSearchRoute);
}

export function brainRouteIdForSlot(slot: SearchProviderSlot): string {
  switch (slot) {
    case "exa":
      return "route_search_exa";
    case "perplexity":
      return "route_search_perplexity";
    case "tavily":
      return "route_search_tavily";
    case "browserbase":
      return "route_browser_browserbase";
  }
}

export function searchRouteToSlot(route: SearchRoute): SearchProviderSlot | null {
  switch (route) {
    case "gateway_exa":
      return "exa";
    case "gateway_perplexity":
      return "perplexity";
    case "tavily":
      return "tavily";
    case "browserbase":
      return "browserbase";
    default:
      return null;
  }
}
