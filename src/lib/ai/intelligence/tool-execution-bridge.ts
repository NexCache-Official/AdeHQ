import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAndRunBrowserResearch,
  loadWorkspaceEmployee,
  type CreateBrowserResearchRunParams,
} from "@/lib/ai/browser-research/server";
import { executeSearchAnswer } from "@/lib/ai/search/search-answer";
import {
  decideSearchSteward,
  defaultSearchStewardCapabilities,
  stewardDecisionToResearchProvider,
} from "@/lib/ai/search/search-steward";
import type { SearchAnswerResult } from "@/lib/ai/search/types";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import type { RoomMessage } from "@/lib/types";

export type IntelligenceToolName =
  | "search.gateway"
  | "search.exa"
  | "search.tavily"
  | "browser.research"
  | `internal.${string}`
  | `mcp.${string}`;

export type ToolExecutionRequest = {
  tool: IntelligenceToolName;
  args: Record<string, unknown>;
  budgetCost: number;
};

export type IntelligenceToolExecutor<TResult = unknown> = (
  request: ToolExecutionRequest,
) => Promise<TResult>;

export type IntelligenceToolContext = {
  client: SupabaseClient;
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  createdBy: string;
  agentRunId?: string;
  triggerMessageId?: string;
};

export type SearchToolArgs = {
  query: string;
  routeOverride?: "gateway_perplexity" | "gateway_exa" | "gateway_parallel" | "tavily";
  userQuestion?: string;
};

export type BrowserResearchToolArgs = {
  query: string;
  provider?: "browserbase" | "tavily";
  userQuestion?: string;
  plannerReasoning?: string;
  resolvedFrom?: string;
};

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool arg "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

/**
 * Stable boundary between the intelligence pipeline and concrete tools.
 * Search/browser use existing executors; MCP tools can register handlers later.
 */
export function createIntelligenceToolExecutor(
  ctx: IntelligenceToolContext,
): IntelligenceToolExecutor {
  return async (request) => executeIntelligenceTool(request, ctx);
}

export async function executeIntelligenceTool(
  request: ToolExecutionRequest,
  ctx: IntelligenceToolContext,
): Promise<unknown> {
  switch (request.tool) {
    case "search.gateway":
    case "search.exa":
    case "search.tavily":
      return executeSearchTool(request, ctx);
    case "browser.research":
      return executeBrowserResearchTool(request, ctx);
    default:
      if (request.tool.startsWith("mcp.")) {
        throw new Error(`MCP tool "${request.tool}" is not registered yet.`);
      }
      throw new Error(`Unknown intelligence tool: ${request.tool}`);
  }
}

async function executeSearchTool(
  request: ToolExecutionRequest,
  ctx: IntelligenceToolContext,
): Promise<SearchAnswerResult> {
  const args = request.args as SearchToolArgs;
  const query = asString(args.query, "query");
  const employee = await loadWorkspaceEmployee(ctx.client, ctx.workspaceId, ctx.employeeId);

  const steward = decideSearchSteward(query, {}, defaultSearchStewardCapabilities());
  const stewardRoute = stewardDecisionToResearchProvider(steward);
  const defaultRoute =
    request.tool === "search.exa"
      ? "gateway_exa"
      : request.tool === "search.tavily"
        ? "tavily"
        : stewardRoute === "gateway_exa"
          ? "gateway_exa"
          : stewardRoute === "gateway_parallel"
            ? "gateway_parallel"
            : "gateway_perplexity";

  return executeSearchAnswer({
    client: ctx.client,
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    employeeId: ctx.employeeId,
    employeeName: employee?.name,
    query,
    agentRunId: ctx.agentRunId,
    routeOverride: args.routeOverride ?? defaultRoute,
  });
}

async function executeBrowserResearchTool(
  request: ToolExecutionRequest,
  ctx: IntelligenceToolContext,
): Promise<{ run?: BrowserResearchRun; chatReply: RoomMessage | null; async: boolean }> {
  const args = request.args as BrowserResearchToolArgs;
  const query = asString(args.query, "query");
  const runParams: CreateBrowserResearchRunParams = {
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    employeeId: ctx.employeeId,
    createdBy: ctx.createdBy,
    query,
    provider: args.provider,
    triggerMessageId: ctx.triggerMessageId,
    userQuestion: args.userQuestion,
    plannerReasoning: args.plannerReasoning,
    resolvedFrom: args.resolvedFrom,
    agentRunId: ctx.agentRunId,
  };

  const { run, chatReply, async: isAsync } = await createAndRunBrowserResearch(
    ctx.client,
    runParams,
  );
  return { run, chatReply, async: isAsync };
}
