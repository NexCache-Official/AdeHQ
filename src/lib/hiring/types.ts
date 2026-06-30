import type { ModelMode } from "@/lib/ai/model-catalog";

export type HiringStep =
  | "role"
  | "recruiter"
  | "brief"
  | "generating_applicants"
  | "shortlist"
  | "offer"
  | "success"
  | "assign_optional";

/** @deprecated Use HiringStep */
export type HiringScreen = HiringStep | "landing" | "generating" | "profile";

export type RecruiterMessage = {
  role: "ade" | "user";
  text: string;
};

/** @deprecated Use RecruiterMessage */
export type HiringMessage = RecruiterMessage;

export type ProactivityLevel = "low" | "balanced" | "high";
export type QualityPreference = "speed" | "balanced" | "quality";
export type SeniorityLevel = "assistant" | "specialist" | "manager" | "director" | "advisor";
export type AutonomyLevel = "low" | "balanced" | "high";
export type CandidateTier = "high_capacity" | "recommended" | "premium";

export type AiEmployeeJobBrief = {
  roleTitle: string;
  department: string;
  domain: string;
  mission: string;
  coreResponsibilities: string[];
  technicalFocus: string[];
  businessFocus: string[];
  successMetrics: string[];
  communicationStyle: string;
  personalityTraits: string[];
  proactivityLevel: ProactivityLevel;
  qualityPreference: QualityPreference;
  seniorityLevel: SeniorityLevel;
  autonomyLevel: AutonomyLevel;
  approvalRules: string[];
  toolsNeeded: string[];
};

export type RecruiterChecklist = {
  roleKnown: boolean;
  domainKnown: boolean;
  coreWorkKnown: boolean;
  workStyleKnown: boolean;
  communicationKnown: boolean;
};

export type AiEmployeeApplicant = {
  id: string;
  tier: CandidateTier;
  name: string;
  first: string;
  title: string;
  modelMode: ModelMode;
  resolvedModelId: string;
  engineLabel: string;
  weeklyWorkHours: number;
  costIntensity: "low" | "medium" | "high";
  speed: "fast" | "standard" | "slower";
  quality: "standard" | "high" | "premium";
  qualityLevel: number;
  speedLevel: number;
  costLevel: number;
  strengths: string[];
  watchOuts: string[];
  bestFor: string;
  whyThisCandidate: string;
  recommended: boolean;
  personalityTags: string[];
  grad: string;
  badge: string;
  badgeKind: "rec" | "neutral";
  cap: number;
};

export type RecruiterApiResponse = {
  message: string;
  chips: string[];
  briefReady: boolean;
  brief?: AiEmployeeJobBrief;
  briefPartial?: Partial<AiEmployeeJobBrief>;
  checklist?: RecruiterChecklist;
  usedFallback?: boolean;
};

export type CandidatesApiResponse = {
  candidates: AiEmployeeApplicant[];
  usedFallback?: boolean;
};

export type HiringSessionState = {
  step: HiringStep;
  roleInput: string;
  departmentId: string | null;
  recruiterMessages: RecruiterMessage[];
  checklist: RecruiterChecklist;
  brief?: AiEmployeeJobBrief;
  briefPartial?: Partial<AiEmployeeJobBrief>;
  briefReady: boolean;
  candidates: AiEmployeeApplicant[];
  selectedCandidateId?: string;
  hiredEmployeeId?: string;
  dmRoomId?: string;
  pendingRoomAssignment?: string;
  genStep: number;
  successStep: number;
  advOpen: Record<string, boolean>;
  compareOpen: boolean;
  interviewWith: string | null;
  interviewMsgs: Record<string, RecruiterMessage[]>;
  busy: boolean;
  error: string | null;
  briefEditable: boolean;
  regenSpin: boolean;
};

export type OnboardingRoomDraft = {
  name: string;
  accent: string;
  template: string;
};

export type RefineMode = "regenerate" | "improve";
