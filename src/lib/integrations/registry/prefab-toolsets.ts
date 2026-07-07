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
  // Every working employee can coordinate/delegate across shared rooms ("team").
  sales: ["crm", "email", "tasks", "drive", "artifact", "team"],
  marketing: ["social", "calendar", "email", "tasks", "drive", "artifact", "team"],
  fundraising: ["investor", "email", "tasks", "drive", "artifact", "team"],
  pm: ["tasks", "drive", "artifact", "team"],
  research: ["tasks", "drive", "artifact", "team"],
  operations: ["crm", "tasks", "drive", "artifact", "team"],
  support: ["crm", "email", "tasks", "team"],
  engineering: ["tasks", "drive", "team"],
  design: ["tasks", "drive", "team"],
  gamedev: ["tasks", "drive", "team"],
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
