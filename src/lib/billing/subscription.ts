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
        "status, current_period_end, cancel_at_period_end, metadata, created_at, billing_cadence, provider_status, service_access_status, service_access_ends_at, legacy_manual_renew",
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
  try {
    const commercial = await resolveWorkspaceCommercial(client, workspaceId);
    const pricingCatalog = await getPricingPageCatalog(client);
    commerce = {
      serviceAccessStatus: commercial.serviceAccess,
      providerStatus: commercial.providerStatus,
      serviceAccessEndsAt: commercial.subscription?.serviceAccessEndsAt ?? null,
      usageAnchorAt: commercial.usageAnchorAt ? String(commercial.usageAnchorAt) : null,
      usagePeriodKey: commercial.usagePeriod.periodKey,
      availableWh: commercial.wallets.unlimited ? null : commercial.wallets.availableWh,
      refundPolicy: REFUND_POLICY_COPY,
      legacyManualRenew: Boolean(commercial.subscription?.legacyManualRenew),
      pricingCatalog,
    };
  } catch {
    commerce = undefined;
  }

  return {
    currentPlanSlug: resolved.planSlug,
    planDisplayName: resolved.config.displayName,
    planSource: resolved.source,
    subscriptionStatus: resolved.subscriptionStatus,
    renewalDate: subscription?.current_period_end ? String(subscription.current_period_end) : null,
    billingInterval,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    freePlanStartedAt: resolved.freePlanStartedAt,
    currentPlanStartedAt: resolved.currentPlanStartedAt,
    capacity: {
      allowance: capacity.unlimited ? null : capacity.allowance,
      used: capacity.used,
      remaining: capacity.unlimited ? null : capacity.remaining,
      unlimited: capacity.unlimited,
      resetsAt: capacity.resetsAt,
      warningLevel: capacity.warningLevel,
    },
    plans: plans.map(toCard),
    invoices,
    commerce,
  };
}
