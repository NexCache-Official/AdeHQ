export type InvestorStage =
  | "target"
  | "researched"
  | "drafted"
  | "contacted"
  | "replied"
  | "meeting"
  | "passed"
  | "committed";

export type InvestorFirm = {
  id: string;
  name: string;
  website: string | null;
  focus: string | null;
  stageFocus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorContact = {
  id: string;
  firmId: string | null;
  fullName: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorPipelineRecord = {
  id: string;
  firmId: string | null;
  contactId: string | null;
  stage: InvestorStage;
  fitScore: number | null;
  targetAmount: number | null;
  currency: string;
  notes: string | null;
  nextFollowUpAt: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorsSummary = {
  firmCount: number;
  contactCount: number;
  pipelineCount: number;
  activePipelineCount: number;
  averageFitScore: number | null;
};

export type InvestorsListPayload = {
  firms: InvestorFirm[];
  contacts: InvestorContact[];
  pipeline: InvestorPipelineRecord[];
  stages: InvestorStage[];
  summary: InvestorsSummary;
};
