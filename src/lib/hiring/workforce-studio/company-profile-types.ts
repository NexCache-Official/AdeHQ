// Company Operating Profile — persistent, versioned company context Maya
// reads before composing a team. Kept separate from any one blueprint so it
// survives across many team-building sessions.

import type { BusinessOperatingDiagnosis } from "./diagnosis-types";

export type CompanyOperatingProfile = {
  workspaceId: string;
  revision: number;
  companyName: string;
  industry: string;
  businessModel: string;
  stage: "idea" | "pre_launch" | "early_revenue" | "growth" | "scale";
  headcountHumans: number;
  primaryOutcomes: string[];
  existingDepartments: string[];
  riskTolerance: "conservative" | "balanced" | "aggressive";
  complianceNotes: string;
  workingHoursNote: string;
  /** Free-text business description from the Architect entry. */
  businessDescription: string;
  /** Optional website URL used as diagnosis context. */
  websiteUrl: string;
  /** Latest structured diagnosis from Maya Business Architect (PR-22A). */
  diagnosis: BusinessOperatingDiagnosis | null;
  updatedBy: string | null;
  updatedAt: string;
};

export const EMPTY_COMPANY_PROFILE: Omit<
  CompanyOperatingProfile,
  "workspaceId" | "updatedAt" | "updatedBy"
> = {
  revision: 0,
  companyName: "",
  industry: "",
  businessModel: "",
  stage: "early_revenue",
  headcountHumans: 1,
  primaryOutcomes: [],
  existingDepartments: [],
  riskTolerance: "balanced",
  complianceNotes: "",
  workingHoursNote: "",
  businessDescription: "",
  websiteUrl: "",
  diagnosis: null,
};
