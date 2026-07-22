import type { AiEmployeeJobBrief } from "./types";
import type { RoleLibraryEntry } from "./role-library-types";
import { inferDepartmentId } from "./suggestion-chips";

/**
 * Broad phrasing categories for the "generic" recruiter questions (quality
 * preference, approval rules) that used to be one-size-fits-all and defaulted
 * to software/shipping language regardless of role. Library roles map from
 * their `departmentGroupId`; custom roles map from the inferred legacy
 * department id in `suggestion-chips.ts`.
 */
export type RoleQuestionCategory =
  | "engineering"
  | "research"
  | "sales"
  | "marketing"
  | "support"
  | "operations"
  | "finance"
  | "legal"
  | "hr"
  | "pr"
  | "product"
  | "design"
  | "gamedev"
  | "generic";

const DEPARTMENT_GROUP_TO_CATEGORY: Record<string, RoleQuestionCategory> = {
  engineering_technical: "engineering",
  sales_growth: "sales",
  research_strategy: "research",
  product_project: "product",
  marketing_content: "marketing",
  support_success: "support",
  operations_admin: "operations",
  finance_analytics: "finance",
  legal_risk_people: "legal",
  specialized: "generic",
};

const LEGACY_DEPARTMENT_TO_CATEGORY: Record<string, RoleQuestionCategory> = {
  pr: "pr",
  marketing: "marketing",
  sales: "sales",
  product: "product",
  design: "design",
  research: "research",
  support: "support",
  operations: "operations",
  finance: "finance",
  legal: "legal",
  hr: "hr",
  gamedev: "gamedev",
  engineering: "engineering",
};

/** Resolve the phrasing category for a role, preferring the library role's own grouping. */
export function resolveRoleQuestionCategory(
  role: RoleLibraryEntry | undefined,
  brief: AiEmployeeJobBrief,
): RoleQuestionCategory {
  if (role?.departmentGroupId) {
    return DEPARTMENT_GROUP_TO_CATEGORY[role.departmentGroupId] ?? "generic";
  }
  const legacyId = inferDepartmentId(brief);
  return LEGACY_DEPARTMENT_TO_CATEGORY[legacyId] ?? "generic";
}

const QUALITY_PREFERENCE_QUESTIONS: Record<RoleQuestionCategory, string> = {
  engineering: "Should they focus on moving fast, balanced output, or higher polish before shipping?",
  gamedev: "Should they focus on fast iteration, balanced polish, or high-fidelity ship-ready work?",
  research: "Should they focus on fast turnaround, balanced depth, or maximum rigor before sharing findings?",
  sales: "Should they focus on speed and volume, balanced quality, or highly tailored outreach?",
  marketing: "Should they focus on fast output, balanced quality, or highly polished on-brand work?",
  pr: "Should they focus on fast turnaround, balanced polish, or maximum polish before anything goes out publicly?",
  support: "Should they focus on fast response times, balanced thoroughness, or maximum care on every ticket?",
  finance: "Should they focus on speed, balanced accuracy, or maximum rigor and double-checking the numbers?",
  legal: "Should they focus on fast turnaround, balanced review, or maximum thoroughness before anything is signed off?",
  hr: "Should they focus on fast turnaround, balanced care, or maximum thoroughness with people matters?",
  operations: "Should they focus on speed, balanced consistency, or maximum process rigor?",
  product: "Should they focus on fast iteration, balanced polish, or highly refined ship-ready work?",
  design: "Should they focus on fast iteration, balanced polish, or high-fidelity pixel-perfect work?",
  generic: "Should they focus on moving fast, balanced output, or higher polish before finishing work?",
};

export function qualityPreferenceQuestion(category: RoleQuestionCategory): string {
  return QUALITY_PREFERENCE_QUESTIONS[category];
}

const APPROVAL_RULES_QUESTIONS: Record<RoleQuestionCategory, string> = {
  engineering: "Anything they should always run by you first — external messages, spend, publishing, that kind of thing?",
  gamedev: "Anything they should always run by you first — external messages, spend, shipping builds, that kind of thing?",
  research: "Anything they should always run by you first — publishing findings externally, citing sensitive sources, that kind of thing?",
  sales: "Anything they should always run by you first — discounts, contract terms, customer commitments, that kind of thing?",
  marketing: "Anything they should always run by you first — spend, anything going out publicly, brand messaging, that kind of thing?",
  pr: "Anything they should always run by you first — statements, media replies, anything going out publicly, that kind of thing?",
  support: "Anything they should always run by you first — refunds, escalations, policy exceptions, that kind of thing?",
  finance: "Anything they should always run by you first — spend, contracts, financial commitments, that kind of thing?",
  legal: "Anything they should always run by you first — signing anything, making commitments, external communication, that kind of thing?",
  hr: "Anything they should always run by you first — offers, terminations, sensitive people decisions, that kind of thing?",
  operations: "Anything they should always run by you first — vendor commitments, spend, process changes, that kind of thing?",
  product: "Anything they should always run by you first — scope changes, external messages, shipping decisions, that kind of thing?",
  design: "Anything they should always run by you first — scope changes, external messages, shipping decisions, that kind of thing?",
  generic: "Anything they should always run by you first — external messages, spend, commitments, that kind of thing?",
};

export function approvalRulesQuestion(category: RoleQuestionCategory): string {
  return APPROVAL_RULES_QUESTIONS[category];
}
