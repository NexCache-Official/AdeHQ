import { DEPARTMENT_CARDS } from "./data";
import { getRoleByKey } from "./role-library";
import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterMissingField,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "./types";

const NOT_SURE = "Not sure — help me decide";

const MISSING_PRIORITY: RecruiterMissingField[] = [
  "role_title",
  "domain",
  "core_work",
  "technical_focus",
  "business_focus",
  "quality_preference",
  "seniority",
  "autonomy",
  "communication_style",
  "tools",
  "approval_rules",
];

const CORE_WORK_BY_DEPT: Record<string, string[]> = {
  pr: [
    "Drafting press releases",
    "Media pitching and inquiries",
    "Internal newsletters and comms",
    "Crisis and reputation management",
    NOT_SURE,
  ],
  marketing: [
    "Blog posts and content",
    "Campaign planning and copy",
    "Social media and launches",
    "SEO and growth content",
    NOT_SURE,
  ],
  sales: [
    "Qualify inbound leads",
    "Outbound outreach and follow-ups",
    "Proposal and deck drafting",
    "CRM updates and pipeline hygiene",
    NOT_SURE,
  ],
  product: [
    "PRDs and product specs",
    "Roadmap planning",
    "User research synthesis",
    "Backlog grooming and prioritization",
    NOT_SURE,
  ],
  engineering: [
    "Frontend product engineering",
    "Backend systems",
    "AI infrastructure and performance",
    "Data and ML workflows",
    NOT_SURE,
  ],
  design: [
    "UX flows and wireframes",
    "Design critique and feedback",
    "UI specs for engineering",
    "User research summaries",
    NOT_SURE,
  ],
  research: [
    "Competitor monitoring",
    "Market and trend reports",
    "Customer interview synthesis",
    "Weekly research briefs",
    NOT_SURE,
  ],
  support: [
    "Ticket triage and replies",
    "Help center documentation",
    "Escalation summaries",
    "Customer follow-ups",
    NOT_SURE,
  ],
  operations: [
    "Process documentation",
    "Cross-team coordination",
    "Vendor and project tracking",
    "Operational reporting",
    NOT_SURE,
  ],
  finance: [
    "Financial models and forecasts",
    "Budget tracking",
    "Board and investor reporting",
    "Expense and variance analysis",
    NOT_SURE,
  ],
  legal: [
    "Contract review and redlines",
    "Compliance monitoring",
    "Risk summaries for stakeholders",
    "Policy drafting support",
    NOT_SURE,
  ],
  hr: [
    "Job descriptions and hiring support",
    "Policy and handbook updates",
    "Employee communications",
    "Onboarding coordination",
    NOT_SURE,
  ],
  gamedev: [
    "Game design documentation",
    "Systems and mechanics planning",
    "Content pipelines",
    "Playtest feedback synthesis",
    NOT_SURE,
  ],
  custom: [
    "Strategy and planning",
    "Execution and follow-ups",
    "Research and analysis",
    "Stakeholder communication",
    NOT_SURE,
  ],
};

const BUSINESS_FOCUS_BY_DEPT: Record<string, string[]> = {
  pr: ["Brand reputation", "Press coverage", "Crisis readiness", "Stakeholder trust", NOT_SURE],
  marketing: ["Pipeline growth", "Brand awareness", "Content velocity", "Campaign ROI", NOT_SURE],
  sales: ["Qualified pipeline", "Win rate", "Faster follow-ups", "Revenue targets", NOT_SURE],
  product: ["Roadmap clarity", "User outcomes", "Ship velocity", "Discovery insights", NOT_SURE],
  engineering: ["Reliability", "Performance", "Developer velocity", "Technical debt reduction", NOT_SURE],
  design: ["Usability", "Design consistency", "Research-backed decisions", "Faster iteration", NOT_SURE],
  research: ["Market clarity", "Competitive intelligence", "Decision support", "Trend awareness", NOT_SURE],
  support: ["Response time", "Customer satisfaction", "Deflection via docs", "Escalation quality", NOT_SURE],
  operations: ["Process efficiency", "Cross-team alignment", "Execution visibility", "Risk reduction", NOT_SURE],
  finance: ["Forecast accuracy", "Cash visibility", "Reporting speed", "Cost control", NOT_SURE],
  legal: ["Risk reduction", "Contract turnaround", "Compliance coverage", "Audit readiness", NOT_SURE],
  hr: ["Hiring quality", "Employee experience", "Policy consistency", "People ops efficiency", NOT_SURE],
  gamedev: ["Player experience", "Content throughput", "Design coherence", "Live ops support", NOT_SURE],
  custom: ["Revenue growth", "Operational efficiency", "Customer satisfaction", "Team productivity", NOT_SURE],
};

