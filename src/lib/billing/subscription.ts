import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeWorkspaceUsage } from "@/lib/billing/usage/summary";
import {
  listActivePlanConfigs,
  resolveWorkspacePlan,
} from "@/lib/billing/plans/resolve-workspace-plan";
import type { PlanConfig, SubscriptionStatus } from "@/lib/billing/plans/types";
import { getPricingPageCatalog } from "@/lib/billing/commerce/catalog";
import { resolveWorkspaceCommercial } from "@/lib/billing/commerce/resolver";
import { REFUND_POLICY_COPY } from "@/lib/billing/commerce/types";

export type PublicPlanCard = {
  planSlug: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  weeklyWorkHours: number;
  unlimitedWorkHours: boolean;
  entitlements: Record<string, unknown>;
};

export type BillingInvoiceRow = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
};

export type WorkspaceBillingSummary = {
  currentPlanSlug: string;
  planDisplayName: string;
  planSource: string;
  subscriptionStatus: SubscriptionStatus | null;
  renewalDate: string | null;
  billingInterval: "monthly" | "annual" | null;
  cancelAtPeriodEnd: boolean;
  freePlanStartedAt: string | null;
  currentPlanStartedAt: string | null;
  capacity: {
    allowance: number | null;
    used: number;
    remaining: number | null;
    unlimited: boolean;
    resetsAt: string;
    warningLevel: "ok" | "low" | "exhausted";
  };
  plans: PublicPlanCard[];
  invoices: BillingInvoiceRow[];
  commerce?: {
    serviceAccessStatus: string;
    providerStatus: string | null;
    serviceAccessEndsAt: string | null;
    usageAnchorAt: string | null;
    usagePeriodKey: string | null;
    availableWh: number | null;
    refundPolicy: string;
    legacyManualRenew: boolean;
    pricingCatalog: Awaited<ReturnType<typeof getPricingPageCatalog>>;
  };
};

function toCard(config: PlanConfig): PublicPlanCard {
  const unlimited =
    config.entitlements?.unlimited_work_hours === true ||
    (config.planSlug === "enterprise" && config.weeklyWorkHours <= 0);
  return {
    planSlug: String(config.planSlug),
    displayName: config.displayName,
    monthlyPriceCents: config.monthlyPriceCents,
    annualPriceCents: config.annualPriceCents,
    weeklyWorkHours: config.weeklyWorkHours,
    unlimitedWorkHours: unlimited,
    entitlements: config.entitlements,
  };
}

