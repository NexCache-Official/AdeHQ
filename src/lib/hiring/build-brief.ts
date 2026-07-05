import { DEPARTMENT_CARDS } from "./data";
import {
  buildSynthesisInput,
  missionNeedsRefresh,
  synthesizeCoreResponsibilities,
  synthesizeMission,
  synthesizeSuccessMetrics,
} from "./brief-synthesis";
import { applyRoleFocusAnswer } from "./role-focus-answers";
import { synthesizeRoleTitle } from "./role-title-synthesizer";
import { getRoleByKey, legacyDepartmentIdForRole } from "./role-library";
import type { AiEmployeeJobBrief, RecruiterMessage } from "./types";

const DEPT_NAMES: Record<string, string> = {
  product: "Product",
  engineering: "Engineering",
  design: "Design",
  research: "Research",
  marketing: "Marketing",
  sales: "Sales",
  support: "Support",
  operations: "Operations",
  finance: "Finance",
  legal: "Legal",
  hr: "HR",
  pr: "PR & Communications",
  gamedev: "Game Development",
  custom: "Custom",
};

const DEPT_DOMAIN: Record<string, string> = {
  product: "Product & roadmap",
  engineering: "Software engineering",
  design: "Product design & UX",
  research: "Market & competitive research",
  marketing: "Marketing & growth",
  sales: "Sales & revenue",
  support: "Customer support",
  operations: "Business operations",
  finance: "Finance & accounting",
  legal: "Corporate legal & compliance",
  hr: "People & HR operations",
  pr: "PR & communications",
  gamedev: "Game development",
  custom: "General business",
};

type DeptBriefSeed = Pick<
  AiEmployeeJobBrief,
  | "mission"
  | "coreResponsibilities"
  | "businessFocus"
  | "successMetrics"
  | "approvalRules"
  | "toolsNeeded"
  | "personalityTraits"
>;

const DEPT_BRIEF_SEEDS: Record<string, DeptBriefSeed> = {
  legal: {
    mission:
      "Protect the business through careful contract review, compliance monitoring, and clear legal guidance — escalating material risk before anything is signed or published.",
    coreResponsibilities: [
      "Review and redline contracts, NDAs, and vendor agreements",
      "Flag compliance, regulatory, and reputational risks early",
      "Summarize legal implications in plain language for stakeholders",
      "Maintain a consistent approval workflow before external commitments",
      "Track open legal items and follow up on outstanding reviews",
    ],
    businessFocus: [
      "Contract lifecycle",
      "Regulatory compliance",
      "Vendor & partnership agreements",
      "IP and confidentiality",
    ],
    successMetrics: [
      "Contracts reviewed within agreed SLAs",
      "Material risks flagged before execution",
      "Fewer last-minute legal escalations",
      "Clear audit trail on approvals",
    ],
    approvalRules: [
      "Never sign or commit on behalf of the company without explicit approval",
      "Escalate litigation, regulatory, or crisis matters immediately",
      "Route all external legal communications for review",
    ],
    toolsNeeded: ["Contract repository", "Clause library", "Compliance checklist"],
    personalityTraits: ["careful", "precise", "risk-aware", "diplomatic"],
  },
  engineering: {
    mission:
      "Ship reliable software by turning technical goals into clear plans, high-quality implementation support, and measurable performance improvements.",
    coreResponsibilities: [
      "Break down technical problems into actionable tasks",
      "Review code paths, architecture tradeoffs, and performance bottlenecks",
      "Draft technical specs and implementation notes",
      "Coordinate with PM and design on feasibility and scope",
      "Document decisions and follow up on open engineering work",
    ],
    businessFocus: ["System reliability", "Developer velocity", "Technical debt"],
    successMetrics: [
      "Faster issue resolution",
      "Clearer technical documentation",
      "Measurable performance improvements",
      "Fewer regressions from rushed changes",
    ],
    approvalRules: [
      "Ask before production deployments or infra changes",
      "Flag security-sensitive changes for review",
    ],
    toolsNeeded: ["Issue tracker", "Repository access", "Monitoring dashboards"],
    personalityTraits: ["analytical", "practical", "detail-oriented"],
  },
  marketing: {
    mission:
      "Drive awareness and pipeline through sharp positioning, compelling copy, and coordinated launch execution.",
    coreResponsibilities: [
      "Draft campaign copy, landing pages, and launch messaging",
      "Turn product updates into distribution plans",
      "Maintain consistent brand voice across channels",
      "Coordinate with sales on proof points and nurture content",
    ],
    businessFocus: ["Brand positioning", "Content & campaigns", "Launch execution"],
    successMetrics: [
      "Higher-quality launch assets",
      "Consistent messaging across channels",
      "Faster turnaround on campaign drafts",
    ],
    approvalRules: ["Ask before publishing public statements or paid ads"],
    toolsNeeded: ["Brand guidelines", "Content calendar", "Analytics access"],
    personalityTraits: ["creative", "clear", "audience-aware"],
  },
  pr: {
    mission:
      "Build credibility through thoughtful media outreach, investor communications, and launch narratives.",
    coreResponsibilities: [
      "Draft press angles, media pitches, and stakeholder updates",
      "Prepare investor and executive communications",
      "Monitor narrative consistency across public touchpoints",
      "Coordinate launch announcements with internal teams",
    ],
    businessFocus: ["Media relations", "Investor comms", "Executive messaging"],
    successMetrics: [
      "Stronger press-ready narratives",
      "Timely investor update drafts",
      "Fewer messaging inconsistencies",
    ],
    approvalRules: [
      "Route all external press and investor messages for approval",
      "Escalate crisis or sensitive communications immediately",
    ],
    toolsNeeded: ["Press list", "Messaging doc", "Approval workflow"],
    personalityTraits: ["polished", "strategic", "credible"],
  },
};