const DOMAIN_BY_DEPT: Record<string, string[]> = {
  pr: ["Consumer brand", "B2B SaaS", "Startup launch", "Enterprise reputation", NOT_SURE],
  marketing: ["B2B SaaS", "Consumer app", "Developer tools", "E-commerce", NOT_SURE],
  sales: ["SMB outbound", "Enterprise deals", "PLG conversion", "Partner sales", NOT_SURE],
  product: ["B2B SaaS", "Mobile app", "AI product", "Marketplace", NOT_SURE],
  engineering: ["Web app", "AI platform", "Developer tools", "Mobile product", NOT_SURE],
  design: ["B2B SaaS", "Consumer mobile", "Design system", "Early-stage product", NOT_SURE],
  research: ["Competitive landscape", "New market entry", "Product category", "Customer segments", NOT_SURE],
  support: ["SaaS customers", "Technical product", "High-touch accounts", "Self-serve users", NOT_SURE],
  operations: ["Remote team", "Go-to-market ops", "Program management", "Vendor ecosystem", NOT_SURE],
  finance: ["Startup runway", "SaaS metrics", "Fundraising prep", "Department budgets", NOT_SURE],
  legal: ["SaaS contracts", "Vendor agreements", "Employment law", "IP and privacy", NOT_SURE],
  hr: ["Scaling hiring", "Remote culture", "Policy compliance", "Performance programs", NOT_SURE],
  gamedev: ["Mobile games", "PC/console", "Live service", "Indie prototype", NOT_SURE],
  custom: ["Our core product", "A new initiative", "An internal team", "External customers", NOT_SURE],
};

const TOOLS_BY_DEPT: Record<string, string[]> = {
  pr: ["Meltwater or media monitoring", "Press release workflow", "Shared comms docs", NOT_SURE],
  marketing: ["CMS and analytics", "Email marketing platform", "Social scheduling tools", NOT_SURE],
  sales: ["CRM (HubSpot/Salesforce)", "Outreach sequences", "Call notes and decks", NOT_SURE],
  product: ["Notion or Confluence", "Figma", "Issue tracker", NOT_SURE],
  engineering: ["GitHub and issue tracker", "CI/CD and observability", "Docs and runbooks", NOT_SURE],
  design: ["Figma", "Design system library", "User research repository", NOT_SURE],
  research: ["Competitive intel tools", "Spreadsheets and docs", "Survey and interview notes", NOT_SURE],
  support: ["Zendesk or Intercom", "Help center CMS", "Macros and snippets", NOT_SURE],
  operations: ["Project tracker", "Shared ops docs", "Calendar and vendor tools", NOT_SURE],
  finance: ["Spreadsheets and models", "Accounting system", "Board reporting templates", NOT_SURE],
  legal: ["Contract repository", "Clause library", "Compliance checklist", NOT_SURE],
  hr: ["ATS and HRIS", "Policy docs", "Employee handbook", NOT_SURE],
  gamedev: ["Game design wiki", "Issue tracker", "Build and asset pipelines", NOT_SURE],
  custom: ["Docs and knowledge base", "Issue tracker", "Team chat", NOT_SURE],
};

const APPROVAL_BY_DEPT: Record<string, string[]> = {
  pr: [
    "Ask before external press statements",
    "Escalate crisis communications",
    "Review investor-facing comms first",
  ],
  marketing: [
    "Ask before publishing campaigns",
    "Review brand-sensitive copy",
    "Escalate spend commitments",
  ],
  sales: [
    "Ask before discounting or custom terms",
    "Review enterprise proposals",
    "Escalate legal or security questions",
  ],
  engineering: [
    "Ask before production changes",
    "Escalate security-sensitive work",
    "Review infra spend changes",
  ],
  custom: [
    "Ask before external actions",
    "Escalate high-risk decisions",
    "Review customer-facing output first",
  ],
};

const TECHNICAL_FOCUS = [
  "Frontend product engineering",
  "Backend systems",
  "AI infrastructure",
  "Data science workflows",
  NOT_SURE,
];

const SENIORITY_CHIPS = [
  "Hands-on specialist",
  "Senior advisor",
  "Autonomous manager",
  "Balanced",
];

