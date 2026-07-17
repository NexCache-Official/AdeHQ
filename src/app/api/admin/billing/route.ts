import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { requirePlatformPermission } from "@/lib/admin/require-platform-admin";
import { getRevolutStatus } from "@/lib/billing/revolut/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAID_STATUSES = new Set(["active", "trialing", "past_due", "comped", "manual", "enterprise"]);

type SubRow = {
  id: string;
  workspace_id: string;
  status: string;
  plan_slug: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function moneyLabel(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export const GET = adminRoute(async (_request, ctx) => {
  requirePlatformPermission(ctx, "billing.read");

  const now = Date.now();
  const in30d = now + 30 * 24 * 60 * 60 * 1000;

  const [subsRes, invoicesRes, eventsRes, grantsRes, plansRes, workspacesRes] = await Promise.all([
    ctx.serviceClient
      .from("billing_subscriptions")
      .select(
        "id, workspace_id, status, plan_slug, current_period_start, current_period_end, cancel_at_period_end, metadata, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    ctx.serviceClient
      .from("billing_invoices")
      .select("id, workspace_id, status, amount_cents, currency, created_at, external_payment_id")
      .order("created_at", { ascending: false })
      .limit(40),
    ctx.serviceClient
      .from("billing_events")
      .select("id, event_type, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.serviceClient
      .from("usage_credit_grants")
      .select("id, workspace_id, amount, credit_type, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
    ctx.serviceClient
      .from("platform_plan_configs")
      .select("plan_slug, display_name, monthly_price_cents, annual_price_cents, is_active"),
    ctx.serviceClient.from("workspaces").select("id, name, plan_slug").limit(500),
  ]);

  for (const res of [subsRes, invoicesRes, eventsRes, grantsRes, plansRes, workspacesRes]) {
    if (res.error) throw res.error;
  }

  const revolut = getRevolutStatus();
  const currency = revolut.currency;
  const plans = plansRes.data ?? [];
  const planBySlug = new Map(plans.map((p) => [String(p.plan_slug), p]));
  const workspaceName = new Map(
    (workspacesRes.data ?? []).map((w) => [String(w.id), String(w.name ?? "Workspace")]),
  );

  const subscriptions = (subsRes.data ?? []) as SubRow[];

  // Latest subscription per workspace
  const latestByWorkspace = new Map<string, SubRow>();
  for (const sub of subscriptions) {
    if (!latestByWorkspace.has(sub.workspace_id)) {
      latestByWorkspace.set(sub.workspace_id, sub);
    }
  }
  const latestSubs = [...latestByWorkspace.values()];

  const statusBreakdown: Record<string, number> = {};
  for (const sub of latestSubs) {
    const key = sub.status || "unknown";
    statusBreakdown[key] = (statusBreakdown[key] ?? 0) + 1;
  }

  let mrrCents = 0;
  for (const sub of latestSubs) {
    if (!PAID_STATUSES.has(sub.status)) continue;
    if (sub.status === "cancelled" || sub.status === "expired") continue;
    const plan = planBySlug.get(sub.plan_slug);
    if (!plan) continue;
    const interval = String(sub.metadata?.interval ?? "monthly");
    const monthly =
      interval === "annual"
        ? Math.round(Number(plan.annual_price_cents ?? 0) / 12)
        : Number(plan.monthly_price_cents ?? 0);
    if (Number.isFinite(monthly) && monthly > 0) mrrCents += monthly;
  }

  const activePaidWorkspaces = latestSubs.filter((s) =>
    ["active", "trialing", "past_due"].includes(s.status),
  ).length;
  const cancelledWorkspaces = latestSubs.filter((s) =>
    ["cancelled", "expired"].includes(s.status),
  ).length;
  const cancelAtPeriodEnd = latestSubs.filter((s) => Boolean(s.cancel_at_period_end)).length;

  const upcomingRenewals = latestSubs
    .filter((s) => {
      if (!s.current_period_end) return false;
      if (!["active", "trialing", "past_due"].includes(s.status)) return false;
      const end = Date.parse(s.current_period_end);
      return Number.isFinite(end) && end >= now && end <= in30d;
    })
    .map((s) => ({
      id: s.id,
      workspaceId: s.workspace_id,
      workspaceName: workspaceName.get(s.workspace_id) ?? "Workspace",
      planSlug: s.plan_slug,
      planDisplayName: String(planBySlug.get(s.plan_slug)?.display_name ?? s.plan_slug),
      status: s.status,
      renewsAt: s.current_period_end,
      cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    }))
    .sort((a, b) => String(a.renewsAt).localeCompare(String(b.renewsAt)))
    .slice(0, 20);

  const invoices = (invoicesRes.data ?? []).map((inv) => ({
    id: String(inv.id),
    workspaceId: String(inv.workspace_id),
    workspaceName: workspaceName.get(String(inv.workspace_id)) ?? "Workspace",
    status: String(inv.status ?? "unknown"),
    amountCents: Number(inv.amount_cents ?? 0),
    currency: String(inv.currency ?? currency).toUpperCase(),
    createdAt: String(inv.created_at),
    hasExternalPayment: Boolean(inv.external_payment_id),
  }));

  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const revenue30dCents = paidInvoices
    .filter((i) => Date.parse(i.createdAt) >= now - 30 * 24 * 60 * 60 * 1000)
    .reduce((sum, i) => sum + i.amountCents, 0);
  const revenueAllTimeCents = paidInvoices.reduce((sum, i) => sum + i.amountCents, 0);

  const subscriptionRows = latestSubs.slice(0, 50).map((s) => ({
    id: s.id,
    workspaceId: s.workspace_id,
    workspaceName: workspaceName.get(s.workspace_id) ?? "Workspace",
    status: s.status,
    planSlug: s.plan_slug,
    planDisplayName: String(planBySlug.get(s.plan_slug)?.display_name ?? s.plan_slug),
    interval: String(s.metadata?.interval ?? "monthly"),
    currentPeriodStart: s.current_period_start,
    currentPeriodEnd: s.current_period_end,
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    createdAt: s.created_at,
  }));

  const grants = (grantsRes.data ?? []).map((g) => ({
    id: String(g.id),
    workspaceId: String(g.workspace_id),
    workspaceName: workspaceName.get(String(g.workspace_id)) ?? "Workspace",
    amount: Number(g.amount ?? 0),
    creditType: String(g.credit_type ?? "work_hours"),
    reason: g.reason ? String(g.reason) : null,
    createdAt: String(g.created_at),
  }));

  return NextResponse.json({
    paymentProvider: "revolut",
    paymentsConnected: revolut.configured,
    paymentsMode: revolut.configured ? revolut.environment : "not_configured",
    webhookVerified: revolut.webhookVerified,
    currency,
    readiness: {
      merchantApiKey: revolut.configured,
      webhookSecret: revolut.webhookVerified,
      environment: revolut.environment,
      currency: revolut.currency,
      webhookPath: "/api/billing/revolut/webhook",
    },
    metrics: {
      mrrCents,
      arrCents: mrrCents * 12,
      mrrLabel: moneyLabel(mrrCents, currency),
      arrLabel: moneyLabel(mrrCents * 12, currency),
      revenue30dCents,
      revenue30dLabel: moneyLabel(revenue30dCents, currency),
      revenueAllTimeCents,
      revenueAllTimeLabel: moneyLabel(revenueAllTimeCents, currency),
      activePaidWorkspaces,
      cancelledWorkspaces,
      cancelAtPeriodEnd,
      paidInvoiceCount: paidInvoices.length,
    },
    statusBreakdown,
    upcomingRenewals,
    subscriptions: subscriptionRows,
    recentInvoices: invoices,
    recentEvents: eventsRes.data ?? [],
    recentGrants: grants,
  });
});
