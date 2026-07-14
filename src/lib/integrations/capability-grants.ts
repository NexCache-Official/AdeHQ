/**
 * Capability grant requests: Allow Once vs Always Allow (iOS-style).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee } from "@/lib/types";
import type { CapabilityDomain, ToolDefinition, ToolExecutionContext } from "@/lib/integrations/types";
import {
  CAPABILITY_DOMAINS,
  catalogToolIdForDomain,
} from "@/lib/integrations/registry/capabilities";
import { nowISO, uid } from "@/lib/utils";

export type CapabilityGrantScope = "once" | "always";

export type CapabilityGrantPayload = {
  kind: "capability_grant";
  tool: string;
  domain: CapabilityDomain;
  catalogToolId: string;
  args: Record<string, unknown>;
  employeeId: string;
  employeeName?: string;
  roomId?: string;
  topicId?: string;
  agentRunId?: string;
  triggerMessageId?: string;
};

export async function createCapabilityGrantApproval(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: ToolDefinition<any>,
  args: Record<string, unknown>,
  employeeName: string,
): Promise<string> {
  if (!ctx.roomId) {
    throw new Error("Capability grant requests require a room context.");
  }
  const domain = tool.domain;
  const catalogToolId = catalogToolIdForDomain(domain);
  const domainLabel = CAPABILITY_DOMAINS[domain]?.label ?? domain;
  const approvalId = uid("appr");
  const title = `${employeeName} needs ${domainLabel} access`;
  const description = [
    `${employeeName} was asked to use **${tool.name}** but doesn’t have the ${domainLabel} capability enabled.`,
    ``,
    `Allow once for this task, or always allow ${domainLabel} going forward?`,
  ].join("\n");

  const payload: CapabilityGrantPayload = {
    kind: "capability_grant",
    tool: tool.name,
    domain,
    catalogToolId,
    args,
    employeeId: ctx.employeeId,
    employeeName,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    agentRunId: ctx.agentRunId,
    triggerMessageId: ctx.triggerMessageId,
  };

  const { error } = await client.from("approvals").insert({
    workspace_id: ctx.workspaceId,
    id: approvalId,
    room_id: ctx.roomId,
    topic_id: ctx.topicId ?? null,
    requested_by: ctx.employeeId,
    title,
    description,
    risk: "medium",
    status: "pending",
    action_type: "tool_access",
    action_payload: payload,
    preview_snapshot: {
      toolName: tool.name,
      title,
      summary: description,
      risk: "medium",
      fields: [
        { label: "Capability", value: domainLabel },
        { label: "Tool", value: tool.name },
        { label: "Employee", value: employeeName },
      ],
    },
    created_by_run_id: ctx.agentRunId ?? null,
    created_at: nowISO(),
  });
  if (error) throw error;
  return approvalId;
}

export async function grantCapabilityAlways(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    catalogToolId: string;
  },
): Promise<void> {
  const { error } = await client.from("employee_tools").upsert(
    {
      workspace_id: params.workspaceId,
      employee_id: params.employeeId,
      tool_id: params.catalogToolId,
      status: "connected",
      permission: "write",
      last_used_at: null,
    },
    { onConflict: "workspace_id,employee_id,tool_id" },
  );
  if (error) throw error;
}

export async function grantCapabilityOnce(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    catalogToolId: string;
    roomId?: string | null;
    topicId?: string | null;
    grantedBy?: string | null;
    approvalId?: string | null;
  },
): Promise<string> {
  const { data, error } = await client
    .from("employee_tool_session_grants")
    .insert({
      workspace_id: params.workspaceId,
      employee_id: params.employeeId,
      catalog_tool_id: params.catalogToolId,
      room_id: params.roomId ?? null,
      topic_id: params.topicId ?? null,
      permission: "write",
      granted_by: params.grantedBy ?? null,
      approval_id: params.approvalId ?? null,
      uses_remaining: 1,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

/** Active one-time catalog tool ids for this employee (optionally room-scoped). */
export async function loadActiveSessionGrantToolIds(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    roomId?: string | null;
  },
): Promise<string[]> {
  const now = new Date().toISOString();
  let query = client
    .from("employee_tool_session_grants")
    .select("catalog_tool_id, room_id")
    .eq("workspace_id", params.workspaceId)
    .eq("employee_id", params.employeeId)
    .gt("uses_remaining", 0)
    .gt("expires_at", now);
  const { data, error } = await query;
  if (error) {
    // Table may not exist yet in older envs — fail open to permanent grants only.
    console.warn("[AdeHQ capability-grants] session grant lookup failed", error);
    return [];
  }
  return (data ?? [])
    .filter((row) => {
      const roomId = row.room_id ? String(row.room_id) : null;
      if (!roomId) return true;
      if (!params.roomId) return true;
      return roomId === params.roomId;
    })
    .map((row) => String(row.catalog_tool_id));
}

