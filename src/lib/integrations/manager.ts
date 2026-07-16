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
import {
  loadActiveSessionGrantToolIds,
  withSessionGrantsOnEmployee,
} from "./capability-grants";
import { getToolDefinition } from "./registry/tool-definitions";
import { mergeToolOutcomeArtifacts } from "./tool-outcome-artifacts";
import { coerceToolCall } from "./coerce-tool-args";
import { drainQueuedToolResult } from "./jobs/drain-queued-result";
import { processIntegrationJob } from "./jobs/worker";
import {
  createToolHydrationState,
  hydrateToolCallArgs,
  observeToolCallResult,
} from "./hydrate-tool-args";
import { isHeavyArtifactTool } from "@/lib/tasks/work-classes";
import { messageWantsEmailSend } from "@/lib/ai/message-intent";

export { messageWantsEmailSend };

/** Cap per response — mirrors workspace max_tool_runs_per_task guardrails. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 6;

export type EmployeeToolCallOutcome = {
  results: ToolCallResult[];
  messageArtifacts: MessageArtifact[];
  /** Compact summaries for logging/telemetry. */
  summaries: string[];
};

async function loadTriggerMessageText(
  client: SupabaseClient,
  workspaceId: string,
  triggerMessageId?: string,
): Promise<string | undefined> {
  if (!triggerMessageId) return undefined;
  const { data, error } = await client
    .from("messages")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("id", triggerMessageId)
    .maybeSingle();
  if (error) {
    console.warn("[AdeHQ integrations] trigger message fetch failed", error);
    return undefined;
  }
  return data?.content ? String(data.content) : undefined;
}

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
    /** Test/API override; production normally fetches this from triggerMessageId. */
    triggerMessageText?: string;
    emailThreadId?: string;
    emailMessageId?: string;
    toolCalls: ToolCallEffect[];
  },
): Promise<EmployeeToolCallOutcome> {
  const CREATE_ALREADY_SAVES = new Set([
    "artifact.createSpreadsheet",
    "artifact.createPdfReport",
    "artifact.createDocx",
    "artifact.createPresentation",
    "artifact.convertFile",
    "artifact.updateSpreadsheet",
    "image.create",
    "image.edit",
    "image.regenerate",
    "video.create",
  ]);

  const rawCalls = (params.toolCalls ?? []).filter(
    (call) => call && typeof call.tool === "string" && call.tool.includes("."),
  );
  // create* jobs already persist a Drive binary — a parallel saveToDrive chip is
  // redundant and shows as two "Generating…" cards at once.
  const hasCreateThatSaves = rawCalls.some((call) => CREATE_ALREADY_SAVES.has(call.tool));
  const calls = rawCalls
    .filter((call) => !(hasCreateThatSaves && call.tool === "artifact.saveToDrive"))
    .slice(0, MAX_TOOL_CALLS_PER_RESPONSE);

  if (!calls.length) {
    return { results: [], messageArtifacts: [], summaries: [] };
  }

  // Self-heal grants for employees hired before the Integration Layer, then
  // overlay any active Allow-once session grants for this room.
  const seeded = await ensureDefaultEmployeeToolGrants(
    client,
    params.workspaceId,
    params.employee,
  );
  const sessionIds = await loadActiveSessionGrantToolIds(client, {
    workspaceId: params.workspaceId,
    employeeId: seeded.id,
    roomId: params.roomId,
  });
  const employee = withSessionGrantsOnEmployee(seeded, sessionIds);

  const ctx: ToolExecutionContext = {
    client,
    workspaceId: params.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roomId: params.roomId,
    topicId: params.topicId,
    agentRunId: params.agentRunId,
    triggerMessageId: params.triggerMessageId,
    emailThreadId: params.emailThreadId,
    emailMessageId: params.emailMessageId,
  };
  const triggerMessageText =
    params.triggerMessageText ??
    (await loadTriggerMessageText(client, params.workspaceId, params.triggerMessageId));
  const hydrationState = createToolHydrationState(triggerMessageText, {
    roleKey: employee.roleKey,
  });
  ctx.triggerMessageText = triggerMessageText;
  ctx.toolHydrationState = hydrationState as Record<string, unknown>;

  const results: ToolCallResult[] = [];
  const hydratedCalls: ToolCallEffect[] = [];
  for (const call of calls) {
    const coerced = coerceToolCall(call.tool, call);
    const args = hydrateToolCallArgs(coerced.tool, coerced.args, {
      userMessage: triggerMessageText,
      state: hydrationState,
    });
    hydratedCalls.push({ tool: coerced.tool, mode: coerced.mode, args });
    // Idempotency is derived inside runToolCall from the agent run / trigger
    // message scope — identical duplicate calls in one response dedupe safely.
    const result = await runToolCall(
      client,
      ctx,
      {
        tool: coerced.tool,
        mode: coerced.mode,
        args,
        employeeId: employee.id,
      },
      { employee },
    );
    observeToolCallResult(coerced.tool, args, result, hydrationState);
    // Heavy Drive artifacts: detach from the chat turn so the interactive lane
    // stays free (chip reconciles when the integration job completes).
    if (
      result.status === "queued" &&
      result.jobId &&
      isHeavyArtifactTool(coerced.tool)
    ) {
      void processIntegrationJob(client, params.workspaceId, result.jobId).catch((err) => {
        console.warn("[AdeHQ integrations] detached artifact job failed", err);
      });
      results.push(result);
      continue;
    }
    const drained = await drainQueuedToolResult(client, params.workspaceId, result);
    results.push(drained);
  }

  // Safe send path: if the human asked to send mail and we created an inbox
  // draft but the model never requested send approval, open the approval card.
  const alreadySend = hydratedCalls.some((c) => c.tool === "email.sendDraft")
    || results.some((r) => r.tool === "email.sendDraft");
  const draftId = hydrationState.inboxDraftId;
  if (
    draftId
    && !alreadySend
    && messageWantsEmailSend(triggerMessageText)
    && results.length < MAX_TOOL_CALLS_PER_RESPONSE
  ) {
    const sendArgs = hydrateToolCallArgs(
      "email.sendDraft",
      { draftId },
      { userMessage: triggerMessageText, state: hydrationState },
    );
    hydratedCalls.push({ tool: "email.sendDraft", mode: "execute", args: sendArgs });
    const sendResult = await runToolCall(
      client,
      ctx,
      {
        tool: "email.sendDraft",
        mode: "execute",
        args: sendArgs,
        employeeId: employee.id,
      },
      { employee },
    );
    observeToolCallResult("email.sendDraft", sendArgs, sendResult, hydrationState);
    results.push(sendResult);
  }

  return {
    results,
    messageArtifacts: mergeToolOutcomeArtifacts(
      results,
      results.flatMap((r) => r.messageArtifacts),
      hydratedCalls,
      { triggerMessageId: params.triggerMessageId },
    ),
    summaries: results.map((r) =>
      r.status === "success"
        ? (r.output?.summary ?? `${r.tool} succeeded`)
        : r.status === "queued"
          ? `${r.tool} still generating`
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
