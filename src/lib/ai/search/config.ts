export type SearchProviderPref =
  | "gateway_perplexity"
  | "gateway_exa"
  | "gateway_parallel"
  | "tavily";

const GATEWAY_SEARCH_COST_USD_DEFAULT = 0.005;
const GATEWAY_SEARCH_WORK_MINUTES_DEFAULT = 1.5;
const EXA_SEARCH_COST_USD_DEFAULT = 0.007;
const RESEARCH_SESSION_TTL_DAYS_DEFAULT = 7;

export function isExaSearchConfigured(): boolean {
  return Boolean(process.env.EXA_API_KEY?.trim());
}

export function getExaSearchType(): string {
  return process.env.EXA_SEARCH_TYPE?.trim() || "auto";
}

export function getExaNumResults(): number {
  const raw = Number(process.env.EXA_NUM_RESULTS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 25) : 10;
}

export function getExaSearchCostUsd(): number {
  const raw = Number(process.env.EXA_SEARCH_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : EXA_SEARCH_COST_USD_DEFAULT;
}

export function getResearchSessionTtlDays(): number {
  const raw = Number(process.env.RESEARCH_SESSION_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : RESEARCH_SESSION_TTL_DAYS_DEFAULT;
}

export function isGatewaySearchConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export function isTavilySearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export function getSearchPrimaryProvider(): SearchProviderPref {
  const raw = process.env.AI_SEARCH_PRIMARY_PROVIDER?.trim().toLowerCase();
  if (raw === "gateway_exa") return "gateway_exa";
  if (raw === "gateway_parallel") return "gateway_parallel";
  if (raw === "tavily") return "tavily";
  return "gateway_perplexity";
}

export function getSearchBackupProvider(): SearchProviderPref {
  const raw = process.env.AI_SEARCH_BACKUP_PROVIDER?.trim().toLowerCase();
  if (raw === "gateway_perplexity") return "gateway_perplexity";
  if (raw === "gateway_exa") return "gateway_exa";
  if (raw === "gateway_parallel") return "gateway_parallel";
  return "tavily";
}

export function isBrowserResearchEnabled(): boolean {
  const raw = process.env.AI_BROWSER_RESEARCH_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function isBrowserResearchRequiresExplicitDeepTask(): boolean {
  const raw = process.env.AI_BROWSER_RESEARCH_REQUIRES_EXPLICIT_DEEP_TASK?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function getGatewaySearchCostUsd(): number {
  const raw = Number(process.env.AI_GATEWAY_SEARCH_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : GATEWAY_SEARCH_COST_USD_DEFAULT;
}

export function getGatewaySearchWorkMinutes(): number {
  const raw = Number(process.env.AI_GATEWAY_SEARCH_WORK_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : GATEWAY_SEARCH_WORK_MINUTES_DEFAULT;
}

export function getGatewaySearchModelId(): string {
  return (
    process.env.AI_GATEWAY_MODEL_EFFICIENT?.trim() ||
    process.env.AI_GATEWAY_MODEL_BALANCED?.trim() ||
    "deepseek/deepseek-v4-flash"
  );
}

export type FastFactSearchPreset = {
  maxResults: number;
  maxTokens: number;
  maxTokensPerPage: number;
  synthesisMaxOutputTokens: number;
  timeoutMs: number;
};

export function getFastFactSearchPreset(): FastFactSearchPreset {
  return {
    maxResults: 5,
    maxTokens: 10_000,
    maxTokensPerPage: 1_600,
    synthesisMaxOutputTokens: 650,
    timeoutMs: 10_000,
  };
}
