// ===========================================================================
// Capability domains — map tool domains to the internal AdeHQ catalog tools
// used for per-employee grants (tools + employee_tools tables).
// ===========================================================================

import type { CapabilityDomain } from "@/lib/integrations/types";

export type CapabilityDomainInfo = {
  domain: CapabilityDomain;
  label: string;
  description: string;
  /** Catalog tool id (public.tools) that gates this domain per employee. */
  catalogToolId: string;
};

export const CAPABILITY_DOMAINS: Record<CapabilityDomain, CapabilityDomainInfo> = {
  crm: {
    domain: "crm",
    label: "CRM",
    description: "Contacts, companies, deals, and pipeline inside AdeHQ.",
    catalogToolId: "adehq-crm",
  },
  email: {
    domain: "email",
    label: "Email / Inbox",
    description:
      "Draft and send via the workspace Inbox with human approval; list and read recent threads.",
    catalogToolId: "adehq-email",
  },
  tasks: {
    domain: "tasks",
    label: "Tasks",
    description: "Create and manage follow-up tasks inside AdeHQ.",
    catalogToolId: "adehq-tasks",
  },
  drive: {
    domain: "drive",
    label: "Drive",
    description: "Save generated files and artifacts to workspace Drive.",
    catalogToolId: "adehq-drive",
  },
  // Registered now for extensibility; tools ship in later phases.
  artifact: {
    domain: "artifact",
    label: "Artifacts",
    description: "Generate spreadsheets, PDF reports, and exports to Drive.",
    catalogToolId: "adehq-drive",
  },
  social: {
    domain: "social",
    label: "Social",
    description: "Draft campaigns and social posts inside AdeHQ.",
    catalogToolId: "adehq-calendar",
  },
  calendar: {
    domain: "calendar",
    label: "Content Calendar",
    description: "Schedule and manage content posts and campaigns.",
    catalogToolId: "adehq-calendar",
  },
  investor: {
    domain: "investor",
    label: "Investors",
    description: "Investor firms, contacts, and fundraising pipeline.",
    catalogToolId: "adehq-investors",
  },
  team: {
    domain: "team",
    label: "Teamwork",
    description: "Delegate to and coordinate with other AI employees across shared rooms.",
    catalogToolId: "adehq-team",
  },
  research: {
    domain: "research",
    label: "Web Research",
    description:
      "Live web search (Exa → AI Gateway → Tavily) to find current facts, competitors, pricing, and cite sources.",
    // Read-only web research travels with the workspace's knowledge/Drive access,
    // so it reuses the adehq-drive catalog grant rather than a new gated tool —
    // every Drive-enabled role gets it, and the executor still self-heals grants.
    catalogToolId: "adehq-drive",
  },
};

export function capabilityDomainForTool(toolName: string): CapabilityDomain | null {
  const prefix = toolName.split(".")[0] as CapabilityDomain;
  return prefix && prefix in CAPABILITY_DOMAINS ? prefix : null;
}

export function catalogToolIdForDomain(domain: CapabilityDomain): string {
  return CAPABILITY_DOMAINS[domain].catalogToolId;
}

/** All internal AdeHQ capability catalog tool ids. */
export const INTERNAL_CAPABILITY_TOOL_IDS = [
  ...new Set(Object.values(CAPABILITY_DOMAINS).map((c) => c.catalogToolId)),
];