export async function consumeSessionGrant(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    catalogToolId: string;
    roomId?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { data } = await client
    .from("employee_tool_session_grants")
    .select("id, uses_remaining, room_id")
    .eq("workspace_id", params.workspaceId)
    .eq("employee_id", params.employeeId)
    .eq("catalog_tool_id", params.catalogToolId)
    .gt("uses_remaining", 0)
    .gt("expires_at", now)
    .order("created_at", { ascending: true })
    .limit(5);
  const row = (data ?? []).find((r) => {
    const roomId = r.room_id ? String(r.room_id) : null;
    if (!roomId) return true;
    if (!params.roomId) return true;
    return roomId === params.roomId;
  });
  if (!row) return;
  const remaining = Math.max(0, Number(row.uses_remaining ?? 1) - 1);
  await client
    .from("employee_tool_session_grants")
    .update({ uses_remaining: remaining })
    .eq("id", row.id)
    .eq("workspace_id", params.workspaceId);
}

export function conversationalGrantAskMessage(params: {
  employeeName: string;
  domainLabel: string;
  toolName: string;
}): string {
  return [
    `I don’t currently have access to **${params.domainLabel}** (needed for \`${params.toolName}\`).`,
    ``,
    `Would you like to:`,
    `• **Allow once** — just for this task`,
    `• **Always allow** — keep ${params.domainLabel} on for me`,
    `• **Not now** — I’ll skip it and continue without that tool`,
    ``,
    `You can tap the buttons on the request card, or reply with “once”, “always”, or “no”.`,
  ].join("\n");
}

/** Parse casual human replies into a grant decision. */
export function parseCapabilityGrantReply(
  text: string,
): CapabilityGrantScope | "deny" | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (
    /^(no|nope|not now|deny|don't|dont|skip|nah)\b/.test(t) ||
    /\b(not now|don't allow|do not allow|deny)\b/.test(t)
  ) {
    return "deny";
  }
  if (
    /\b(always|permanent|permanently|forever|keep it|all the time)\b/.test(t) ||
    /^(yes,? always|always allow)\b/.test(t)
  ) {
    return "always";
  }
  if (
    /\b(once|one time|one-time|just this|this (time|task|once)|allow once)\b/.test(t) ||
    /^(yes|yep|yeah|ok|okay|sure|go ahead|allow)\b/.test(t)
  ) {
    return "once";
  }
  return null;
}

export function withSessionGrantsOnEmployee<T extends Pick<AIEmployee, "tools">>(
  employee: T,
  sessionCatalogToolIds: string[],
): T {
  if (!sessionCatalogToolIds.length) return employee;
  const tools = [...employee.tools];
  for (const toolId of sessionCatalogToolIds) {
    const existing = tools.find((t) => t.toolId === toolId);
    if (existing) {
      if (existing.permission === "none" || existing.permission === "read") {
        existing.permission = "write";
        existing.status = "connected";
      }
    } else {
      tools.push({
        toolId,
        name: toolId,
        category: "Productivity",
        status: "connected",
        permission: "write",
      });
    }
  }
  return { ...employee, tools };
}