function isDeptNameOnly(roleSeed: string, departmentId?: string | null): boolean {
  if (!departmentId || departmentId === "custom") return false;
  const name = DEPT_NAMES[departmentId]?.toLowerCase();
  return roleSeed.trim().toLowerCase() === name;
}

const DEPT_ROLE_TITLES: Record<string, string> = {
  product: "Product Manager",
  engineering: "Software Engineer",
  design: "Product Designer",
  research: "Research Analyst",
  marketing: "Marketing Specialist",
  sales: "Sales Development Rep",
  support: "Support Specialist",
  operations: "Operations Coordinator",
  finance: "Finance Analyst",
  legal: "Legal Review Specialist",
  hr: "People Operations Specialist",
  pr: "PR Manager",
  gamedev: "Game Developer",
  custom: "AI Employee",
};

export function emptyBrief(roleSeed = "", departmentId?: string | null): AiEmployeeJobBrief {
  const dept = departmentId ?? "custom";
  const roleTitle =
    roleSeed.trim() ||
    DEPT_ROLE_TITLES[dept] ||
    "AI Employee";
  return {
    roleTitle,
    department: DEPT_NAMES[dept] ?? "Custom",
    domain: "",
    mission: "",
    coreResponsibilities: [],
    technicalFocus: [],
    businessFocus: [],
    successMetrics: [],
    communicationStyle: "",
    personalityTraits: [],
    proactivityLevel: "balanced",
    qualityPreference: "balanced",
    seniorityLevel: "specialist",
    autonomyLevel: "balanced",
    approvalRules: [],
    toolsNeeded: [],
    assumptions: [],
    openQuestions: [],
  };
}

export function mergeBriefPartial(
  base: AiEmployeeJobBrief,
  partial: Partial<AiEmployeeJobBrief>,
): AiEmployeeJobBrief {
  return {
    ...base,
    ...partial,
    coreResponsibilities: partial.coreResponsibilities ?? base.coreResponsibilities,
    technicalFocus: partial.technicalFocus ?? base.technicalFocus,
    businessFocus: partial.businessFocus ?? base.businessFocus,
    successMetrics: partial.successMetrics ?? base.successMetrics,
    personalityTraits: partial.personalityTraits ?? base.personalityTraits,
    approvalRules: partial.approvalRules ?? base.approvalRules,
    toolsNeeded: partial.toolsNeeded ?? base.toolsNeeded,
    assumptions: partial.assumptions ?? base.assumptions,
    openQuestions: [],
  };
}

