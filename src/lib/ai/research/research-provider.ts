import {
  isFastSearchQuery,
  resolveBrowserResearchProviderForQuery,
} from "@/lib/ai/browser-research/provider-config";

export type ResearchProviderCapabilities = {
  tavily: boolean;
  browserbase: boolean;
};

/** Pick provider for a resolved query; user toggles override routing heuristics. */
export function pickResearchProvider(
  query: string,
  prefs: { preferTavily: boolean; preferAgentMode: boolean },
  capabilities: ResearchProviderCapabilities,
): "tavily" | "browserbase" | undefined {
  if (prefs.preferAgentMode && capabilities.browserbase) {
    return "browserbase";
  }
  if (prefs.preferTavily && capabilities.tavily) {
    return "tavily";
  }

  if (/\bhttps?:\/\//.test(query) && capabilities.browserbase && prefs.preferAgentMode) {
    return "browserbase";
  }

  if (prefs.preferAgentMode && capabilities.browserbase && !isFastSearchQuery(query)) {
    return "browserbase";
  }

  const routed = resolveBrowserResearchProviderForQuery(query);
  if (routed.provider === "tavily" && capabilities.tavily) return "tavily";
  if (routed.provider === "browserbase" && capabilities.browserbase) return "browserbase";
  if (capabilities.tavily) return "tavily";
  if (capabilities.browserbase) return "browserbase";
  return undefined;
}
