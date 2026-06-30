export type WorkflowCard = {
  id: string;
  label: string;
  description: string;
  roleKeys: string[];
};

export const WORKFLOW_CARDS: WorkflowCard[] = [
  {
    id: "find_customers",
    label: "Find customers",
    description: "Pipeline, outreach, and demand",
    roleKeys: ["sales_development_rep", "lead_generation_specialist", "marketing_manager"],
  },
  {
    id: "test_app",
    label: "Test my app",
    description: "QA, bugs, and quality",
    roleKeys: ["qa_test_engineer", "technical_support_agent"],
  },
  {
    id: "research_market",
    label: "Research a market",
    description: "Competitors, sizing, and trends",
    roleKeys: ["market_research_analyst", "business_analyst"],
  },
  {
    id: "write_content",
    label: "Write content",
    description: "Copy, social, and editorial",
    roleKeys: ["copywriter", "content_strategist", "social_media_manager"],
  },
  {
    id: "handle_support",
    label: "Handle support",
    description: "Tickets and customer help",
    roleKeys: ["customer_support_agent", "technical_support_agent"],
  },
  {
    id: "plan_product",
    label: "Plan product features",
    description: "Specs, roadmap, and delivery",
    roleKeys: ["product_manager", "business_analyst", "project_manager"],
  },
  {
    id: "analyze_data",
    label: "Analyze business data",
    description: "Metrics, models, and reports",
    roleKeys: ["data_analyst", "financial_analyst", "business_analyst"],
  },
  {
    id: "improve_operations",
    label: "Improve operations",
    description: "Process, admin, and automation",
    roleKeys: ["operations_assistant", "automation_specialist", "executive_assistant"],
  },
];

export const DISCOVERY_OUTCOME_CHIPS = [
  { id: "find_customers", label: "Find customers", value: "I want to find more customers" },
  { id: "product_quality", label: "Improve product quality", value: "I want to improve product quality" },
  { id: "save_admin_time", label: "Save admin time", value: "I want to save time on admin work" },
  { id: "research_market", label: "Research a market", value: "I want to research a market" },
] as const;

export const CUSTOMER_OUTCOME_CHIPS = [
  { label: "Find new leads", value: "I'm trying to find new leads" },
  { label: "Convert leads", value: "I'm trying to convert leads" },
  { label: "Retain customers", value: "I'm trying to retain existing customers" },
  { label: "Not sure", value: "Not sure — help me decide" },
];

export function roleKeysForDiscoveryOutcome(outcomeId: string): string[] {
  switch (outcomeId) {
    case "find_customers":
      return ["sales_development_rep", "lead_generation_specialist", "marketing_manager", "customer_success_manager"];
    case "product_quality":
      return ["qa_test_engineer", "technical_support_agent", "software_engineer"];
    case "save_admin_time":
      return ["operations_assistant", "executive_assistant", "automation_specialist", "bookkeeping_assistant"];
    case "research_market":
      return ["market_research_analyst", "business_analyst", "data_analyst"];
    default:
      return [];
  }
}

export function roleKeysForCustomerOutcome(answer: string): string[] {
  const lower = answer.toLowerCase();
  if (lower.includes("find") || lower.includes("lead")) {
    return ["sales_development_rep", "lead_generation_specialist", "marketing_manager"];
  }
  if (lower.includes("convert")) {
    return ["sales_development_rep", "marketing_manager", "copywriter"];
  }
  if (lower.includes("retain")) {
    return ["customer_success_manager", "customer_support_agent"];
  }
  return ["sales_development_rep", "marketing_manager", "customer_success_manager"];
}
