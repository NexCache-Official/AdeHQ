export type WorkforceOutcomeId =
  | "launch_product"
  | "research_market"
  | "grow_sales"
  | "build_software"
  | "manage_clients"
  | "run_operations";

export type WorkforceOutcome = {
  id: WorkforceOutcomeId;
  title: string;
  description: string;
};

export const WORKFORCE_OUTCOMES: WorkforceOutcome[] = [
  { id: "launch_product", title: "Launch a product", description: "Ship something new with PM, research, and GTM support" },
  { id: "research_market", title: "Research a market", description: "Understand competitors, customers, and opportunities" },
  { id: "grow_sales", title: "Grow sales", description: "Pipeline, outreach, and revenue motion" },
  { id: "build_software", title: "Build software", description: "Engineering, QA, and product delivery" },
  { id: "manage_clients", title: "Manage clients", description: "Account work, delivery, and client communication" },
  { id: "run_operations", title: "Run operations", description: "Processes, coordination, and execution" },
];

export type WorkstreamPreset = {
  id: string;
  name: string;
  accent: string;
  topics: string[];
  suggestedHires: string[];
};

const PRESETS: Record<WorkforceOutcomeId, WorkstreamPreset[]> = {
  launch_product: [
    { id: "launch", name: "Launch Room", accent: "#e85d2c", topics: ["Product planning", "Market research", "Launch tasks"], suggestedHires: ["Product Manager", "Market Research Analyst", "Sales Development Representative"] },
    { id: "product", name: "Product Planning", accent: "#8b5cf6", topics: ["Roadmap", "PRDs", "Prioritization"], suggestedHires: ["Product Manager", "UX Designer"] },
    { id: "research", name: "Market Research", accent: "#14b8a6", topics: ["Competitors", "Customer insights", "Positioning"], suggestedHires: ["Market Research Analyst", "Competitive Intelligence Analyst"] },
    { id: "sales", name: "Sales Outreach", accent: "#22c55e", topics: ["Outbound", "Pipeline", "Follow-ups"], suggestedHires: ["Sales Development Representative", "Account Executive"] },
  ],
  build_software: [
    { id: "engineering", name: "Engineering", accent: "#6366f1", topics: ["Feature delivery", "Bug fixes", "Technical planning"], suggestedHires: ["Software Engineer", "Full-Stack Developer"] },
    { id: "product", name: "Product Planning", accent: "#8b5cf6", topics: ["Specs", "Backlog", "Sprint planning"], suggestedHires: ["Product Manager", "Technical Program Manager"] },
    { id: "qa", name: "QA & Testing", accent: "#0ea5e9", topics: ["Test plans", "Bug triage", "Release checks"], suggestedHires: ["QA Test Engineer", "Software Engineer"] },
    { id: "devops", name: "DevOps", accent: "#64748b", topics: ["Deployments", "Reliability", "Infrastructure"], suggestedHires: ["DevOps Engineer", "Software Engineer"] },
  ],
  research_market: [
    { id: "research", name: "Market Research", accent: "#14b8a6", topics: ["Landscape scans", "Trend reports", "Customer segments"], suggestedHires: ["Market Research Analyst", "Competitive Intelligence Analyst"] },
    { id: "competitors", name: "Competitor Intelligence", accent: "#f97316", topics: ["Competitor tracking", "Feature comparisons", "Pricing"], suggestedHires: ["Competitive Intelligence Analyst", "Research Analyst"] },
    { id: "strategy", name: "Product Strategy", accent: "#8b5cf6", topics: ["Positioning", "Opportunity sizing", "Roadmap input"], suggestedHires: ["Product Manager", "Market Research Analyst"] },
  ],
  grow_sales: [
    { id: "outbound", name: "Sales Outreach", accent: "#22c55e", topics: ["Prospecting", "Sequences", "Follow-ups"], suggestedHires: ["Sales Development Representative", "Account Executive"] },
    { id: "pipeline", name: "Pipeline", accent: "#eab308", topics: ["Qualification", "Deals", "Forecasting"], suggestedHires: ["Account Executive", "Sales Operations Analyst"] },
    { id: "enablement", name: "Sales Enablement", accent: "#ec4899", topics: ["Decks", "Battlecards", "Messaging"], suggestedHires: ["Marketing Specialist", "Sales Development Representative"] },
  ],
  manage_clients: [
    { id: "accounts", name: "Client Accounts", accent: "#22c55e", topics: ["Account plans", "QBRs", "Renewals"], suggestedHires: ["Account Manager", "Customer Success Manager"] },
    { id: "delivery", name: "Client Delivery", accent: "#6366f1", topics: ["Project updates", "Scope", "Handoffs"], suggestedHires: ["Project Manager", "Operations Coordinator"] },
    { id: "support", name: "Client Support", accent: "#64748b", topics: ["Tickets", "Escalations", "Documentation"], suggestedHires: ["Customer Support Specialist", "Technical Support Agent"] },
  ],
  run_operations: [
    { id: "ops", name: "Operations", accent: "#eab308", topics: ["Processes", "Reporting", "Coordination"], suggestedHires: ["Operations Coordinator", "Executive Assistant"] },
    { id: "programs", name: "Program Management", accent: "#8b5cf6", topics: ["Cross-team work", "Timelines", "Status"], suggestedHires: ["Project Manager", "Operations Coordinator"] },
    { id: "admin", name: "Admin & Finance", accent: "#14b8a6", topics: ["Budgets", "Vendors", "Reporting"], suggestedHires: ["Finance Analyst", "Operations Coordinator"] },
  ],
};

export function workstreamPresetsForOutcome(outcomeId: WorkforceOutcomeId): WorkstreamPreset[] {
  return PRESETS[outcomeId] ?? PRESETS.run_operations;
}

export function defaultWorkstreamForOutcome(outcomeId: WorkforceOutcomeId): WorkstreamPreset {
  return workstreamPresetsForOutcome(outcomeId)[0];
}
