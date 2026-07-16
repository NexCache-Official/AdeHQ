// ===========================================================================
// AdeHQ research adapter — research.webSearch runs a live web search through
// the workspace's existing search pipeline (Exa primary → AI Gateway backup →
// Tavily), so employees (in chat AND on autopilot) can pull current facts,
// competitors, and pricing with cited sources instead of guessing.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { WebSearchArgs } from "@/lib/integrations/registry/tool-definitions";
import { executeSearchAnswer } from "@/lib/ai/search";

export async function webSearch(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: WebSearchArgs,
): Promise<ToolExecutionOutput> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new Error("research.webSearch needs a non-empty query.");
  }

  // executeSearchAnswer records a work unit + cache when it has a room/topic
  // context; autopilot sessions started outside a room may lack those, so we
  // only pass the client (which drives that tracking) when both are present.
  const hasRoomContext = Boolean(ctx.roomId && ctx.topicId);

  const result = await executeSearchAnswer({
    client: hasRoomContext ? client : undefined,
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId ?? "",
    topicId: ctx.topicId ?? "",
    employeeId: ctx.employeeId,
    employeeName: ctx.employeeName,
    query,
    agentRunId: ctx.agentRunId,
  });

  const sources = result.sources ?? [];
  const answer = (result.answer ?? "").trim();

  // The summary is what the autopilot loop records as its observation and what
  // the model reads back to write its deliverable — so pack the answer AND the
  // sources in, capped so a long synthesis can't blow up the step timeline.
  const lines: string[] = [answer || "No answer was produced for this query."];
  if (sources.length) {
    lines.push("", "Sources:");
    sources.slice(0, 6).forEach((source, i) => {
      lines.push(`${i + 1}. ${source.title || source.url} — ${source.url}`);
    });
  }
  const summary = lines.join("\n").slice(0, 6000);

  return {
    summary,
    payload: {
      query,
      answer,
      sources: sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })),
      route: result.route,
      providerRoute: result.providerRoute,
      estimatedCostUsd: result.estimatedCostUsd,
      sourceCount: sources.length,
    },
    workLogAction: "web_search",
  };
}
