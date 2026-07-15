// ===========================================================================
// Integration permissions — dual gate:
//   1. Human workspace role (who is triggering / approving)
//   2. AI employee capability grant (what this employee may use)
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, ToolAccess, WorkspaceMemberRole } from "@/lib/types";
import type { IntegrationEmployee, ToolDefinition } from "@/lib/integrations/types";
import { catalogToolIdForDomain, INTERNAL_CAPABILITY_TOOL_IDS } from "./registry/capabilities";
import { nowISO } from "@/lib/utils";

export type HumanIntegrationPermissions = {
  /** Manage connections and workspace-level integration settings. */
  integrationsAdmin: boolean;
  /** Approve external publish/send/bulk actions. */
  approveExternalActions: boolean;
  /** Trigger drafts / internal actions via AI employees. */
  requestViaAi: boolean;
};

export function resolveHumanIntegrationPermissions(
  role: WorkspaceMemberRole | string,
): HumanIntegrationPermissions {
  switch (role) {
    case "admin":
    case "owner": // legacy
      return { integrationsAdmin: true, approveExternalActions: true, requestViaAi: true };
    case "member":
    case "manager": // legacy → treat as member with AI request
      return { integrationsAdmin: false, approveExternalActions: true, requestViaAi: true };
    default:
      return { integrationsAdmin: false, approveExternalActions: false, requestViaAi: true };
  }
}

export function canResolveApprovals(role: WorkspaceMemberRole | string): boolean {
  return resolveHumanIntegrationPermissions(role).approveExternalActions;
}

// ---------------------------------------------------------------------------
// Employee capability grants (employee_tools rows on internal catalog tools)
// ---------------------------------------------------------------------------

export type EmployeeGrantCheck =
  | { granted: true }
  | { granted: false; reason: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkEmployeeToolGrant(
  employee: Pick<AIEmployee, "id" | "name" | "tools">,
  tool: ToolDefinition<any>,
): EmployeeGrantCheck {
  const catalogToolId = catalogToolIdForDomain(tool.domain);
  const grant = employee.tools.find((t) => t.toolId === catalogToolId);

  if (!grant || grant.permission === "none") {
    return {
      granted: false,
      reason: `${employee.name} does not have the ${tool.domain} capability enabled. Asking for Allow once or Always allow.`,
    };
  }

  if (!tool.readOnly && grant.permission === "read") {
    return {
      granted: false,
      reason: `${employee.name} has read-only ${tool.domain} access — asking for write (Allow once or Always allow).`,
    };
  }

  return { granted: true };
}

/**
 * Self-heal grants for employees hired before the Integration Layer existed:
 * if the employee has NO internal capability rows at all, seed every internal
 * capability (CRM, email, tasks, drive/artifacts, calendar, investors,
 * teamwork) — same "all on by default" policy as new hires. Employees with
 * explicit rows are left untouched, so user toggles always win.
 */
export async function ensureDefaultEmployeeToolGrants<T extends IntegrationEmployee>(
  client: SupabaseClient,
  workspaceId: string,
  employee: T,
): Promise<T> {
  const hasInternalGrant = employee.tools.some((t) =>
    INTERNAL_CAPABILITY_TOOL_IDS.includes(t.toolId),
  );
  if (hasInternalGrant) return employee;

  const toolIds = INTERNAL_CAPABILITY_TOOL_IDS;
  if (!toolIds.length) return employee;

  const rows = toolIds.map((toolId) => ({
    workspace_id: workspaceId,
    employee_id: employee.id,
    tool_id: toolId,
    status: "connected",
    permission: "write",
  }));

  const { error } = await client
    .from("employee_tools")
    .upsert(rows, { onConflict: "workspace_id,employee_id,tool_id" });
  if (error) {
    console.warn("[AdeHQ integrations] failed to seed default employee tool grants", error);
    return employee;
  }

  const seeded: ToolAccess[] = toolIds.map((toolId) => ({
    toolId,
    name: toolId,
    category: "Productivity",
    status: "connected",
    permission: "write",
    lastUsedAt: undefined,
  }));

  return { ...employee, tools: [...employee.tools, ...seeded] };
}

/** Record tool usage on the grant row (last_used_at) — best effort. */
export async function touchEmployeeToolGrant(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: ToolDefinition<any>,
): Promise<void> {
  const catalogToolId = catalogToolIdForDomain(tool.domain);
  await client
    .from("employee_tools")
    .update({ last_used_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .eq("tool_id", catalogToolId)
    .then(({ error }) => {
      if (error) console.warn("[AdeHQ integrations] touch grant failed", error);
    });
}
