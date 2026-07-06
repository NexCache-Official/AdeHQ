// ===========================================================================
// Prefab toolsets — Maya's suggested capability bundles per role at hire.
// Suggestions, not hard limits: users can toggle any capability on/off per
// employee after hiring (workforce settings, Phase 3 UI).
// ===========================================================================

import type { EmployeeRoleKey } from "@/lib/types";
import type { CapabilityDomain } from "@/lib/integrations/types";
import { catalogToolIdForDomain } from "./capabilities";

/** Suggested capability domains per employee role. */
export const PREFAB_TOOLSETS: Record<EmployeeRoleKey, CapabilityDomain[]> = {
  sales: ["crm", "email", "tasks", "drive", "artifact"],
  marketing: ["email", "tasks", "drive", "artifact"],
  pm: ["tasks", "drive", "artifact"],
  research: ["tasks", "drive", "artifact"],
  operations: ["crm", "tasks", "drive", "artifact"],
  support: ["crm", "email", "tasks"],
  engineering: ["tasks", "drive"],
  design: ["tasks", "drive"],
  gamedev: ["tasks", "drive"],
  // Maya manages hiring — no business tools by default.
  recruiting_manager: [],
};

export function suggestedCapabilityDomains(roleKey: EmployeeRoleKey): CapabilityDomain[] {
  return PREFAB_TOOLSETS[roleKey] ?? ["tasks"];
}

/** Catalog tool ids (public.tools) suggested for a role — deduped. */
export function suggestedCapabilityToolIds(roleKey: EmployeeRoleKey): string[] {
  return [...new Set(suggestedCapabilityDomains(roleKey).map(catalogToolIdForDomain))];
}
