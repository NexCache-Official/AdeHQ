/** Versioned commerce domain types — see docs/billing/*.md */

/** Seeded / matrix plans. Custom Plans-hub slugs are also valid PlanCodes. */
export type KnownPlanCode = "free" | "pro" | "team" | "business" | "enterprise";

/** Any published commerce plan slug (`^[a-z][a-z0-9_]{1,31}$`). */
export type PlanCode = string;

export const KNOWN_PLAN_CODES: KnownPlanCode[] = [
  "free",
  "pro",
  "team",
  "business",
  "enterprise",
];

export function isKnownPlanCode(slug: string): slug is KnownPlanCode {
  return (KNOWN_PLAN_CODES as string[]).includes(slug);
}

/** Plans hub / billing_plans.code slug format. */
export function isValidPlanSlug(slug: string): boolean {
  return /^[a-z][a-z0-9_]{1,31}$/.test(slug);
}

export type BillingCadence = "monthly" | "annual";

export type ProviderSubscriptionStatus =
  | "pending"
  | "active"
  | "overdue"
  | "paused"
  | "cancelled"
  | "finished";

export type ServiceAccessStatus =
  | "active"
  | "grace"
  | "scheduled_to_end"
  | "read_only"
  | "free";

export type PlanVisibility =
  | "public"
  | "invite_only"
  | "workspace_specific"
  | "enterprise_contract";

export type PromotionEnforcement =
  | "adehq_ledger"
  | "revolut_price"
  | "revolut_phase"
  | "hybrid";

export type CommerceAdminRole =
  | "commerce_viewer"
  | "support_operator"
  | "promotion_manager"
  | "billing_operator"
  | "catalog_editor"
  | "catalog_approver"
  | "finance_admin"
  | "platform_owner";

export type PlanEntitlements = {
  weeklyWh: number;
  searchEnabled: boolean;
  browserEnabled: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  videoEnabled: boolean;
  videoRequiresApproval: boolean;
  maxConcurrentRuns: number;
  maxStewardCollaborators: number;
  maxStewardSteps: number;
  maxAutomaticRunWh: number;
  sharedMemoryEnabled: boolean;
  memoryRetentionDays: number | null;
  artifactStorageBytes: number;
  usageDashboardLevel: "basic" | "team" | "advanced";
  adminControlsLevel: "basic" | "standard" | "advanced";
  supportLevel: "standard" | "priority" | "dedicated";
  intelligencePolicy: "standard" | "balanced" | "advanced" | "custom";
  humanMembersUnlimited: boolean;
  aiEmployeesUnlimited: boolean;
  unlimited_work_hours?: boolean;
};

export type PublishedCatalogPrice = {
  priceId: string;
  planVersionId: string;
  planCode: PlanCode;
  publicName: string;
  eyebrow: string;
  description: string;
  weeklyIncludedWh: number;
  entitlements: PlanEntitlements;
  currency: string;
  cadence: BillingCadence;
  amountMinor: number;
  revolutVariationId: string | null;
  visibility: PlanVisibility;
};

export type WhLedgerEntryType =
  | "weekly_base_grant"
  | "weekly_promo_grant"
  | "purchased_grant"
  | "goodwill_grant"
  | "upgrade_allowance_adjustment"
  | "usage_debit"
  | "reservation_hold"
  | "reservation_release"
  | "expiration"
  | "refund_compensation"
  | "manual_adjustment"
  | "past_due_grace_grant";

/** Default WH granted once per overdue delinquency episode. */
export const PAST_DUE_GRACE_WH = 10;

/** Default failed-payment grace window. */
export const PAYMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const REFUND_POLICY_COPY =
  "Payments are non-refundable except where required by applicable law or expressly stated in the subscription terms you accepted.";
