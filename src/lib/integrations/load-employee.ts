// ===========================================================================
// Lean employee loader for integration API routes — id, name, roleKey, and
// tool grants only (no room/AI context).
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeePermissions, ToolAccess } from "@/lib/types";
import { defaultPermissions } from "@/lib/demo/demo-data";
import type { IntegrationEmployee } from "./types";

export async function loadIntegrationEmployee(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<IntegrationEmployee | null> {
  const [employeeResult, toolsResult] = await Promise.all([
    client
      .from("ai_employees")
      .select("id, name, role_key, permissions")
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId)
      .maybeSingle(),
    client
      .from("employee_tools")
      .select("tool_id, status, permission, last_used_at")
      .eq("workspace_id", workspaceId)
      .eq("employee_id", employeeId),
  ]);

  if (employeeResult.error) throw employeeResult.error;
  if (!employeeResult.data) return null;
  if (toolsResult.error) throw toolsResult.error;

  const tools: ToolAccess[] = (toolsResult.data ?? []).map((row) => ({
    toolId: String(row.tool_id),
    name: String(row.tool_id),
    category: "Productivity",
    status: (row.status as ToolAccess["status"]) ?? "mock",
    permission: (row.permission as ToolAccess["permission"]) ?? "read",
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined,
  }));

  const stored = (employeeResult.data.permissions ?? {}) as Partial<EmployeePermissions>;

  return {
    id: String(employeeResult.data.id),
    name: String(employeeResult.data.name),
    roleKey: employeeResult.data.role_key as IntegrationEmployee["roleKey"],
    tools,
    permissions: defaultPermissions(stored),
  };
}