const COMMUNICATION_CHIPS = [
  "Concise and direct",
  "Warm and collaborative",
  "Formal and polished",
  "Async-first updates",
];

const QUALITY_CHIPS = [
  "Prioritize speed",
  "Balanced quality and speed",
  "Prioritize quality",
];

const READY_CHIPS: Array<[string, string, RecruiterSuggestionChip["intent"]?]> = [
  ["Review job brief", "Review job brief", "review_brief"],
  ["Refine responsibilities", "Refine responsibilities", "refine_more"],
  ["Add tools", "Add tools", "add_tools"],
  ["Make it more senior", "Make it more senior"],
  ["Make it more hands-on", "Make it more hands-on"],
];

function pushChip(
  chips: RecruiterSuggestionChip[],
  label: string,
  value: string,
  intent: RecruiterSuggestionChip["intent"] = "answer_question",
) {
  chips.push({
    id: `${intent}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label,
    value,
    intent,
  });
}

function chipsFromLabels(
  labels: string[],
  intent: RecruiterSuggestionChip["intent"] = "answer_question",
  max = 5,
): RecruiterSuggestionChip[] {
  const chips: RecruiterSuggestionChip[] = [];
  for (const label of labels.slice(0, max)) {
    pushChip(chips, label, label, intent);
  }
  return chips;
}

export function inferDepartmentId(brief: AiEmployeeJobBrief): string {
  const byName = DEPARTMENT_CARDS.find((d) => d.name.toLowerCase() === brief.department.toLowerCase());
  if (byName && byName.id !== "custom") return byName.id;

  const haystack = `${brief.roleTitle} ${brief.domain} ${brief.department}`.toLowerCase();
  if (/\b(pr|press|media|communications?)\b/.test(haystack)) return "pr";
  if (/\b(marketing|content|campaign|seo)\b/.test(haystack)) return "marketing";
  if (/\b(sales|outreach|pipeline|crm)\b/.test(haystack)) return "sales";
  if (/\b(product|roadmap|prd)\b/.test(haystack)) return "product";
  if (/\b(design|ux|ui|wireframe)\b/.test(haystack)) return "design";
  if (/\b(research|competitor|market)\b/.test(haystack)) return "research";
  if (/\b(support|ticket|customer success)\b/.test(haystack)) return "support";
  if (/\b(operations|ops|coordination)\b/.test(haystack)) return "operations";
  if (/\b(finance|accounting|budget)\b/.test(haystack)) return "finance";
  if (/\b(legal|contract|compliance)\b/.test(haystack)) return "legal";
  if (/\b(hr|hiring|people ops)\b/.test(haystack)) return "hr";
  if (/\b(game|gamedev|player)\b/.test(haystack)) return "gamedev";
  if (/\b(engineer|software|backend|frontend|devops|sre)\b/.test(haystack)) return "engineering";
  return "custom";
}

export function isEngineeringBrief(brief: AiEmployeeJobBrief): boolean {
  const deptId = inferDepartmentId(brief);
  if (deptId === "engineering") return true;
  const title = brief.roleTitle.toLowerCase();
  return /\b(software engineer|backend engineer|frontend engineer|full[- ]?stack|devops|sre|platform engineer)\b/.test(
    title,
  );
}

export function primaryMissingField(missing: RecruiterMissingField[]): RecruiterMissingField | null {
  for (const field of MISSING_PRIORITY) {
    if (missing.includes(field)) return field;
  }
  return null;
}

/** Pull example answers from Ade's last question when she lists options inline. */
export function extractExamplesFromRecruiterMessage(text: string): string[] {
  const lower = text.toLowerCase();
  let segment = "";

  for (const marker of ["for example", "such as", "e.g.", "like "]) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      segment = text.slice(idx + marker.length);
      break;
    }
  }

  if (!segment.trim()) return [];

  segment = segment.split("?")[0].split("\n")[0];
  segment = segment.replace(/^(will it focus on|should it|could it|would it)\s+/i, "");
  segment = segment.replace(/\s+or something else.*$/i, "");
  segment = segment.replace(/\s+just give me.*$/i, "");

  const parts = segment
    .split(/,\s*/)
    .flatMap((part) => part.split(/\s+or\s+/i))
    .map((part) =>
      part
        .trim()
        .replace(/^(will it focus on|should it|could it|would it)\s+/i, "")
        .replace(/^on\s+/i, "")
        .replace(/^to\s+/i, ""),
    )
    .filter((part) => part.length > 4 && part.length < 80)
    .filter((part) => !/something else|not sure|help me decide/i.test(part));

  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

export function generateSuggestionChips(
  readiness: RecruiterReadiness,
  currentBrief: AiEmployeeJobBrief,
  conversation: RecruiterMessage[] = [],
  roleKey?: string | null,
): RecruiterSuggestionChip[] {
  if (readiness.ready) {
    const chips: RecruiterSuggestionChip[] = [];
    for (const [label, value, intent] of READY_CHIPS) {
      pushChip(chips, label, value, intent ?? "answer_question");
    }
    return chips;
  }

  const role = getRoleByKey(roleKey ?? undefined);
  const deptId = inferDepartmentId(currentBrief);
  const primary = primaryMissingField(readiness.missing);
  const lastAde = [...conversation].reverse().find((m) => m.role === "ade")?.text ?? "";
  const fromQuestion = extractExamplesFromRecruiterMessage(lastAde);

  if (
    fromQuestion.length >= 2 &&
    primary &&
    ["core_work", "business_focus", "domain", "tools", "approval_rules"].includes(primary)
  ) {
    const chips = chipsFromLabels(fromQuestion, "answer_question", 4);
    pushChip(chips, NOT_SURE, NOT_SURE);
    return chips;
  }

  if (role && primary === "core_work" && role.questionTemplates.coreWorkChips.length > 0) {
    return chipsFromLabels(role.questionTemplates.coreWorkChips);
  }
  if (role && primary === "business_focus" && role.questionTemplates.focusChips?.length) {
    return chipsFromLabels(role.questionTemplates.focusChips);
  }
  if (role?.questionTemplates.toolsChips?.length && primary === "tools") {
    return chipsFromLabels(role.questionTemplates.toolsChips, "add_tools");
  }

  switch (primary) {
    case "role_title":
      return chipsFromLabels(
        deptId === "custom"
          ? ["Specialist assistant", "Team coordinator", "Senior advisor", "Execution-focused operator", NOT_SURE]
          : [
              `${DEPARTMENT_CARDS.find((d) => d.id === deptId)?.name ?? "Team"} specialist`,
              `Senior ${DEPARTMENT_CARDS.find((d) => d.id === deptId)?.name ?? "team"} lead`,
              "Hands-on operator",
              "Strategic advisor",
              NOT_SURE,
            ],
      );

    case "domain":
      return chipsFromLabels(DOMAIN_BY_DEPT[deptId] ?? DOMAIN_BY_DEPT.custom);

    case "core_work":
      if (isEngineeringBrief(currentBrief)) {
        return chipsFromLabels(CORE_WORK_BY_DEPT.engineering);
      }
      return chipsFromLabels(CORE_WORK_BY_DEPT[deptId] ?? CORE_WORK_BY_DEPT.custom);

    case "technical_focus":
      return isEngineeringBrief(currentBrief)
        ? chipsFromLabels(TECHNICAL_FOCUS)
        : chipsFromLabels(BUSINESS_FOCUS_BY_DEPT[deptId] ?? BUSINESS_FOCUS_BY_DEPT.custom);

    case "business_focus":
      return chipsFromLabels(BUSINESS_FOCUS_BY_DEPT[deptId] ?? BUSINESS_FOCUS_BY_DEPT.custom);

    case "quality_preference":
      return chipsFromLabels(QUALITY_CHIPS);

    case "seniority":
    case "autonomy":
      return chipsFromLabels(SENIORITY_CHIPS);

    case "communication_style":
      return chipsFromLabels(COMMUNICATION_CHIPS);

    case "tools": {
      const chips = chipsFromLabels(TOOLS_BY_DEPT[deptId] ?? TOOLS_BY_DEPT.custom, "add_tools", 3);
      pushChip(chips, NOT_SURE, NOT_SURE, "add_tools");
      return chips;
    }

    case "approval_rules": {
      const labels = APPROVAL_BY_DEPT[deptId] ?? APPROVAL_BY_DEPT.custom;
      return chipsFromLabels(labels, "add_approval_rules");
    }

    default: {
      const chips: RecruiterSuggestionChip[] = [];
      pushChip(chips, "Draft brief now", "Draft brief now", "draft_brief_now");
      pushChip(chips, "Add personality", "Add personality", "add_personality");
      pushChip(chips, "Add tools", "Add tools", "add_tools");
      return chips;
    }
  }
}
