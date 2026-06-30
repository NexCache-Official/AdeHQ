import type { ModelMode } from "@/lib/ai/model-catalog";
import type { EmployeeRoleKey } from "@/lib/types";

export type DepartmentGroupId =
  | "engineering_technical"
  | "product_project"
  | "sales_growth"
  | "marketing_content"
  | "research_strategy"
  | "operations_admin"
  | "finance_analytics"
  | "support_success"
  | "legal_risk_people"
  | "specialized";

export type RolePersona = {
  title: string;
  strengths: string[];
  bestFor: string;
  whyRecommended?: string;
};

export type RoleLibraryEntry = {
  roleKey: string;
  title: string;
  departmentGroupId: DepartmentGroupId;
  departmentLabel: string;
  description: string;
  commonUseCases: string[];
  defaultResponsibilities: string[];
  defaultSuccessMetrics: string[];
  defaultBusinessFocus?: string[];
  defaultTechnicalFocus?: string[];
  defaultTools: string[];
  defaultApprovalRules: string[];
  defaultModelMode: ModelMode;
  employeeRoleKey: EmployeeRoleKey;
  seniorityVariants?: {
    assistant?: string;
    specialist?: string;
    manager?: string;
    director?: string;
    advisor?: string;
  };
  candidatePersonas: {
    high_capacity: RolePersona;
    recommended: RolePersona;
    premium: RolePersona;
  };
  questionTemplates: {
    coreWork: string;
    coreWorkChips: string[];
    focus?: string;
    focusChips?: string[];
    seniorityChips?: string[];
    toolsChips?: string[];
  };
  searchAliases: string[];
  popular?: boolean;
  specialized?: boolean;
  legacyDepartmentId?: string;
};

export type DepartmentGroup = {
  id: DepartmentGroupId;
  label: string;
  description: string;
  browseDefault: boolean;
};

export type InferenceConfidence = "high" | "medium" | "low";

export type RoleInferenceResult = {
  confidence: InferenceConfidence;
  matches: Array<{ roleKey: string; score: number; title: string }>;
  matchType: "known" | "near_match" | "custom";
  customSuggestion?: string;
  nearMatchAlternatives?: string[];
};

export type CandidateCapacityProfile = {
  weeklyAiWorkHours: number;
  costIntensity: "low" | "medium" | "high";
  modelMode: ModelMode;
  planGated?: boolean;
  recommendedForPlan?: ("free" | "pro" | "team")[];
};
