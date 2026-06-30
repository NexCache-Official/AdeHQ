import { DEPARTMENT_CARDS } from "./data";
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
  };
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
  ];
  for (const p of patterns) {
    if (lower.includes(p)) terms.push(p.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Ai", "AI"));
  }
  return terms;
}

function inferRoleTitle(roleSeed: string, departmentId?: string | null): string {
  const seed = roleSeed.toLowerCase();
  const dept = departmentId ?? "custom";
  if (seed.includes("performance") && seed.includes("engineer")) return "AI Performance Engineer";
  if (seed.includes("pr") || seed.includes("communications")) return "PR Manager";
  if (seed.includes("engineer")) return DEPT_ROLE_TITLES.engineering;
  if (roleSeed.trim()) {
    const words = roleSeed.trim().split(/\s+/);
    if (words.length <= 6) return roleSeed.trim();
    return words.slice(0, 4).join(" ");
  }
  return DEPT_ROLE_TITLES[dept] ?? "AI Employee";
}

/** Semantic brief synthesis from conversation (fallback when AI unavailable). */
export function synthesizeBriefFromConversation(
  roleSeed: string,
  messages: RecruiterMessage[],
  departmentId?: string | null,
  existing?: Partial<AiEmployeeJobBrief>,
): AiEmployeeJobBrief {
  const dept = departmentId ?? "custom";
  const userLines = messages.filter((m) => m.role === "user").map((m) => m.text);
  const allUserText = userLines.join(" ").toLowerCase();
  const combined = [roleSeed, ...userLines].join(" ");

  const roleTitle = existing?.roleTitle || inferRoleTitle(roleSeed, departmentId);
  const domain =
    existing?.domain ||
    (allUserText.includes("enterprise ai")
      ? "Enterprise AI systems"
      : allUserText.includes("fintech") || allUserText.includes("finance")
        ? "Finance & fintech"
        : allUserText.includes("saas") || allUserText.includes("tech")
          ? "SaaS & technology"
          : userLines[0]?.trim() || roleSeed.trim() || "General business");

  const technicalFocus =
    existing?.technicalFocus?.length
      ? existing.technicalFocus
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

  const mission =
    existing?.mission ||
    (technicalFocus.length > 0
      ? `Improve latency, bandwidth efficiency, and runtime performance for ${domain.toLowerCase()} workloads.`
      : `Help the team succeed as a ${roleTitle.toLowerCase()} in ${domain.toLowerCase()}.`);

  const coreResponsibilities =
    existing?.coreResponsibilities?.length
      ? existing.coreResponsibilities
      : technicalFocus.length > 0
        ? [
            "Identify bottlenecks in AI system performance",
            "Suggest bandwidth optimization strategies",
            "Help evaluate infrastructure tradeoffs",
            "Turn performance discussions into technical tasks",
          ]
        : [
            `Own day-to-day ${roleTitle.toLowerCase()} workstreams`,
            "Turn discussions into clear next steps and follow-ups",
            "Flag risks and ask for approval before external actions",
          ];

  const successMetrics =
    existing?.successMetrics?.length
      ? existing.successMetrics
      : technicalFocus.length > 0
        ? [
            "Lower response latency",
            "Better throughput",
            "Reduced bandwidth overhead",
            "Clearer performance roadmap",
          ]
        : [
            "Consistent high-quality output",
            "Follow-ups do not get missed",
            "Communication matches agreed standards",
          ];

  const seniorityLevel =
    existing?.seniorityLevel ||
    (allUserText.includes("director") || allUserText.includes("strategic")
      ? "director"
      : allUserText.includes("manager")
        ? "manager"
        : "specialist");

  return {
    roleTitle,
    department: existing?.department || DEPT_NAMES[dept] || "Custom",
    domain,
    mission,
    coreResponsibilities,
    technicalFocus,
    businessFocus: existing?.businessFocus ?? [],
    successMetrics,
    communicationStyle,
    personalityTraits:
      existing?.personalityTraits ??
      (technicalFocus.length > 0 ? ["analytical", "precise", "practical"] : ["professional", "clear"]),
    proactivityLevel,
    qualityPreference,
    seniorityLevel,
    autonomyLevel: existing?.autonomyLevel ?? "balanced",
    approvalRules:
      existing?.approvalRules?.length
        ? existing.approvalRules
        : [
            "Ask before sending external emails or messages",
            "Ask before publishing public statements",
            "Flag legal, compliance, or reputational risks",
          ],
    toolsNeeded: existing?.toolsNeeded ?? [],
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