/** Seed brief from role library entry — discovery-first: no prefilled responsibilities until user answers. */
export function synthesizeBriefFromRole(
  roleKey: string,
  messages: RecruiterMessage[] = [],
  existing?: Partial<AiEmployeeJobBrief>,
): AiEmployeeJobBrief {
  const role = getRoleByKey(roleKey);
  if (!role) {
    return synthesizeBriefFromConversation(existing?.roleTitle ?? "", messages, "custom", existing);
  }

  const userLines = messages.filter((m) => m.role === "user").map((m) => m.text);
  const base = emptyBrief(role.title, role.legacyDepartmentId ?? "custom");

  const brief: AiEmployeeJobBrief = {
    ...base,
    roleTitle: existing?.roleTitle || role.seniorityVariants?.specialist || role.title,
    department: role.departmentLabel,
    domain: existing?.domain ?? "",
    mission: existing?.mission ?? "",
    coreResponsibilities: existing?.coreResponsibilities?.length ? existing.coreResponsibilities : [],
    technicalFocus: existing?.technicalFocus?.length ? existing.technicalFocus : [],
    businessFocus: existing?.businessFocus?.length ? existing.businessFocus : [],
    successMetrics: existing?.successMetrics?.length ? existing.successMetrics : [],
    toolsNeeded: existing?.toolsNeeded?.length ? existing.toolsNeeded : [],
    approvalRules: existing?.approvalRules?.length ? existing.approvalRules : [],
    assumptions: existing?.assumptions ?? [],
    openQuestions: [],
  };

  if (userLines.length > 0) {
    let enriched = synthesizeBriefFromConversation(
      role.title,
      messages,
      role.legacyDepartmentId ?? "custom",
      brief,
      roleKey,
    );
    for (const line of userLines) {
      const focus = applyRoleFocusAnswer(line, enriched, roleKey);
      if (focus) enriched = focus.brief;
    }
    return enriched;
  }
  return brief;
}

export function synthesizeBriefForHiringContext(input: {
  roleSeed: string;
  messages?: RecruiterMessage[];
  departmentId?: string | null;
  roleKey?: string | null;
  existing?: Partial<AiEmployeeJobBrief>;
}): AiEmployeeJobBrief {
  const messages = input.messages ?? [];
  if (input.roleKey && input.roleKey !== "custom") {
    return synthesizeBriefFromRole(input.roleKey, messages, input.existing);
  }
  const dept = input.roleKey === "custom" ? "custom" : (input.departmentId ?? legacyDepartmentIdForRole(input.roleKey) ?? "custom");
  return synthesizeBriefFromConversation(input.roleSeed, messages, dept, input.existing, input.roleKey);
}

function extractTechnicalTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const terms: string[] = [];
  const patterns = [
    "latency reduction",
    "bandwidth optimization",
    "performance optimization",
    "inference speed",
    "throughput",
    "enterprise ai",
    "media outreach",
    "investor relations",
    "crisis communications",
    "saas platform architecture",
    "product engineering",
    "data science workflows",
    "ai-enabled systems",
    "performance reliability",
  ];
  for (const p of patterns) {
    if (lower.includes(p)) terms.push(p.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Ai", "AI"));
  }
  return terms;
}

function inferRoleTitle(roleSeed: string, departmentId?: string | null): string {
  const dept = departmentId ?? "custom";
  return synthesizeRoleTitle({ roleInput: roleSeed, department: dept });
}

