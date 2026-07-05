import type { RoleLibraryEntry } from "./role-library-types";
import type { AiEmployeeJobBrief } from "./types";
import { shouldSkipBriefMutationForMessage } from "./recruiter-intents";

export type BriefSynthesisInput = {
  roleTitle: string;
  department: string;
  domain: string;
  businessFocus: string[];
  technicalFocus: string[];
  coreResponsibilities: string[];
  userLines: string[];
  role?: RoleLibraryEntry | null;
  deptSeed?: Pick<
    AiEmployeeJobBrief,
    "mission" | "coreResponsibilities" | "successMetrics"
  > | null;
};

const STALE_MISSION_PATTERNS = [
  /improve latency, bandwidth efficiency/i,
  /runtime performance for .+ workloads/i,
];

function focusPhrases(input: BriefSynthesisInput): string[] {
  return [...input.businessFocus, ...input.technicalFocus].filter(Boolean);
}

function performanceFocus(input: BriefSynthesisInput): boolean {
  const blob = `${focusPhrases(input).join(" ")} ${input.userLines.join(" ")}`.toLowerCase();
  return /\b(latency|bandwidth|throughput|performance|infra|infrastructure|sre|devops)\b/.test(blob);
}

/** True when an existing mission no longer reflects what the user has shared. */
export function missionNeedsRefresh(mission: string | undefined, input: BriefSynthesisInput): boolean {
  if (!mission?.trim()) return true;
  if (STALE_MISSION_PATTERNS.some((pattern) => pattern.test(mission)) && !performanceFocus(input)) {
    return true;
  }
  return false;
}

function substantiveUserLines(userLines: string[]): string[] {
  return userLines.filter((line) => {
    const trimmed = line.trim();
    if (shouldSkipBriefMutationForMessage(trimmed)) return false;
    return trimmed.length > 8 && !/^(yes|no|ok|okay|sure|thanks|great|perfect)$/i.test(trimmed);
  });
}

export function synthesizeMission(input: BriefSynthesisInput): string {
  const role = input.roleTitle.trim() || "AI employee";
  const domain = input.domain.trim() || "the business";
  const focuses = focusPhrases(input);

  if (focuses.length > 0) {
    const primary = focuses.slice(0, 2).join(" and ");
    return `Help the team succeed as a ${role.toLowerCase()} focused on ${primary.toLowerCase()} — turning priorities into clear work and reliable delivery in ${domain.toLowerCase()}.`;
  }

  if (input.role?.defaultResponsibilities?.length) {
    const anchor = input.role.defaultResponsibilities[0]
      .replace(/^Own /i, "")
      .replace(/\.$/, "")
      .trim();
    return `Support ${domain.toLowerCase()} as a ${role.toLowerCase()} — ${anchor.charAt(0).toLowerCase()}${anchor.slice(1)}.`;
  }

  if (input.deptSeed?.mission?.trim()) {
    return input.deptSeed.mission;
  }

  const userContext = substantiveUserLines(input.userLines);
  if (userContext.length > 0) {
    const latest = userContext.slice(-2).join("; ").replace(/\.$/, "");
    return `Help as a ${role.toLowerCase()} in ${domain.toLowerCase()} — aligned with: ${latest}.`;
  }

  return `Help the team succeed as a ${role.toLowerCase()} in ${domain.toLowerCase()}.`;
}

export function synthesizeCoreResponsibilities(input: BriefSynthesisInput): string[] {
  if (input.coreResponsibilities.length >= 2) {
    return input.coreResponsibilities;
  }

  if (input.role?.defaultResponsibilities?.length) {
    return [...input.role.defaultResponsibilities];
  }

  const focuses = focusPhrases(input);
  if (focuses.length > 0) {
    return [
      `Own ${focuses[0].toLowerCase()} workstreams`,
      "Turn discussions into clear next steps and follow-ups",
      "Flag risks and ask for approval before external actions",
      ...(focuses[1]
        ? [`Support ${focuses[1].toLowerCase()} priorities as the team needs`]
        : []),
    ];
  }

  if (input.deptSeed?.coreResponsibilities?.length) {
    return [...input.deptSeed.coreResponsibilities];
  }

  const role = input.roleTitle.trim() || "AI employee";
  return [
    `Own day-to-day ${role.toLowerCase()} workstreams`,
    "Turn discussions into clear next steps and follow-ups",
    "Flag risks and ask for approval before external actions",
  ];
}

export function synthesizeSuccessMetrics(input: BriefSynthesisInput): string[] {
  if (input.role?.defaultSuccessMetrics?.length) {
    return [...input.role.defaultSuccessMetrics];
  }

  if (input.deptSeed?.successMetrics?.length) {
    return [...input.deptSeed.successMetrics];
  }

  const focuses = focusPhrases(input);
  if (focuses.length > 0) {
    return [
      "Priorities move from discussion to done work faster",
      "Output quality stays consistent with agreed standards",
      "Risks and blockers are surfaced early",
      "Follow-ups do not get missed",
    ];
  }

  return [
    "Consistent high-quality output",
    "Follow-ups do not get missed",
    "Communication matches agreed standards",
  ];
}

export function buildSynthesisInput(
  brief: Pick<
    AiEmployeeJobBrief,
    | "roleTitle"
    | "department"
    | "domain"
    | "businessFocus"
    | "technicalFocus"
    | "coreResponsibilities"
  >,
  userLines: string[],
  role?: RoleLibraryEntry | null,
  deptSeed?: BriefSynthesisInput["deptSeed"],
): BriefSynthesisInput {
  return {
    roleTitle: brief.roleTitle,
    department: brief.department,
    domain: brief.domain,
    businessFocus: brief.businessFocus,
    technicalFocus: brief.technicalFocus,
    coreResponsibilities: brief.coreResponsibilities,
    userLines,
    role,
    deptSeed,
  };
}
