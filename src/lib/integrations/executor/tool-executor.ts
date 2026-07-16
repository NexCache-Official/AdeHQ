// ===========================================================================
// Tool Execution Core — the single preview/execute entry point.
//
//   preview  → validate + permission check + human-readable preview;
//              risky tools also create an approval card with action_payload.
//              Never mutates business data.
//   execute  → permission checks; approval-required tools need an approved
//              approval; writes integration_tool_run + work log + cost fields.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, MessageArtifact } from "@/lib/types";
import type {
  ToolCallMode,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolPreview,
} from "@/lib/integrations/types";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import { checkEmployeeToolGrant, touchEmployeeToolGrant } from "@/lib/integrations/permissions";
import {
  consumeSessionGrant,
  conversationalGrantAskMessage,
  createCapabilityGrantApproval,
} from "@/lib/integrations/capability-grants";
import { CAPABILITY_DOMAINS, catalogToolIdForDomain } from "@/lib/integrations/registry/capabilities";
import { estimateToolRunCost } from "@/lib/integrations/cost";
import {
  buildIdempotencyKey,
  createToolRun,
  finalizeToolRun,
  findToolRunByIdempotencyKey,
} from "@/lib/integrations/tool-runs";
import { getInternalHandler } from "./internal-executor";
import { enqueueIntegrationJob } from "@/lib/integrations/jobs/queue";
import { coerceToolCall } from "@/lib/integrations/coerce-tool-args";
import { hydrateToolCallArgs, type ToolHydrationState } from "@/lib/integrations/hydrate-tool-args";
import { nowISO, uid } from "@/lib/utils";

export type RunToolCallOptions = {
  /** Employee record with tools loaded — used for the grant gate. */
  employee: Pick<AIEmployee, "id" | "name" | "tools">;
  /**
   * Set by the approval resolve route after it atomically flipped the
   * approval to approved — skips re-fetching the approval row.
   */
  approvalVerified?: boolean;
};

function failedResult(
  request: Pick<ToolCallRequest, "tool">,
  mode: ToolCallMode,
  error: string,
  status: ToolCallResult["status"] = "failed",
): ToolCallResult {
  return {
    status,
    tool: request.tool,
    mode,
    costUsd: 0,
    workMinutes: 0,
    error,
    messageArtifacts: [],
  };
}

