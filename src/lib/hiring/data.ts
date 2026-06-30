import type { DemoApplicant } from "./types";

export const HIRE_EXAMPLES = [
  "get my startup press coverage",
  "help me write investor updates",
  "build product specs from messy ideas",
  "qualify sales leads and draft outreach",
  "debug my app and plan engineering tasks",
  "research competitors every week",
];

export const DEPARTMENT_CARDS = [
  { id: "product", name: "Product", mono: "Pr", desc: "Specs, roadmaps, PRDs" },
  { id: "engineering", name: "Engineering", mono: "En", desc: "Build, debug, plan tasks" },
  { id: "design", name: "Design", mono: "De", desc: "UX flows, critique, specs" },
  { id: "research", name: "Research", mono: "Rs", desc: "Market & competitor scans" },
  { id: "marketing", name: "Marketing", mono: "Mk", desc: "Campaigns, content, copy" },
  { id: "sales", name: "Sales", mono: "Sa", desc: "Qualify leads, outreach" },
  { id: "support", name: "Support", mono: "Su", desc: "Tickets, replies, docs" },
  { id: "operations", name: "Operations", mono: "Op", desc: "Process & coordination" },
  { id: "finance", name: "Finance", mono: "Fi", desc: "Models, reports, analysis" },
  { id: "legal", name: "Legal", mono: "Lg", desc: "Review, risk, redlines" },
  { id: "hr", name: "HR", mono: "Hr", desc: "Hiring, policy, people ops" },
  { id: "pr", name: "PR & Communications", mono: "PR", desc: "Press, investors, launches" },
  { id: "gamedev", name: "Game Development", mono: "Gd", desc: "Design, systems, content" },
  { id: "custom", name: "Custom Role", mono: "+", desc: "Define your own brief" },
] as const;

export const GEN_STEPS = [
  "Reading job brief",
  "Matching role requirements",
  "Comparing model strengths",
  "Estimating weekly AI Work Hours",
  "Designing employee personalities",
  "Preparing applicants",
];

export const MATCH_BARS = [
  { label: "Role fit", w: 92 },
  { label: "Writing strength", w: 84 },
  { label: "Reasoning strength", w: 78 },
  { label: "Cost efficiency", w: 70 },
  { label: "Capacity", w: 88 },
  { label: "Personality match", w: 80 },
];

export const DEMO_APPLICANTS: DemoApplicant[] = [
  {
    id: "nova",
    name: "Nova Reed",
    first: "Nova",
    title: "Fast Outreach Specialist",
    badge: "High capacity",
    badgeKind: "neutral",
    tags: ["energetic", "practical", "quick to draft"],
    engine: "Efficient Intelligence",
    advModel: "SiliconFlow · Balanced mode",
    hours: 120,
    cap: 0.96,
    quality: 1,
    qualityText: "Standard",
    speed: 3,
    speedText: "Fast",
    cost: 1,
    costText: "Low",
    strengths: [
      "High-volume outreach drafts",
      "Fast follow-ups",
      "Simple campaign ideas",
      "Quick first drafts",
    ],
    weaknesses: ["Less strategic depth", "Needs review for senior stakeholders"],
    bestFor: "Fast sales and PR execution",
    grad: "linear-gradient(135deg,#fbbf24,#f97316 55%,#ef4444)",
    recommended: false,
  },
  {
    id: "eleanor",
    name: "Eleanor Price",
    first: "Eleanor",
    title: "Finance PR Manager",
    badge: "Recommended",
    badgeKind: "rec",
    tags: ["polished", "concise", "credible", "strategic"],
    engine: "Balanced Intelligence",
    advModel: "SiliconFlow · DeepSeek-V4-Flash",
    hours: 80,
    cap: 0.66,
    quality: 2,
    qualityText: "High",
    speed: 2,
    speedText: "Standard",
    cost: 2,
    costText: "Medium",
    strengths: [
      "Investor-facing communication",
      "Media outreach",
      "Professional stakeholder messaging",
      "Balanced quality and capacity",
    ],
    weaknesses: [
      "Not the deepest compliance reviewer",
      "May escalate complex crisis messaging",
    ],
    bestFor: "Day-to-day finance PR & investor comms",
    grad: "linear-gradient(135deg,#6366f1,#3b82f6 55%,#8b5cf6)",
    recommended: true,
  },
  {
    id: "marcus",
    name: "Marcus Vale",
    first: "Marcus",
    title: "Strategic Communications Director",
    badge: "Premium quality",
    badgeKind: "neutral",
    tags: ["analytical", "senior", "careful", "strategic"],
    engine: "Strong Intelligence",
    advModel: "SiliconFlow · Strong mode",
    hours: 30,
    cap: 0.27,
    quality: 3,
    qualityText: "Premium",
    speed: 1,
    speedText: "Slower",
    cost: 3,
    costText: "High",
    strengths: [
      "Complex stakeholder messaging",
      "Crisis communications",
      "Executive-level strategy",
      "High-risk communication review",
    ],
    weaknesses: ["Lower weekly capacity", "Higher cost intensity"],
    bestFor: "Important investor, executive or crisis comms",
    grad: "linear-gradient(135deg,#64748b,#7c3aed 65%,#1e293b)",
    recommended: false,
  },
];