export async function getWorkspaceBillingSummary(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceBillingSummary> {
  const [resolved, usage, plans, subscriptionRes, invoicesRes] = await Promise.all([
    resolveWorkspacePlan(client, workspaceId),
    summarizeWorkspaceUsage(client, workspaceId, { includeCost: false }),
    listActivePlanConfigs(client),
    client
      .from("billing_subscriptions")
      .select(
        "plan_slug, status, current_period_end, cancel_at_period_end, metadata, created_at, billing_cadence, provider_status, service_access_status, service_access_ends_at, legacy_manual_renew",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("billing_invoices")
      .select("id, amount_cents, currency, status, hosted_invoice_url, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);
  const capacity = usage.capacity;

  const subscription = subscriptionRes.error ? null : subscriptionRes.data;
  const metadata = (subscription?.metadata as Record<string, unknown> | undefined) ?? {};
  const billingInterval =
    subscription?.billing_cadence === "annual" || metadata.interval === "annual"
      ? "annual"
      : subscription?.billing_cadence === "monthly" || metadata.interval === "monthly"
        ? "monthly"
        : null;

  if (invoicesRes.error) {
    console.error("[AdeHQ billing] invoices query failed", {
      workspaceId,
      error: invoicesRes.error,
    });
  }
  const invoices: BillingInvoiceRow[] = invoicesRes.error
    ? []
    : (invoicesRes.data ?? []).map((row) => ({
        id: String(row.id),
        amountCents: Number(row.amount_cents ?? 0),
        currency: String(row.currency ?? "usd").toUpperCase(),
        status: String(row.status ?? "draft"),
        createdAt: String(row.created_at),
        hostedInvoiceUrl: row.hosted_invoice_url ? String(row.hosted_invoice_url) : null,
      }));

  let commerce: WorkspaceBillingSummary["commerce"];
  let pricingCatalog: Awaited<ReturnType<typeof getPricingPageCatalog>> = [];
  try {
    const commercial = await resolveWorkspaceCommercial(client, workspaceId);
    pricingCatalog = await getPricingPageCatalog(client);
    // Prefer the raw subscription row for access status — the commerce resolver
    // defaults to "free" when the join fails, which is what made Billing show
    // "Pro · access: free" with a 10 WH meter after checkout.
    const rawAccess = subscription?.service_access_status
      ? String(subscription.service_access_status)
      : commercial.serviceAccess;
    const rawProvider = subscription?.provider_status
      ? String(subscription.provider_status)
      : commercial.providerStatus;
    commerce = {
      serviceAccessStatus: rawAccess,
      providerStatus: rawProvider,
      serviceAccessEndsAt:
        subscription?.service_access_ends_at
          ? String(subscription.service_access_ends_at)
          : (commercial.subscription?.serviceAccessEndsAt ?? null),
      usageAnchorAt: commercial.usageAnchorAt ? String(commercial.usageAnchorAt) : null,
      usagePeriodKey: commercial.usagePeriod.periodKey,
      availableWh: commercial.wallets.unlimited
        ? null
        : Math.max(
            Number(commercial.wallets.availableWh ?? 0),
            capacity.unlimited ? 0 : capacity.allowance - capacity.used,
          ),
      refundPolicy: REFUND_POLICY_COPY,
      legacyManualRenew: Boolean(
        subscription?.legacy_manual_renew ?? commercial.subscription?.legacyManualRenew,
      ),
      pricingCatalog,
    };
  } catch {
    commerce = undefined;
    try {
      pricingCatalog = await getPricingPageCatalog(client);
    } catch {
      pricingCatalog = [];
    }
  }

  // Prefer live published catalog prices for upgrade cards when available.
  const catalogBySlug = new Map(pricingCatalog.map((p) => [p.planCode, p]));
  const planCards = plans.map((config) => {
    const card = toCard(config);
    const live = catalogBySlug.get(config.planSlug as never);
    if (!live) return card;
    return {
      ...card,
      displayName: live.publicName || card.displayName,
      monthlyPriceCents: live.monthly?.amountMinor ?? card.monthlyPriceCents,
      annualPriceCents: live.annual?.amountMinor ?? card.annualPriceCents,
      weeklyWorkHours: live.weeklyIncludedWh ?? card.weeklyWorkHours,
      unlimitedWorkHours:
        live.entitlements.unlimited_work_hours === true || card.unlimitedWorkHours,
    };
  });

  // Effective plan: never let a free resolve beat workspace/subscription Pro.
  const tier: Record<string, number> = { free: 0, pro: 1, team: 2, business: 3, enterprise: 4 };
  const pickHigher = (a: string, b: string) =>
    (tier[a] ?? 0) >= (tier[b] ?? 0) ? a : b;
  const subGrants =
    subscription?.service_access_status === "active" ||
    subscription?.service_access_status === "grace" ||
    subscription?.service_access_status === "scheduled_to_end" ||
    subscription?.service_access_status === "read_only";
  let currentPlanSlug = pickHigher(resolved.planSlug, capacity.planSlug);
  if (subGrants && subscription?.plan_slug) {
    currentPlanSlug = pickHigher(currentPlanSlug, String(subscription.plan_slug));
  }
  const currentCard = planCards.find((p) => p.planSlug === currentPlanSlug);
  const planDisplayName =
    currentCard?.displayName ??
    (currentPlanSlug === resolved.planSlug
      ? resolved.config.displayName
      : currentPlanSlug.charAt(0).toUpperCase() + currentPlanSlug.slice(1));

  // Floor displayed allowance to the plan card WH (admin Plans hub) so Pro
  // always shows 125 here even if a stale period row still says 10.
  const planWhFloor = currentCard?.unlimitedWorkHours
    ? null
    : Number(currentCard?.weeklyWorkHours ?? 0);
  const allowance = capacity.unlimited
    ? null
    : Math.max(capacity.allowance, planWhFloor && planWhFloor > 0 ? planWhFloor : 0);
  const used = capacity.used;
  const remaining =
    capacity.unlimited || allowance == null
      ? null
      : Math.round((allowance - used) * 100) / 100;

  return {
    currentPlanSlug,
    planDisplayName,
    planSource: resolved.source,
    subscriptionStatus:
      (subscription?.status as typeof resolved.subscriptionStatus) ??
      resolved.subscriptionStatus,
    renewalDate: subscription?.current_period_end ? String(subscription.current_period_end) : null,
    billingInterval,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    freePlanStartedAt: resolved.freePlanStartedAt,
    currentPlanStartedAt: resolved.currentPlanStartedAt,
    capacity: {
      allowance,
      used,
      remaining,
      unlimited: capacity.unlimited || Boolean(currentCard?.unlimitedWorkHours),
      resetsAt: capacity.resetsAt,
      warningLevel:
        allowance != null && remaining != null && remaining <= 0
          ? "exhausted"
          : capacity.warningLevel,
    },
    plans: planCards,
    invoices,
    commerce,
  };
}
