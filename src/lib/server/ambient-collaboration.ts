import type { AIEmployee, AiParticipationMode, ResponseReason } from "@/lib/types";
import { isSmartAssistMode } from "@/lib/topics";

export type RoleDomain =
  | "research"
  | "sales"
  | "marketing"
  | "product"
  | "engineering"
  | "design";

const HELP_REQUEST_PATTERNS = [
  /\bneed (some )?help\b/i,
  /\bcan (someone|anyone) help\b/i,
  /\bi need your help\b/i,
  /\bi need you guys'? help\b/i,
  /\bi need y'?all'?s? help\b/i,
  /\bi don'?t know how to\b/i,
  /\bdon'?t know how to\b/i,
  /\bnot sure how to\b/i,
  /\bhelp me figure out\b/i,
  /\bhow do we approach\b/i,
  /\bwhat should we do\b/i,
  /\bcan we work on\b/i,
  /\blet'?s figure out\b/i,
];

const TEAM_ADDRESS_PATTERNS = [
  /\beveryone\b/i,
  /\bteam\b/i,
  /\bguys\b/i,
  /\byou guys\b/i,
  /\by'?all\b/i,
  /\byall\b/i,
  /\banyone\b/i,
  /\bwe\b/i,
  /\bus\b/i,
  /\bour\b/i,
];

const DOMAIN_KEYWORDS: Record<RoleDomain, string[]> = {
  research: [
    "research",
    "market",
    "industry",
    "competitor",
    "landscape",
    "trend",
    "trends",
    "analysis",
    "analyze",
    "booming",
    "market size",
    "segment",
    "customers",
    "target audience",
  ],
  sales: [
    "sales",
    "sell",
    "outreach",
    "lead",
    "leads",
    "prospect",
    "prospects",
    "pitch",
    "client",
    "clients",
    "customer",
    "customers",
    "pipeline",
    "qualification",
    "revenue",
    "deal",
  ],
  marketing: [
    "launch",
    "campaign",
    "ads",
    "positioning",
    "brand",
    "copy",
    "content",
    "distribution",
    "go-to-market",
    "gtm",
  ],
  product: [
    "product",
    "feature",
    "roadmap",
    "planning",
    "requirements",
    "user",
    "onboarding",
    "problem",
    "solution",
  ],
  engineering: [
    "build",
    "code",
    "bug",
    "api",
    "database",
    "deploy",
    "technical",
    "architecture",
    "implementation",
  ],
  design: ["ui", "ux", "design", "layout", "screen", "flow", "visual", "confusing"],
};

const DOMAIN_TO_ROLE_KEYS: Record<RoleDomain, string[]> = {
  research: ["research"],
  sales: ["sales"],
  marketing: ["marketing"],
  product: ["pm", "operations"],
  engineering: ["engineering", "gamedev"],
  design: ["design"],
};

export function isHelpRequest(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return HELP_REQUEST_PATTERNS.some((p) => p.test(text));
}

export function isTeamAddressed(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return TEAM_ADDRESS_PATTERNS.some((p) => p.test(text));
}

export function detectRoleDomains(content: string): { domain: RoleDomain; score: number }[] {
  const text = content.toLowerCase();
  const scored: { domain: RoleDomain; score: number }[] = [];

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [RoleDomain, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += kw.includes(" ") ? 2 : 1;
    }
    if (score > 0) scored.push({ domain, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

function employeeMatchesDomain(employee: AIEmployee, domain: RoleDomain): boolean {
  const keys = DOMAIN_TO_ROLE_KEYS[domain];
  if (keys.includes(employee.roleKey)) return true;
  const hay = `${employee.name} ${employee.role}`.toLowerCase();
  return keys.some((k) => hay.includes(k)) || hay.includes(domain);
}

export function matchEmployeeForDomain(
  employees: AIEmployee[],
  domain: RoleDomain,
  excludeIds: Set<string> = new Set(),
): AIEmployee | undefined {
  const candidates = employees.filter((e) => !excludeIds.has(e.id) && employeeMatchesDomain(e, domain));
  if (!candidates.length) return undefined;
  return candidates[0];
}

export type AmbientPlanResult =
  | {
      kind: "collaboration";
      lead: AIEmployee;
      collaborators: AIEmployee[];
      detectedDomains: RoleDomain[];
      helpRequest: boolean;
      teamAddressed: boolean;
      leadReason: ResponseReason;
    }
  | {
      kind: "single";
      employee: AIEmployee;
      detectedDomains: RoleDomain[];
      helpRequest: boolean;
      teamAddressed: boolean;
      reason: ResponseReason;
    }
  | null;

export function planAmbientCollaboration(
  content: string,
  employees: AIEmployee[],
  participation: AiParticipationMode,
): AmbientPlanResult {
  if (!isSmartAssistMode(participation) && participation !== "active_team") {
    return null;
  }

  const helpRequest = isHelpRequest(content);
  const teamAddressed = isTeamAddressed(content);
  const domains = detectRoleDomains(content);

  if (!helpRequest && domains.length === 0) {
    return null;
  }

  if (helpRequest && domains.length === 0) {
    return null;
  }

  const maxTotal = participation === "active_team" ? 2 : 2;
  const used = new Set<string>();

  if (domains.length >= 2 || (helpRequest && domains.length >= 1 && teamAddressed)) {
    const primaryDomain = domains[0]?.domain;
    const secondaryDomain = domains[1]?.domain;
    if (!primaryDomain) return null;

    const lead = matchEmployeeForDomain(employees, primaryDomain, used);
    if (!lead) return null;
    used.add(lead.id);

    const collaborators: AIEmployee[] = [];
    if (secondaryDomain) {
      const collab = matchEmployeeForDomain(employees, secondaryDomain, used);
      if (collab) {
        collaborators.push(collab);
        used.add(collab.id);
      }
    }

    if (collaborators.length > 0) {
      return {
        kind: "collaboration",
        lead,
        collaborators: collaborators.slice(0, maxTotal - 1),
        detectedDomains: domains.map((d) => d.domain),
        helpRequest,
        teamAddressed,
        leadReason: "ambient_collaboration_lead",
      };
    }
  }

  const topDomain = domains[0]?.domain;
  if (!topDomain) return null;

  const employee = matchEmployeeForDomain(employees, topDomain);
  if (!employee) return null;

  return {
    kind: "single",
    employee,
    detectedDomains: domains.map((d) => d.domain),
    helpRequest,
    teamAddressed,
    reason: helpRequest ? "ambient_help_request" : "ambient_role_match",
  };
}

export type AmbientOrchestratorDebug = {
  conversationMode?: string;
  helpRequest: boolean;
  teamAddressed: boolean;
  detectedDomains: RoleDomain[];
  lead?: string;
  collaborators?: string[];
  skippedReason?: string;
};