/** Semantic brief synthesis from conversation (fallback when AI unavailable). */
export function synthesizeBriefFromConversation(
  roleSeed: string,
  messages: RecruiterMessage[],
  departmentId?: string | null,
  existing?: Partial<AiEmployeeJobBrief>,
  roleKey?: string | null,
): AiEmployeeJobBrief {
  const dept = departmentId ?? "custom";
  const userLines = messages.filter((m) => m.role === "user").map((m) => m.text);
  const allUserText = userLines.join(" ").toLowerCase();
  const combined = [roleSeed, ...userLines].join(" ");
  const role = getRoleByKey(roleKey ?? undefined);

  const deptSeed = DEPT_BRIEF_SEEDS[dept];
  const useDeptSeed = deptSeed && (isDeptNameOnly(roleSeed, departmentId) || userLines.length === 0);

  const roleTitle =
    existing?.roleTitle ||
    (isDeptNameOnly(roleSeed, departmentId)
      ? DEPT_ROLE_TITLES[dept] ?? "AI Employee"
      : synthesizeRoleTitle({
          roleInput: combined,
          department: dept,
          technicalFocus: existing?.technicalFocus,
          businessFocus: existing?.businessFocus,
        }));

  const domain =
    existing?.domain ||
    (allUserText.includes("enterprise ai")
      ? "Enterprise AI systems"
      : allUserText.includes("saas") && allUserText.includes("data")
        ? "SaaS products, AI systems, and data workflows"
      : allUserText.includes("fintech") || allUserText.includes("finance")
        ? "Finance & fintech"
        : allUserText.includes("saas") || allUserText.includes("tech")
          ? "SaaS & technology"
          : isDeptNameOnly(roleSeed, departmentId) || !userLines[0]?.trim()
            ? DEPT_DOMAIN[dept] ?? "General business"
            : userLines[0]?.trim() || DEPT_DOMAIN[dept] || "General business");

  const technicalFocus =
    existing?.technicalFocus?.length
      ? existing.technicalFocus
      : role?.defaultTechnicalFocus?.length
        ? [...role.defaultTechnicalFocus]
        : extractTechnicalTerms(combined).length > 0
          ? extractTechnicalTerms(combined)
          : allUserText.includes("performance") || allUserText.includes("latency")
            ? ["Latency reduction", "Bandwidth optimization", "Performance debugging"]
            : [];

  const qualityPreference =
    existing?.qualityPreference ||
    (allUserText.includes("speed") ? "speed" : allUserText.includes("quality") ? "quality" : "balanced");

  const proactivityLevel =
    existing?.proactivityLevel ||
    (allUserText.includes("highly proactive")
      ? "high"
      : allUserText.includes("wait for direction")
        ? "low"
        : "balanced");

  const communicationStyle =
    existing?.communicationStyle ||
    (technicalFocus.length > 0
      ? "Technical, precise, implementation-focused"
      : "Professional, clear, stakeholder-appropriate");

  const synthesisInput = buildSynthesisInput(
    {
      roleTitle,
      department: existing?.department || DEPT_NAMES[dept] || role?.departmentLabel || "Custom",
      domain,
      businessFocus:
        existing?.businessFocus?.length
          ? existing.businessFocus
          : role?.defaultBusinessFocus?.length
            ? [...role.defaultBusinessFocus]
            : useDeptSeed && deptSeed
              ? deptSeed.businessFocus
              : [],
      technicalFocus,
      coreResponsibilities: existing?.coreResponsibilities ?? [],
    },
    userLines,
    role,
    useDeptSeed ? deptSeed : null,
  );

  const refreshDerivedSections = missionNeedsRefresh(existing?.mission, synthesisInput);

  const mission = refreshDerivedSections
    ? synthesizeMission(synthesisInput)
    : (existing?.mission ?? synthesizeMission(synthesisInput));

  const coreResponsibilities = refreshDerivedSections
    ? synthesizeCoreResponsibilities(synthesisInput)
    : existing?.coreResponsibilities?.length
      ? existing.coreResponsibilities
      : synthesizeCoreResponsibilities(synthesisInput);

  const successMetrics = refreshDerivedSections
    ? synthesizeSuccessMetrics(synthesisInput)
    : existing?.successMetrics?.length
      ? existing.successMetrics
      : synthesizeSuccessMetrics(synthesisInput);

  const seniorityLevel =
    existing?.seniorityLevel ||
    (allUserText.includes("director") || allUserText.includes("strategic")
      ? "director"
      : allUserText.includes("manager")
        ? "manager"
        : "specialist");

  const assumptions =
    existing?.assumptions ??
    [
      `This role is currently inferred as a ${roleTitle}.`,
      ...(synthesisInput.businessFocus.length > 0 || synthesisInput.technicalFocus.length > 0
        ? ["Focus areas are inferred from what the user has shared so far."]
        : []),
    ];

  return {
    roleTitle,
    department: existing?.department || DEPT_NAMES[dept] || "Custom",
    domain,
    mission,
    coreResponsibilities,
    technicalFocus,
    businessFocus: synthesisInput.businessFocus,
    successMetrics,
    communicationStyle,
    personalityTraits:
      existing?.personalityTraits ??
      (role?.defaultResponsibilities?.length
        ? ["professional", "clear", "practical"]
        : useDeptSeed && deptSeed
          ? deptSeed.personalityTraits
          : ["professional", "clear"]),
    proactivityLevel,
    qualityPreference,
    seniorityLevel,
    autonomyLevel: existing?.autonomyLevel ?? "balanced",
    approvalRules:
      existing?.approvalRules?.length
        ? existing.approvalRules
        : role?.defaultApprovalRules?.length
          ? [...role.defaultApprovalRules]
          : useDeptSeed && deptSeed
            ? deptSeed.approvalRules
            : [
                "Ask before sending external emails or messages",
                "Ask before publishing public statements",
                "Flag legal, compliance, or reputational risks",
              ],
    toolsNeeded: existing?.toolsNeeded?.length
      ? existing.toolsNeeded
      : role?.defaultTools?.length
        ? [...role.defaultTools]
        : useDeptSeed && deptSeed
          ? deptSeed.toolsNeeded
          : [],
    assumptions,
    openQuestions: [],
  };
}

