import type { HiringAnswers, JobBrief } from "./types";

export function emptyBrief(roleSeed = ""): JobBrief {
  const roleTitle = roleSeed.trim() || "AI Employee";
  return {
    title: roleTitle,
    roleTitle,
    industry: "",
    focus: "",
    tone: "",
    proactivity: "",
    priority: "",
    startLocation: "",
    mission: "",
    responsibilities: [],
    industryContext: "",
    workingStyle: "",
    communicationStyle: "",
    approvalRules: [],
    successCriteria: [],
  };
}

export function mergeAnswers(brief: JobBrief, answers: HiringAnswers): JobBrief {
  return {
    ...brief,
    industry: answers.industry ?? brief.industry,
    focus: answers.focus ?? brief.focus,
    tone: answers.tone ?? brief.tone,
    proactivity: answers.proactivity ?? brief.proactivity,
    priority: answers.priority ?? brief.priority,
    startLocation: answers.startLocation ?? brief.startLocation,
    roleTitle: answers.roleTitle ?? brief.roleTitle,
    title: answers.roleTitle ?? brief.title,
  };
}

export function buildBriefFromRoleSeed(
  roleSeed: string,
  answers: HiringAnswers,
  departmentId?: string | null,
): JobBrief {
  const base = emptyBrief(roleSeed);
  const merged = mergeAnswers(base, answers);
  const dept = departmentId ?? "custom";

  const deptTitles: Record<string, string> = {
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
    custom: roleSeed.trim() || "AI Employee",
  };

  const roleTitle =
    merged.roleTitle ||
    (roleSeed.trim() ? roleSeed.trim() : deptTitles[dept] ?? "AI Employee");

  const industry = merged.industry || "General business";
  const focus = merged.focus || "Day-to-day work aligned to the role";
  const tone = merged.tone || "Professional and clear";
  const proactivity = merged.proactivity || "Balanced";
  const priority = merged.priority || "Balanced";
  const startLocation = merged.startLocation || "Workspace general channel";

  return {
    title: `${roleTitle}${industry ? ` — ${industry}` : ""}`,
    roleTitle,
    industry,
    focus,
    tone,
    proactivity,
    priority,
    startLocation,
    mission:
      merged.mission ||
      `Help the team succeed as a ${roleTitle.toLowerCase()}, with a focus on ${focus.toLowerCase()}.`,
    responsibilities:
      merged.responsibilities.length > 0
        ? merged.responsibilities
        : [
            `Own ${focus.toLowerCase()} workstreams.`,
            "Turn discussions into clear next steps and follow-ups.",
            "Communicate in a way that matches team expectations.",
            "Flag risks and ask for approval before external actions.",
          ],
    industryContext:
      merged.industryContext ||
      `${industry} context, stakeholder expectations, and relevant business norms.`,
    workingStyle:
      merged.workingStyle ||
      `${tone}, ${proactivity.toLowerCase()}, prioritizing ${priority.toLowerCase()}.`,
    communicationStyle:
      merged.communicationStyle ||
      `Clear, credible, and appropriate for ${industry.toLowerCase()} stakeholders.`,
    approvalRules:
      merged.approvalRules.length > 0
        ? merged.approvalRules
        : [
            "Ask before sending external emails.",
            "Ask before publishing public statements.",
            "Flag legal, compliance, or reputational risks.",
          ],
    successCriteria:
      merged.successCriteria.length > 0
        ? merged.successCriteria
        : [
            "Consistent, high-quality output on core responsibilities.",
            "Follow-ups and tasks do not get missed.",
            "Communication matches the agreed tone and standards.",
          ],
  };
}

export function briefToInstructions(brief: JobBrief): string {
  return [
    `Role: ${brief.roleTitle}`,
    `Mission: ${brief.mission}`,
    "",
    "Core responsibilities:",
    ...brief.responsibilities.map((r) => `- ${r}`),
    "",
    `Industry context: ${brief.industryContext}`,
    `Working style: ${brief.workingStyle}`,
    `Communication style: ${brief.communicationStyle}`,
    "",
    "Approval rules:",
    ...brief.approvalRules.map((r) => `- ${r}`),
    "",
    "Success criteria:",
    ...brief.successCriteria.map((r) => `- ${r}`),
  ].join("\n");
}
