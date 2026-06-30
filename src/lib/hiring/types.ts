export type HiringScreen =
  | "landing"
  | "recruiter"
  | "brief"
  | "generating"
  | "shortlist"
  | "offer"
  | "success"
  | "profile";

export type HiringMessage = {
  role: "ade" | "user";
  text: string;
};

export type JobBrief = {
  title: string;
  roleTitle: string;
  industry: string;
  focus: string;
  tone: string;
  proactivity: string;
  priority: string;
  startLocation: string;
  mission: string;
  responsibilities: string[];
  industryContext: string;
  workingStyle: string;
  communicationStyle: string;
  approvalRules: string[];
  successCriteria: string[];
};

export type HiringAnswers = Partial<
  Pick<
    JobBrief,
    | "industry"
    | "focus"
    | "tone"
    | "proactivity"
    | "priority"
    | "startLocation"
    | "roleTitle"
  >
>;

export type DemoApplicant = {
  id: string;
  name: string;
  first: string;
  title: string;
  badge: string;
  badgeKind: "rec" | "neutral";
  tags: string[];
  engine: string;
  advModel: string;
  hours: number;
  cap: number;
  quality: number;
  qualityText: string;
  speed: number;
  speedText: string;
  cost: number;
  costText: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
  grad: string;
  recommended: boolean;
};

export type RecruiterApiResponse = {
  message: string;
  chips: string[];
  showLocationPicker: boolean;
  briefReady: boolean;
  brief?: JobBrief;
  answers?: HiringAnswers;
  usedFallback?: boolean;
};

export type OnboardingRoomDraft = {
  name: string;
  accent: string;
  template: string;
};
