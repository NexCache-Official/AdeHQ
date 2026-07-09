export type IntelligenceToolName =
  | "search.gateway"
  | "search.tavily"
  | "browser.research"
  | `internal.${string}`
  | `mcp.${string}`;

export type ToolExecutionRequest = {
  tool: IntelligenceToolName;
  args: Record<string, unknown>;
  budgetCost: number;
};

/**
 * Stable boundary between the intelligence pipeline and concrete tools.
 * Search/browser use existing executors in v1; MCP tools can implement this
 * contract later without changing the pipeline.
 */
export type IntelligenceToolExecutor<TResult = unknown> = (
  request: ToolExecutionRequest,
) => Promise<TResult>;