export const INTERVIEW_QUESTIONS = [
  { id: "week", label: "What would your first week look like?" },
  { id: "email", label: "Draft a sample outreach email" },
  { id: "investor", label: "How would you handle investor comms?" },
  { id: "sales", label: "How would you work with my Sales Employee?" },
  { id: "access", label: "What would you need access to?" },
];

export const INTERVIEW_ANSWERS: Record<string, Record<string, string>> = {
  eleanor: {
    week: "I'd start by reviewing your current investor messaging, identifying your strongest proof points, and drafting a reusable outreach framework. By the end of the week I'd aim to have a press angle, an investor-update template, and a follow-up sequence ready for your review.",
    email:
      "Subject: A quick update on our momentum\n\nHi [Name] — I wanted to share two milestones from this quarter that I think you'll find relevant... I'd flag this for your approval before it goes out, and tailor the proof points to each investor.",
    investor:
      "Carefully and consistently. I'd keep a single source of truth for our narrative, match tone to each stakeholder's seniority, and always route anything material past you before it's sent.",
    sales:
      "Closely. I'd reuse the proof points your Sales Employee surfaces in outreach, and feed back which media angles and messages land so the two motions reinforce each other.",
    access:
      "Your messaging docs, recent investor updates, the Marketing Room, and the Investor Relations topic to start. I'll ask before connecting anything that sends externally.",
  },
  nova: {
    week: "I'd get moving fast — by day two you'd have a batch of outreach drafts and a follow-up cadence you can react to. I prefer to ship a rough first version quickly and tighten from there.",
    email:
      "Subject: Worth a look?\n\nHey [Name], quick one — we just shipped something I think fits what you cover. Happy to send a 2-line summary or the full release, your call.",
    investor:
      "I can draft the updates quickly and keep the cadence regular — though for the most senior or sensitive investor messaging I'd flag it for a closer review.",
    sales:
      "Great fit — I'm built for volume, so I can turn your Sales Employee's leads into outreach drafts and follow-ups at speed.",
    access:
      "Outreach lists, templates, and the Sales Room. Keep me pointed at execution and I'll keep the pipeline of drafts full.",
  },
  marcus: {
    week: "I'd spend week one understanding the full stakeholder map, risk areas, and the narrative you want to protect. I move deliberately — the first deliverable would be a strategic comms plan rather than volume.",
    email:
      "I'd draft this with precision and route it for approval. Subject: Re: [Topic] — a considered update. Every claim would be defensible and compliance-aware.",
    investor:
      "This is where I'm strongest. I handle complex, high-stakes, and crisis messaging carefully — anticipating questions, managing risk, and protecting credibility at the executive level.",
    sales:
      "I'd act as the senior reviewer — your Sales Employee and Nova move fast, and I make sure the most important messages are airtight before they reach key stakeholders.",
    access:
      "Executive context, legal/compliance guidelines, and the sensitive investor topics. I'd want approval gates on anything public-facing.",
  },
};

export const SUCCESS_LABELS = [
  "Employee profile created",
  "Job brief saved",
  "DM created",
  "Assigned to workspace room",
  "Welcome message ready",
  "Approval rules enabled",
];

export const ONBOARDING_ROOM_KEY = "adehq-onboarding-room";
