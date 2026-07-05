export type SearchProviderPref =
  | "gateway_perplexity"
  | "gateway_exa"
  | "gateway_parallel"
  | "tavily";

const GATEWAY_SEARCH_COST_USD_DEFAULT = 0.005;
const GATEWAY_SEARCH_WORK_MINUTES_DEFAULT = 1.5;

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
    "openai/gpt-4o-mini"
  );
}
