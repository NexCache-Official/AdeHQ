// Company Operating Profile — persistent, versioned company context Maya
// reads before composing a team. Kept separate from any one blueprint so it
// survives across many team-building sessions.

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
  updatedBy: string | null;
  updatedAt: string;
};

export const EMPTY_COMPANY_PROFILE: Omit<CompanyOperatingProfile, "workspaceId" | "updatedAt" | "updatedBy"> = {
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
};