async function writeWorkLog(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  params: {
    action: string;
    summary: string;
    toolUsed: string;
    status: "success" | "failed" | "needs_approval";
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
): Promise<string | null> {
  if (!ctx.roomId) return null;
  const id = uid("wl");
  const { error } = await client.from("work_log_events").insert({
    workspace_id: ctx.workspaceId,
    id,
    room_id: ctx.roomId,
    topic_id: ctx.topicId ?? null,
    employee_id: ctx.employeeId,
    action: params.action,
    summary: params.summary,
    tool_used: params.toolUsed,
    status: params.status,
    related_entity_type: params.relatedEntityType ?? null,
    related_entity_id: params.relatedEntityId ?? null,
    agent_run_id: ctx.agentRunId ?? null,
    created_at: nowISO(),
  });
  if (error) {
    console.warn("[AdeHQ integrations] work log write failed", error);
    return null;
  }
  return id;
}

async function createToolApproval(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: ToolDefinition<any>,
  args: Record<string, unknown>,
  preview: ToolPreview,
): Promise<string> {
  if (!ctx.roomId) {
    throw new Error(`${tool.name} needs approval, which requires a room context.`);
  }

  // Email send cards should show the full inbox draft, not a truncated preview.
  let enrichedArgs = { ...args };
  let enrichedPreview = preview;
  if (tool.name === "email.sendDraft" && typeof args.draftId === "string") {
    const { loadEmailDraftForApproval } = await import(
      "@/lib/integrations/sync-email-draft-approvals"
    );
    const draft = await loadEmailDraftForApproval(client, {
      workspaceId: ctx.workspaceId,
      draftId: args.draftId,
    });
    if (draft) {
      enrichedArgs = {
        ...enrichedArgs,
        subject: draft.subject || enrichedArgs.subject,
        recipientEmail: draft.recipientEmail || enrichedArgs.recipientEmail,
        bodyPreview: draft.body || enrichedArgs.bodyPreview,
        body: draft.body,
        threadId: draft.threadId ?? enrichedArgs.threadId ?? null,
      };
      enrichedPreview = tool.buildPreview(enrichedArgs);
    }
  }

  const approvalId = uid("appr");
  const { error } = await client.from("approvals").insert({
    workspace_id: ctx.workspaceId,
    id: approvalId,
    room_id: ctx.roomId,
    topic_id: ctx.topicId ?? null,
    requested_by: ctx.employeeId,
    title: enrichedPreview.title,
    description: enrichedPreview.summary,
    risk: enrichedPreview.risk,
    status: "pending",
    action_type: "tool_execution",
    action_payload: {
      tool: tool.name,
      args: enrichedArgs,
      employeeId: ctx.employeeId,
      requestedByUserId: ctx.requestedByUserId ?? null,
      roomId: ctx.roomId,
      topicId: ctx.topicId ?? null,
    },
    preview_snapshot: { ...enrichedPreview, toolName: tool.name },
    created_by_run_id: ctx.agentRunId ?? null,
    created_at: nowISO(),
  });
  if (error) throw error;
  return approvalId;
}

async function verifyApproval(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  approvalId: string,
  toolName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await client
    .from("approvals")
    .select("id, status, action_payload")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", approvalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: "Approval not found." };
  if (String(data.status) !== "approved") {
    return { ok: false, reason: `Approval is ${String(data.status)}, not approved.` };
  }
  const payload = (data.action_payload as Record<string, unknown> | null) ?? {};
  if (payload.tool !== toolName) {
    return { ok: false, reason: "Approval was granted for a different action." };
  }
  return { ok: true };
}

function resultArtifacts(params: {
  approvalId?: string;
  approvalTitle?: string;
  workLogEventId?: string | null;
  output?: ToolExecutionOutput;
}): MessageArtifact[] {
  const artifacts: MessageArtifact[] = [];
  if (params.approvalId) {
    artifacts.push({
      type: "approval",
      id: params.approvalId,
      label: `Approval: ${(params.approvalTitle ?? "Pending action").slice(0, 48)}`,
    });
  }
  if (params.output?.messageArtifact) {
    artifacts.push(params.output.messageArtifact);
  } else if (params.output && params.workLogEventId) {
    artifacts.push({
      type: "work_log",
      id: params.workLogEventId,
      label: params.output.summary.slice(0, 80),
    });
  }
  return artifacts;
}

/**
 * Run one tool call through the full contract. Never throws for business
 * failures — returns a ToolCallResult with status/error so callers (AI
 * pipeline, API routes) can degrade gracefully.
 */
export async function runToolCall(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  request: ToolCallRequest,
  options: RunToolCallOptions,
): Promise<ToolCallResult> {
  const mode: ToolCallMode = request.mode === "preview" ? "preview" : "execute";
  const normalizedRequest = coerceToolCall(request.tool, request);
  const tool = getToolDefinition(normalizedRequest.tool);
  if (!tool) {
    return failedResult(request, mode, `Unknown tool "${request.tool}".`);
  }

  const argsForParse = hydrateToolCallArgs(tool.name, normalizedRequest.args, {
    userMessage: ctx.triggerMessageText,
    state: ctx.toolHydrationState as ToolHydrationState | undefined,
  });
  const parsed = tool.argsSchema.safeParse(argsForParse);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "args"}: ${i.message}`)
      .join("; ");
    let runId: string | undefined;
    try {
      const run = await createToolRun(client, {
        ctx,
        capabilityDomain: tool.domain,
        toolName: tool.name,
        mode,
        status: "failed",
        inputPayload: argsForParse,
      });
      runId = run.id;
    } catch (error) {
      console.warn("[AdeHQ integrations] invalid-args tool run write failed", error);
    }
    const message = `Invalid arguments for ${tool.name} — ${issues}`;
    await writeWorkLog(client, ctx, {
      action: "integration_tool_failed",
      summary: `${tool.name} failed: ${message}`,
      toolUsed: tool.name,
      status: "failed",
    });
    return {
      ...failedResult(request, mode, message),
      tool: tool.name,
      toolRunId: runId,
      inputArgs: argsForParse,
      triggerMessageId: ctx.triggerMessageId,
    };
  }
  const args = parsed.data as Record<string, unknown>;

  // Gate 1: AI employee capability grant (permanent or Allow-once session).
  const grant = checkEmployeeToolGrant(options.employee, tool);
  if (!grant.granted) {
    const domainLabel = CAPABILITY_DOMAINS[tool.domain]?.label ?? tool.domain;
    const ask = conversationalGrantAskMessage({
      employeeName: options.employee.name,
      domainLabel,
      toolName: tool.name,
    });
    let approvalId: string | undefined;
    try {
      approvalId = await createCapabilityGrantApproval(
        client,
        ctx,
        tool,
        args,
        options.employee.name,
      );
    } catch (error) {
      console.warn("[AdeHQ integrations] capability grant approval failed", error);
    }
    try {
      await createToolRun(client, {
        ctx,
        capabilityDomain: tool.domain,
        toolName: tool.name,
        mode,
        status: "blocked",
        inputPayload: args,
        approvalId,
      });
    } catch (error) {
      console.warn("[AdeHQ integrations] blocked tool run write failed", error);
    }
    const workLogEventId = await writeWorkLog(client, ctx, {
      action: "tool_call_blocked",
      summary: grant.reason,
      toolUsed: tool.name,
      status: "needs_approval",
      relatedEntityType: approvalId ? "approval" : undefined,
      relatedEntityId: approvalId,
    });
    return {
      ...failedResult(request, mode, ask, "blocked"),
      approvalId,
      messageArtifacts: [
        ...(approvalId
          ? [
              {
                type: "approval" as const,
                id: approvalId,
                label: `Access: ${domainLabel}`,
              },
            ]
          : []),
        ...(workLogEventId
          ? [
              {
                type: "work_log" as const,
                id: workLogEventId,
                label: `Needs ${domainLabel} access`,
              },
            ]
          : []),
      ],
    };
  }

  const preview = tool.buildPreview(args);

  // -------------------------------------------------------------------------
  // preview — human-readable card; approval for gated tools; never mutates.
  // -------------------------------------------------------------------------
  if (mode === "preview") {
    try {
      let approvalId: string | undefined;
      if (tool.approval !== "none" && !tool.readOnly) {
        approvalId = await createToolApproval(client, ctx, tool, args, preview);
        await writeWorkLog(client, ctx, {
          action: "approval_requested",
          summary: `Requested approval: ${preview.title}`,
          toolUsed: tool.name,
          status: "needs_approval",
          relatedEntityType: "approval",
          relatedEntityId: approvalId,
        });
      }
      const run = await createToolRun(client, {
        ctx,
        capabilityDomain: tool.domain,
        toolName: tool.name,
        mode: "preview",
        status: "success",
        inputPayload: args,
        previewSnapshot: preview,
        approvalId,
      });
      return {
        status: approvalId ? "approval_pending" : "preview",
        tool: tool.name,
        mode: "preview",
        toolRunId: run.id,
        approvalId,
        preview,
        costUsd: 0,
        workMinutes: 0,
        messageArtifacts: resultArtifacts({ approvalId, approvalTitle: preview.title }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview failed.";
      return failedResult(request, mode, message);
    }
  }

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  // Gate 2: approval requirement for high-risk/external tools.
  if (tool.approval === "required" && !options.approvalVerified) {
    if (!request.approvalId) {
      try {
        const approvalId = await createToolApproval(client, ctx, tool, args, preview);
        const run = await createToolRun(client, {
          ctx,
          capabilityDomain: tool.domain,
          toolName: tool.name,
          mode: "preview",
          status: "success",
          inputPayload: args,
          previewSnapshot: preview,
          approvalId,
        });
        await writeWorkLog(client, ctx, {
          action: "approval_requested",
          summary: `Requested approval: ${preview.title}`,
          toolUsed: tool.name,
          status: "needs_approval",
          relatedEntityType: "approval",
          relatedEntityId: approvalId,
        });
        return {
          status: "approval_pending",
          tool: tool.name,
          mode,
          toolRunId: run.id,
          approvalId,
          preview,
          costUsd: 0,
          workMinutes: 0,
          messageArtifacts: resultArtifacts({ approvalId, approvalTitle: preview.title }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approval creation failed.";
        return failedResult(request, mode, message);
      }
    }
    const verified = await verifyApproval(client, ctx, request.approvalId, tool.name);
    if (!verified.ok) {
      return failedResult(request, mode, verified.reason, "blocked");
    }
  }

  // Idempotency — dedupe by approval, agent run, or trigger message scope.
  const scope = request.approvalId
    ? `approval:${request.approvalId}`
    : ctx.agentRunId
      ? `run:${ctx.agentRunId}`
      : ctx.triggerMessageId
        ? `msg:${ctx.triggerMessageId}`
        : null;
  const idempotencyKey =
    request.idempotencyKey ??
    (scope ? buildIdempotencyKey({ scope, tool: tool.name, args }) : undefined);

  if (idempotencyKey) {
    try {
      const existing = await findToolRunByIdempotencyKey(client, ctx.workspaceId, idempotencyKey);
      if (existing?.status === "success") {
        return {
          status: "success",
          tool: tool.name,
          mode,
          toolRunId: existing.id,
          approvalId: existing.approvalId,
          output: {
            summary: "Already done — this action was executed before (duplicate prevented).",
            payload: existing.outputPayload ?? {},
            objectId: existing.externalObjectId,
          },
          costUsd: 0,
          workMinutes: 0,
          messageArtifacts: [],
        };
      }
      if (existing && (existing.status === "pending" || existing.status === "running")) {
        return failedResult(request, mode, "This action is already in progress.", "blocked");
      }
    } catch (error) {
      console.warn("[AdeHQ integrations] idempotency lookup failed", error);
    }
  }

  // Async tools enqueue a job and return immediately.
  if (tool.asyncJobType) {
    try {
      const run = await createToolRun(client, {
        ctx,
        capabilityDomain: tool.domain,
        toolName: tool.name,
        mode,
        status: "pending",
        inputPayload: args,
        previewSnapshot: preview,
        approvalId: request.approvalId,
        idempotencyKey,
      });
      const job = await enqueueIntegrationJob(client, {
        workspaceId: ctx.workspaceId,
        employeeId: ctx.employeeId,
        jobType: tool.asyncJobType,
        toolRunId: run.id,
        payload: {
          tool: tool.name,
          args,
          ctx: {
            roomId: ctx.roomId,
            topicId: ctx.topicId,
            employeeId: ctx.employeeId,
            employeeName: ctx.employeeName,
            triggerMessageId: ctx.triggerMessageId,
          },
        },
      });
      await finalizeToolRunJobLink(client, ctx.workspaceId, run.id, job.id);
      return {
        status: "queued",
        tool: tool.name,
        mode,
        toolRunId: run.id,
        jobId: job.id,
        preview,
        costUsd: 0,
        workMinutes: 0,
        messageArtifacts: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to queue job.";
      return failedResult(request, mode, message);
    }
  }

  // Synchronous internal execution.
  const handler = getInternalHandler(tool.name);
  if (!handler) {
    return failedResult(
      request,
      mode,
      `${tool.name} has no available provider yet${tool.provider === "external" ? " — connect an integration first" : ""}.`,
    );
  }

  let runId: string | undefined;
  try {
    const run = await createToolRun(client, {
      ctx,
      capabilityDomain: tool.domain,
      toolName: tool.name,
      mode,
      status: "running",
      inputPayload: args,
      previewSnapshot: preview,
      approvalId: request.approvalId,
      idempotencyKey,
    });
    runId = run.id;

    const output = await handler(client, ctx, args);
    const cost = estimateToolRunCost(tool.name, mode);

    await finalizeToolRun(client, {
      toolRunId: run.id,
      workspaceId: ctx.workspaceId,
      status: "success",
      outputPayload: output.payload,
      externalObjectId: output.objectId,
      externalUrl: output.externalUrl,
      costUsd: cost.costUsd,
      workMinutes: cost.workMinutes,
    });

    let workLogEventId: string | null = null;
    if (!tool.readOnly) {
      workLogEventId = await writeWorkLog(client, ctx, {
        action: output.workLogAction ?? "integration_tool_executed",
        summary: output.summary,
        toolUsed: tool.name,
        status: "success",
        relatedEntityType: output.relatedEntityType,
        relatedEntityId: output.relatedEntityId ?? output.objectId,
      });
    }

    void touchEmployeeToolGrant(client, ctx.workspaceId, ctx.employeeId, tool);
    // Best-effort: burn an Allow-once session grant if this run used one.
    void consumeSessionGrant(client, {
      workspaceId: ctx.workspaceId,
      employeeId: ctx.employeeId,
      catalogToolId: catalogToolIdForDomain(tool.domain),
      roomId: ctx.roomId,
    });

    return {
      status: "success",
      tool: tool.name,
      mode,
      toolRunId: run.id,
      approvalId: request.approvalId,
      output,
      costUsd: cost.costUsd,
      workMinutes: cost.workMinutes,
      messageArtifacts: resultArtifacts({ workLogEventId, output }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    if (runId) {
      await finalizeToolRun(client, {
        toolRunId: runId,
        workspaceId: ctx.workspaceId,
        status: "failed",
        errorMessage: message,
      }).catch((err) => console.warn("[AdeHQ integrations] finalize failed", err));
    }
    await writeWorkLog(client, ctx, {
      action: "integration_tool_failed",
      summary: `${tool.name} failed: ${message}`,
      toolUsed: tool.name,
      status: "failed",
    });
    return { ...failedResult(request, mode, message), toolRunId: runId, idempotencyKey, inputArgs: args };
  }
}

async function finalizeToolRunJobLink(
  client: SupabaseClient,
  workspaceId: string,
  toolRunId: string,
  jobId: string,
): Promise<void> {
  const { error } = await client
    .from("integration_tool_runs")
    .update({ job_id: jobId })
    .eq("workspace_id", workspaceId)
    .eq("id", toolRunId);
  if (error) console.warn("[AdeHQ integrations] job link update failed", error);
}
