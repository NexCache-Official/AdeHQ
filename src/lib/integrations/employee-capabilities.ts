import type { AIEmployee, ToolAccess, ToolPermission } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapabilityDomain, IntegrationEmployee } from "@/lib/integrations/types";
import {
  CAPABILITY_DOMAINS,
  catalogToolIdForDomain,
  INTERNAL_CAPABILITY_TOOL_IDS,
} from "@/lib/integrations/registry/capabilities";
import { TOOL_CATALOG } from "@/lib/demo";
import { suggestedCapabilityDomains } from "@/lib/integrations/registry/prefab-toolsets";

export type EmployeeCapabilityToggle = {
  domain: CapabilityDomain;
  label: string;
  description: string;
  catalogToolId: string;
  enabled: boolean;
  permission: ToolPermission;
  suggested: boolean;
};

const UI_DOMAINS: CapabilityDomain[] = ["crm", "email", "tasks", "drive", "artifact"];

export function listEmployeeCapabilityToggles(
  employee: Pick<IntegrationEmployee, "roleKey" | "tools">,
): EmployeeCapabilityToggle[] {
  const suggested = new Set(suggestedCapabilityDomains(employee.roleKey));

  return UI_DOMAINS.map((domain) => {
    const info = CAPABILITY_DOMAINS[domain];
    const catalogToolId = catalogToolIdForDomain(domain);
    const grant = employee.tools.find((t) => t.toolId === catalogToolId);
    const enabled = Boolean(grant && grant.permission !== "none");

    return {
      domain,
      label: info.label,
      description: info.description,
      catalogToolId,
      enabled,
      permission: grant?.permission ?? "none",
      suggested: suggested.has(domain),
    };
  });
}

export function applyEmployeeCapabilityToggles<T extends Pick<AIEmployee, "tools">>(
  employee: T,
  enabledDomains: CapabilityDomain[],
): T {
  const enabledSet = new Set(enabledDomains);
  const enabledCatalogIds = new Set(
    enabledDomains.map((domain) => catalogToolIdForDomain(domain)),
  );

  const nextTools: ToolAccess[] = employee.tools
    .filter((tool) => !INTERNAL_CAPABILITY_TOOL_IDS.includes(tool.toolId))
    .map((tool) => ({ ...tool }));

  for (const catalogToolId of INTERNAL_CAPABILITY_TOOL_IDS) {
    const meta = TOOL_CATALOG.find((t) => t.id === catalogToolId);
    if (!meta) continue;

    const domainEntry = UI_DOMAINS.find(
      (domain) => catalogToolIdForDomain(domain) === catalogToolId,
    );
    const enabled =
      enabledCatalogIds.has(catalogToolId) ||
      (domainEntry ? enabledSet.has(domainEntry) : false);

    const existing = nextTools.find((t) => t.toolId === catalogToolId);
    if (enabled) {
      const row: ToolAccess = {
        toolId: catalogToolId,
        name: meta.name,
        category: meta.category,
        status: "connected",
        permission: "write",
        lastUsedAt: existing?.lastUsedAt,
      };
      if (existing) {
        Object.assign(existing, row);
      } else {
        nextTools.push(row);
      }
    } else {
      const idx = nextTools.findIndex((t) => t.toolId === catalogToolId);
      if (idx >= 0) nextTools.splice(idx, 1);
    }
  }

  return { ...employee, tools: nextTools };
}

/** Persist capability toggles without touching non-internal tool grants. */
export async function syncEmployeeCapabilityGrants(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
  enabledDomains: CapabilityDomain[],
): Promise<void> {
  const { error: deleteError } = await client
    .from("employee_tools")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .in("tool_id", INTERNAL_CAPABILITY_TOOL_IDS);
  if (deleteError) throw deleteError;

  const enabledCatalogIds = [
    ...new Set(enabledDomains.map((domain) => catalogToolIdForDomain(domain))),
  ];
  if (!enabledCatalogIds.length) return;

  const rows = enabledCatalogIds.map((toolId) => ({
    workspace_id: workspaceId,
    employee_id: employeeId,
    tool_id: toolId,
    status: "connected",
    permission: "write",
    last_used_at: null,
  }));

  const { error: upsertError } = await client
    .from("employee_tools")
    .upsert(rows, { onConflict: "workspace_id,employee_id,tool_id" });
  if (upsertError) throw upsertError;
}