/** Commercial plan slugs seeded in platform_plan_configs. */
export type PlanSlug = "free" | "pro" | "team" | "business" | "enterprise";

/** Subscription lifecycle states tracked across workspace + admin surfaces. */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "manual"
  | "comped"
  | "enterprise";

/** Where the effective plan was resolved from (highest priority first). */
export type PlanSource = "override" | "subscription" | "workspace" | "default";

/** Raw platform_plan_configs row shape (snake_case columns). */
export type PlanConfigRow = {
  plan_slug: string;
  display_name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  trial_days: number;
  is_active: boolean;
  weekly_work_hours: number;
  max_ai_employees: number | null;
  max_members: number | null;
  max_workspaces: number | null;
  max_rooms: number | null;
  max_topics: number | null;
  max_storage_bytes: number | null;
  max_browser_runs_per_week: number | null;
  max_file_upload_mb: number | null;
  allowed_intelligence_tiers: string[] | null;
  browser_research_enabled: boolean;
  gateway_search_enabled: boolean;
  custom_ai_employees_enabled: boolean;
  team_features_enabled: boolean;
  admin_controls_enabled: boolean;
  priority_support: boolean;
  human_members_unlimited: boolean;
  ai_employees_unlimited: boolean;
  entitlements: Record<string, unknown>;
};

/** Normalized, customer-safe plan config used across the app. */
export type PlanConfig = {
  planSlug: PlanSlug | string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  trialDays: number;
  isActive: boolean;
  weeklyWorkHours: number;
  humanMembersUnlimited: boolean;
  aiEmployeesUnlimited: boolean;
  maxAiEmployees: number | null;
  maxMembers: number | null;
  maxWorkspaces: number | null;
  maxRooms: number | null;
  maxTopics: number | null;
  maxStorageBytes: number | null;
  maxBrowserRunsPerWeek: number | null;
  maxFileUploadMb: number | null;
  allowedIntelligenceTiers: string[];
  browserResearchEnabled: boolean;
  gatewaySearchEnabled: boolean;
  customAiEmployeesEnabled: boolean;
  teamFeaturesEnabled: boolean;
  adminControlsEnabled: boolean;
  prioritySupport: boolean;
  entitlements: Record<string, unknown>;
};

/** Effective plan for a workspace after applying overrides + subscription. */
export type ResolvedWorkspacePlan = {
  workspaceId: string;
  planSlug: string;
  source: PlanSource;
  subscriptionStatus: SubscriptionStatus | null;
  config: PlanConfig;
  /** Base weekly Work Hours from plan/override (before promo + credits). */
  weeklyWorkHoursBase: number;
  /** True when the plan grants uncapped weekly Work Hours (enterprise/custom). */
  unlimitedWorkHours: boolean;
  /** Applied override metadata, if any. */
  override: {
    weeklyWorkHoursOverride: number | null;
    reason: string | null;
    expiresAt: string | null;
  } | null;
};
