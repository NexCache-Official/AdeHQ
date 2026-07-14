/**
 * Shared resolve path for capability grants (Allow once / Always allow / Deny).
 * Used by the approvals API and conversational chat replies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolCallResult } from "@/lib/integrations/types";
import {
  consumeSessionGrant,
  grantCapabilityAlways,
  grantCapabilityOnce,
  loadActiveSessionGrantToolIds,
  parseCapabilityGrantReply,
  withSessionGrantsOnEmployee,
  type CapabilityGrantPayload,
  type CapabilityGrantScope,
} from "@/lib/integrations/capability-grants";
import { CAPABILITY_DOMAINS } from "@/lib/integrations/registry/capabilities";
import { runToolCall } from "@/lib/integrations/executor/tool-executor";
import { buildIdempotencyKey } from "@/lib/integrations/tool-runs";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import { nowISO, uid } from "@/lib/utils";

export function isCapabilityGrantPayload(
  payload: Record<string, unknown> | null | undefined,
): payload is CapabilityGrantPayload & Record<string, unknown> {
  return Boolean(payload && payload.kind === "capability_grant" && payload.catalogToolId);
}

export type ResolveCapabilityGrantResult = {
  approvalId: string;
  scope: CapabilityGrantScope | "deny";
  employeeId: string;
  domainLabel: string;
  toolName: string;
  execution?: ToolCallResult;
  acknowledgment: string;
};

async function writeWorkLog(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId?: string | null;
    employeeId: string;
    approvalId: string;
    action: string;
    summary: string;
    status: "success" | "failed";
  },
): Promise<void> {
  const { error } = await client.from("work_log_events").insert({
    workspace_id: params.workspaceId,
    id: uid("wl"),
    room_id: params.roomId,
    topic_id: params.topicId ?? null,
    employee_id: params.employeeId,
    action: params.action,
    summary: params.summary,
    status: params.status,
    related_entity_type: "approval",
    related_entity_id: params.approvalId,
    created_at: nowISO(),
  });
  if (error) console.warn("[AdeHQ capability-grant] work log failed", error);
}

export async function resolveCapabilityGrantApproval(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    approvalId: string;
    scope: CapabilityGrantScope | "deny";
    resolvedByUserId: string;
    note?: string | null;
  },
): Promise<ResolveCapabilityGrantResult | { error: string; status: number }> {
  const { data: approvalRow, error: loadError } = await client
    .from("approvals")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.approvalId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!approvalRow) return { error: "Approval not found.", status: 404 };

  const row = approvalRow as Record<string, unknown>;
  if (String(row.status) !== "pending") {
    return { error: "Approval was already resolved.", status: 409 };
  }
  if (String(row.action_type) !== "tool_access") {
    return { error: "Not a tool access request.", status: 400 };
  }

  const payload = (row.action_payload as Record<string, unknown> | null) ?? null;
  if (!isCapabilityGrantPayload(payload)) {
    return { error: "This approval is not a capability grant request.", status: 400 };
  }

  const domainLabel =
    CAPABILITY_DOMAINS[payload.domain]?.label ?? String(payload.domain);
  const employeeId = String(payload.employeeId ?? row.requested_by);
  const roomId = String(payload.roomId ?? row.room_id);
  const topicId = payload.topicId
    ? String(payload.topicId)
    : row.topic_id
      ? String(row.topic_id)
      : null;
  const toolName = String(payload.tool);

  if (params.scope === "deny") {
    const { data: updated, error: updateError } = await client
      .from("approvals")
      .update({
        status: "rejected",
        resolution_note: params.note?.trim() || "Not now",
        resolved_by: params.resolvedByUserId,
        resolved_at: nowISO(),
      })
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.approvalId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { error: "Approval was already resolved.", status: 409 };

    await writeWorkLog(client, {
      workspaceId: params.workspaceId,
      roomId,
      topicId,
      employeeId,
      approvalId: params.approvalId,
      action: "capability_grant_denied",
      summary: `Denied ${domainLabel} access for this task`,
      status: "failed",
    });

    return {
      approvalId: params.approvalId,
      scope: "deny",
      employeeId,
      domainLabel,
      toolName,
      acknowledgment: `Okay — I won’t use ${domainLabel} for now. Tell me how you’d like me to continue without it, or grant access later anytime.`,
    };
  }

  const { data: approved, error: approveError } = await client
    .from("approvals")
    .update({
      status: "approved",
      resolution_note:
        params.note?.trim() ||
        (params.scope === "always" ? "Always allow" : "Allow once"),
      resolved_by: params.resolvedByUserId,
      resolved_at: nowISO(),
      action_payload: { ...payload, grantScope: params.scope },
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.approvalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (approveError) throw approveError;
  if (!approved) return { error: "Approval was already resolved.", status: 409 };

  if (params.scope === "always") {
    await grantCapabilityAlways(client, {
      workspaceId: params.workspaceId,
      employeeId,
      catalogToolId: payload.catalogToolId,
    });
  } else {
    await grantCapabilityOnce(client, {
      workspaceId: params.workspaceId,
      employeeId,
      catalogToolId: payload.catalogToolId,
      roomId,
      topicId,
      grantedBy: params.resolvedByUserId,
      approvalId: params.approvalId,
    });
  }

  await writeWorkLog(client, {
    workspaceId: params.workspaceId,
    roomId,
    topicId,
    employeeId,
    approvalId: params.approvalId,
    action:
      params.scope === "always"
        ? "capability_grant_always"
        : "capability_grant_once",
    summary:
      params.scope === "always"
        ? `Always allowed ${domainLabel}`
        : `Allowed ${domainLabel} once for this task`,
    status: "success",
  });

  let execution: ToolCallResult | undefined;
  const employee = await loadIntegrationEmployee(client, params.workspaceId, employeeId);
  if (employee) {
    const sessionIds = await loadActiveSessionGrantToolIds(client, {
      workspaceId: params.workspaceId,
      employeeId,
      roomId,
    });
    const employeeWithGrants = withSessionGrantsOnEmployee(employee, sessionIds);
    const args = (payload.args as Record<string, unknown>) ?? {};
    execution = await runToolCall(
      client,
      {
        client,
        workspaceId: params.workspaceId,
        employeeId: employee.id,
        employeeName: employee.name,
        requestedByUserId: params.resolvedByUserId,
        roomId,
        topicId: topicId ?? undefined,
        agentRunId: payload.agentRunId ? String(payload.agentRunId) : undefined,
        triggerMessageId: payload.triggerMessageId
          ? String(payload.triggerMessageId)
          : undefined,
      },
      {
        tool: toolName,
        mode: "execute",
        args,
        employeeId: employee.id,
        requestedByUserId: params.resolvedByUserId,
        approvalId: params.approvalId,
        idempotencyKey: buildIdempotencyKey({
          scope: `capability-grant:${params.approvalId}`,
          tool: toolName,
          args,
        }),
      },
      { employee: employeeWithGrants, approvalVerified: true },
    );

    if (execution.status === "success") {
      await consumeSessionGrant(client, {
        workspaceId: params.workspaceId,
        employeeId,
        catalogToolId: payload.catalogToolId,
        roomId,
      });
      if (execution.toolRunId) {
        await client
          .from("approvals")
          .update({ executed_tool_run_id: execution.toolRunId })
          .eq("workspace_id", params.workspaceId)
          .eq("id", params.approvalId);
      }
    }
  }

  const scopeLabel = params.scope === "always" ? "always" : "just this once";
  const execNote =
    execution?.status === "success"
      ? execution.output?.summary
        ? ` ${execution.output.summary}`
        : " Done."
      : execution?.error
        ? ` I still hit a snag running it: ${execution.error}`
        : "";

  return {
    approvalId: params.approvalId,
    scope: params.scope,
    employeeId,
    domainLabel,
    toolName,
    execution,
    acknowledgment: `Thanks — ${domainLabel} is allowed ${scopeLabel}.${execNote}`,
  };
}

/** Find the newest pending capability-grant approval in this room/topic for chat replies. */
export async function findPendingCapabilityGrantApproval(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; topicId?: string | null },
): Promise<{ id: string; payload: CapabilityGrantPayload } | null> {
  let query = client
    .from("approvals")
    .select("id, action_payload, topic_id, created_at")
    .eq("workspace_id", params.workspaceId)
    .eq("room_id", params.roomId)
    .eq("status", "pending")
    .eq("action_type", "tool_access")
    .order("created_at", { ascending: false })
    .limit(8);

  const { data, error } = await query;
  if (error) {
    console.warn("[AdeHQ capability-grant] pending lookup failed", error);
    return null;
  }

  for (const row of data ?? []) {
    const payload = (row.action_payload as Record<string, unknown> | null) ?? null;
    if (!isCapabilityGrantPayload(payload)) continue;
    if (params.topicId && row.topic_id && String(row.topic_id) !== params.topicId) {
      continue;
    }
    return { id: String(row.id), payload };
  }
  return null;
}

export async function tryResolveCapabilityGrantFromHumanReply(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId?: string | null;
    userId: string;
    content: string;
  },
): Promise<ResolveCapabilityGrantResult | null> {
  const decision = parseCapabilityGrantReply(params.content);
  if (!decision) return null;

  const pending = await findPendingCapabilityGrantApproval(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
  });
  if (!pending) return null;

  const result = await resolveCapabilityGrantApproval(client, {
    workspaceId: params.workspaceId,
    approvalId: pending.id,
    scope: decision,
    resolvedByUserId: params.userId,
    note: params.content.trim().slice(0, 200),
  });
  if ("error" in result) return null;
  return result;
}
