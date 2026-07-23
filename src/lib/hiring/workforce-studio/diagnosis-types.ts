// Business Operating Diagnosis — Maya's structured understanding of a company
// before she composes a workforce (PR-22A). Persisted on the company operating
// profile payload so it survives across sessions.

export type OperatingModel =
  | "service"
  | "commerce"
  | "software"
  | "marketplace"
  | "hospitality"
  | "professional_services"
  | "education"
  | "nonprofit"
  | "other";

export type BusinessWorkstream = {
  id: string;
  name: string;
  description: string;
  frequency: "daily" | "weekly" | "monthly" | "ad_hoc";
  ownerHint?: string;
};

export type ExistingHumanRole = {
  id: string;
  title: string;
  responsibilities: string[];
};

export type BusinessBottleneck = {
  id: string;
  area: string;
  description: string;
  severity: "low" | "medium" | "high";
};

export type BusinessRisk = {
  id: string;
  area: string;
  description: string;
  mitigationHint?: string;
};

export type BusinessPriority = {
  id: string;
  title: string;
  why: string;
};

export type DepartmentProposal = {
  id: string;
  name: string;
  purpose: string;
  suggestedRoleTitles: string[];
};

export type Assumption = {
  id: string;
  statement: string;
  impact: string;
};

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  whyItMatters: string;
  options: Array<{ id: string; label: string }>;
  allowFreeText?: boolean;
};

export type BusinessOperatingDiagnosis = {
  businessType: string;
  industry: string;
  operatingModel: OperatingModel;
  narrative: string;
  revenueMotion: string[];
  customerTypes: string[];
  productsAndServices: string[];
  operatingChannels: string[];
  recurringWork: BusinessWorkstream[];
  currentHumanRoles: ExistingHumanRole[];
  bottlenecks: BusinessBottleneck[];
  risks: BusinessRisk[];
  growthPriorities: BusinessPriority[];
  proposedDepartments: DepartmentProposal[];
  confidence: number;
  assumptions: Assumption[];
  clarificationQuestions: ClarificationQuestion[];
  /** Three short reasons Maya will cite on the team reveal. */
  designReasons: string[];
};

export type ClarificationAnswer = {
  questionId: string;
  optionId?: string;
  freeText?: string;
};

export type ArchitectComposeResult = {
  templateKey: string;
  intakeAnswers: Record<string, unknown>;
  teamName: string;
  designReasons: string[];
  expectedWeeklyWhLow: number;
  expectedWeeklyWhHigh: number;
};
