// ===========================================================================
// Integration manager — high-level entry points used by the AI employee
// pipeline (effects.toolCalls) and the tools/run API route.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import type {
  IntegrationEmployee,
  ToolCallEffect,
  ToolCallResult,
  ToolExecutionContext,
} from "./types";
import { runToolCall } from "./executor/tool-executor";
import { ensureDefaultEmployeeToolGrants } from "./permissions";
import { getToolDefinition } from "./registry/tool-definitions";
import { mergeToolOutcomeArtifacts } from "./tool-outcome-artifacts";

/** Cap per response — mirrors workspace max_tool_runs_per_task guardrails. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 6;

export type EmployeeToolCallOutcome = {
  results: ToolCallResult[];
  messageArtifacts: MessageArtifact[];
  /** Compact summaries for logging/telemetry. */
  summaries: string[];
};

/**
 * Execute the tool calls emitted by an AI employee response, in order.
 * Called from persistEmployeeEffects so both the direct and queued AI
 * paths share one choke point. Failures never throw — each call yields a
 * result with status/error, and execution continues with the next call.
 */
export async function executeEmployeeToolCalls(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employee: IntegrationEmployee;
    roomId: string;
    topicId?: string;
    agentRunId?: string;
    triggerMessageId?: string;
    toolCalls: ToolCallEffect[];
  },
): Promise<EmployeeToolCallOutcome> {
  const calls = (params.toolCalls ?? [])
    .filter((call) => call && typeof call.tool === "string" && call.tool.includes("."))
    .slice(0, MAX_TOOL_CALLS_PER_RESPONSE);

  if (!calls.length) {
    return { results: [], messageArtifacts: [], summaries: [] };
  }

  // Self-heal grants for employees hired before the Integration Layer.
  const employee = await ensureDefaultEmployeeToolGrants(
    client,
    params.workspaceId,
    params.employee,
  );

  const ctx: ToolExecutionContext = {
    client,
    workspaceId: params.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roomId: params.roomId,
    topicId: params.topicId,
    agentRunId: params.agentRunId,
    triggerMessageId: params.triggerMessageId,
  };

  const results: ToolCallResult[] = [];
  for (const call of calls) {
    // Idempotency is derived inside runToolCall from the agent run / trigger
    // message scope — identical duplicate calls in one response dedupe safely.
    const result = await runToolCall(
      client,
      ctx,
      {
        tool: call.tool,
        mode: call.mode === "preview" ? "preview" : "execute",
        args: call.args ?? {},
        employeeId: employee.id,
      },
      { employee },
    );
    results.push(result);
  }

  return {
    results,
    messageArtifacts: mergeToolOutcomeArtifacts(results, results.flatMap((r) => r.messageArtifacts)),
    summaries: results.map((r) =>
      r.status === "success"
        ? (r.output?.summary ?? `${r.tool} succeeded`)
        : r.status === "approval_pending"
          ? `${r.tool} awaiting approval`
          : `${r.tool} ${r.status}${r.error ? `: ${r.error}` : ""}`,
    ),
  };
}

/** True when this workspace employee has any registered integration tool. */
export function isRegisteredTool(toolName: string): boolean {
  return Boolean(getToolDefinition(toolName));
}

export { runToolCall } from "./executor/tool-executor";
export { getToolDefinition, listToolDefinitions } from "./registry/tool-definitions";
