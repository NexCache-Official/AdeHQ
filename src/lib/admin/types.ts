export type PlatformAdminRole =
  | "super_admin"
  | "ops_admin"
  | "support_admin"
  | "billing_admin"
  | "readonly_admin";

export type PlatformAdmin = {
  userId: string;
  email: string;
  role: PlatformAdminRole;
  enabled: boolean;
  permissions?: import("./permissions").PlatformPermission[];
};

export type PlatformFeatureFlag = {
  id: string;
  key: string;
  value: unknown;
  flagType: "boolean" | "string" | "number" | "json";
  scope: "global" | "plan" | "workspace" | "user";
  scopeId: string | null;
  description: string | null;
  updatedAt: string;
};

export type PlatformPlanConfig = {
  planSlug: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  trialDays: number;
  isActive: boolean;
  weeklyWorkHours: number;
  maxAiEmployees: number;
  maxMembers: number;
  maxWorkspaces: number;
  maxRooms: number;
  maxTopics: number;
  maxStorageBytes: number;
  maxBrowserRunsPerWeek: number;
  maxFileUploadMb: number;
  allowedIntelligenceTiers: string[];
  browserResearchEnabled: boolean;
  gatewaySearchEnabled: boolean;
  customAiEmployeesEnabled: boolean;
  teamFeaturesEnabled: boolean;
  adminControlsEnabled: boolean;
  prioritySupport: boolean;
  entitlements: Record<string, unknown>;
};

export type AuditLogEntry = {
  id: string;
  adminUserId: string;
  adminEmail?: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
};