export function briefToInstructions(brief: AiEmployeeJobBrief): string {
  return [
    `Role: ${brief.roleTitle}`,
    `Department: ${brief.department}`,
    `Domain: ${brief.domain}`,
    `Mission: ${brief.mission}`,
    `Seniority: ${brief.seniorityLevel}`,
    `Autonomy: ${brief.autonomyLevel}`,
    "",
    "Core responsibilities:",
    ...brief.coreResponsibilities.map((r) => `- ${r}`),
    ...(brief.technicalFocus.length
      ? ["", "Technical focus:", ...brief.technicalFocus.map((t) => `- ${t}`)]
      : []),
    ...(brief.businessFocus.length
      ? ["", "Business focus:", ...brief.businessFocus.map((t) => `- ${t}`)]
      : []),
    "",
    `Communication style: ${brief.communicationStyle}`,
    `Proactivity: ${brief.proactivityLevel}`,
    `Quality preference: ${brief.qualityPreference}`,
    "",
    "Approval rules:",
    ...brief.approvalRules.map((r) => `- ${r}`),
    "",
    "Success metrics:",
    ...brief.successMetrics.map((r) => `- ${r}`),
    ...(brief.assumptions.length
      ? ["", "Assumptions:", ...brief.assumptions.map((r) => `- ${r}`)]
      : []),
  ].join("\n");
}

export function departmentLabel(departmentId: string | null): string {
  if (!departmentId) return "Custom";
  return DEPARTMENT_CARDS.find((d) => d.id === departmentId)?.name ?? "Custom";
}

export function welcomeMessage(
  employeeName: string,
  title: string,
  userFirstName: string,
  brief: AiEmployeeJobBrief,
): string {
  const focus =
    brief.technicalFocus.slice(0, 2).join(", ") ||
    brief.coreResponsibilities[0]?.toLowerCase() ||
    brief.domain.toLowerCase();
  return `Hi ${userFirstName} — I'm ${employeeName}, your ${title}. I'll help with ${focus}. I'm ready whenever you want to start.`;
}
