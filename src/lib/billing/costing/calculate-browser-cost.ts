import { getBrowserbaseSessionCostUsd } from "@/lib/ai/browser-research/provider-config";

export type BrowserCostInput = {
  pagesOpened?: number;
  /** LLM/extraction cost incurred during the browsing session, if known. */
  llmCostUsd?: number;
};

const PER_PAGE_SURCHARGE_USD = 0.0005;

/**
 * Browser research session cost: base session cost + a small per-page surcharge + any
 * LLM cost incurred during act/extract. Uses configurable assumed session cost.
 */
export function calculateBrowserCost(input: BrowserCostInput): { costUsd: number } {
  const session = getBrowserbaseSessionCostUsd();
  const pages = Math.max(0, input.pagesOpened ?? 0);
  const llm = Math.max(0, input.llmCostUsd ?? 0);
  return { costUsd: session + pages * PER_PAGE_SURCHARGE_USD + llm };
}
