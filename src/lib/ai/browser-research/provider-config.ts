import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import type { BrowserResearchProvider } from "./types";

export type BrowserResearchProviderPref = BrowserResearchProvider;

const TAVILY_SEARCH_COST_USD_DEFAULT = 0.008;
const BROWSERBASE_SESSION_COST_USD_DEFAULT = 0.05;
const BROWSER_RESEARCH_MAX_PAGES_DEFAULT = 3;
const BROWSER_RESEARCH_MAX_SECONDS_DEFAULT = 120;

export function isBrowserResearchLiveEnabled(): boolean {
  return process.env.BROWSER_RESEARCH_LIVE_ENABLED?.trim().toLowerCase() === "true";
}

export function isBrowserbaseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

/** All three live gates: runtime on + provider browserbase + live flag + API key. */
export function isBrowserResearchLiveReady(): boolean {
  const { mode } = getRuntimeFlags();
  return (
    mode === "on" &&
    isBrowserResearchLiveEnabled() &&
    getBrowserResearchProviderPref() === "browserbase" &&
    isBrowserbaseConfigured()
  );
}

export function isBrowserResearchEvidenceEnabled(): boolean {
  const raw = process.env.BROWSER_RESEARCH_EVIDENCE_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function getBrowserResearchProviderPref(): BrowserResearchProviderPref {
  const raw = process.env.BROWSER_RESEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === "tavily") return "tavily";
  if (raw === "browserbase") return "browserbase";
  return "mock";
}

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export function getTavilySearchCostUsd(): number {
  const raw = Number(process.env.TAVILY_SEARCH_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : TAVILY_SEARCH_COST_USD_DEFAULT;
}

export function getTavilyMaxResults(): number {
  const raw = Number(process.env.TAVILY_MAX_RESULTS);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 20) return Math.floor(raw);
  return 5;
}

export function getBrowserbaseSessionCostUsd(): number {
  const raw = Number(process.env.BROWSERBASE_SESSION_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : BROWSERBASE_SESSION_COST_USD_DEFAULT;
}

export function getBrowserResearchMaxPages(): number {
  const raw = Number(process.env.BROWSER_RESEARCH_MAX_PAGES);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 10) return Math.floor(raw);
  return BROWSER_RESEARCH_MAX_PAGES_DEFAULT;
}

export function getBrowserResearchMaxSeconds(): number {
  const raw = Number(process.env.BROWSER_RESEARCH_MAX_SECONDS);
  if (Number.isFinite(raw) && raw >= 30 && raw <= 600) return Math.floor(raw);
  return BROWSER_RESEARCH_MAX_SECONDS_DEFAULT;
}

const FAST_SEARCH_PATTERNS = [
  /\b(how much|raised|funding|series [a-d]|valuation|investors?|latest news|when did|who is|what is|tell me about|find out|look up|search for)\b/i,
  /\b(recently|just raised|latest round|amount raised)\b/i,
];

/** Re-export meta-instruction helpers for browse API and tests. */
export { isMetaResearchInstruction, isMostlyMetaInstruction } from "@/lib/ai/research/resolve-research-query";

/** Factual lookup queries that Tavily can answer faster than live browsing. */
export function isFastSearchQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length > 240) return false;
  return FAST_SEARCH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function resolveBrowserResearchProvider(): {
  provider: BrowserResearchProvider;
  fallbackReason?: string;
} {
  const pref = getBrowserResearchProviderPref();

  if (pref === "browserbase") {
    if (!isBrowserResearchLiveReady()) {
      if (!isBrowserResearchLiveEnabled()) {
        console.warn(
          "[AdeHQ browser research] BROWSER_RESEARCH_LIVE_ENABLED is false — falling back from browserbase.",
        );
        return resolveBrowserResearchProviderFallback("live_disabled");
      }
      if (getRuntimeFlags().mode !== "on") {
        console.warn(
          "[AdeHQ browser research] AI_RUNTIME_V2_MODE is not on — falling back from browserbase.",
        );
        return resolveBrowserResearchProviderFallback("runtime_not_on");
      }
      if (!isBrowserbaseConfigured()) {
        console.warn(
          "[AdeHQ browser research] BROWSERBASE_API_KEY not configured — falling back from browserbase.",
        );
        return resolveBrowserResearchProviderFallback("browserbase_key_missing");
      }
    }
    return { provider: "browserbase" };
  }

  if (pref === "tavily") {
    if (!isTavilyConfigured()) {
      console.warn(
        "[AdeHQ browser research] TAVILY_API_KEY not configured — falling back to mock provider.",
      );
      return { provider: "mock", fallbackReason: "tavily_key_missing" };
    }
    return { provider: "tavily" };
  }

  return { provider: "mock" };
}

function resolveBrowserResearchProviderFallback(
  reason: string,
): { provider: BrowserResearchProvider; fallbackReason: string } {
  if (isTavilyConfigured()) {
    return { provider: "tavily", fallbackReason: reason };
  }
  return { provider: "mock", fallbackReason: reason };
}

/** Prefer Tavily for fast factual lookups even when browserbase is the workspace default. */
export function resolveBrowserResearchProviderForQuery(query: string): {
  provider: BrowserResearchProvider;
  fallbackReason?: string;
  routeReason?: string;
} {
  const base = resolveBrowserResearchProvider();

  if (
    base.provider === "browserbase" &&
    isFastSearchQuery(query) &&
    isTavilyConfigured()
  ) {
    return { provider: "tavily", routeReason: "fast_search" };
  }

  return base;
}

export function getBrowserResearchProviderConfig() {
  const pref = getBrowserResearchProviderPref();
  const tavilyConfigured = isTavilyConfigured();
  const browserbaseConfigured = isBrowserbaseConfigured();
  const liveEnabled = isBrowserResearchLiveEnabled();
  const liveReady = isBrowserResearchLiveReady();
  const resolved = resolveBrowserResearchProvider();
  return {
    providerPref: pref,
    effectiveProvider: resolved.provider,
    tavilyConfigured,
    browserbaseConfigured,
    liveEnabled,
    liveReady,
    fallbackReason: resolved.fallbackReason,
  };
}
