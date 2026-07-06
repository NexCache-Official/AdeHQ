export type CrmContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  notes: string | null;
  source: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
};

export type CrmCompany = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  notes: string | null;
  createdAt: string;
};

export type CrmPipelineStage = {
  id: string;
  name: string;
  sortOrder: number;
  isWon: boolean;
  isLost: boolean;
};

export type CrmDeal = {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  stageId: string | null;
  stageName: string;
  status: "open" | "won" | "lost";
  contactId: string | null;
  companyId: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmSummary = {
  contactCount: number;
  companyCount: number;
  openDealCount: number;
  openPipelineValue: number;
  wonDealCount: number;
};

export type CrmListPayload = {
  contacts: CrmContact[];
  companies: CrmCompany[];
  deals: CrmDeal[];
  stages: CrmPipelineStage[];
  summary: CrmSummary;
};
