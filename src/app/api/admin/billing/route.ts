import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { requirePlatformPermission } from "@/lib/admin/require-platform-admin";
import { getRevolutStatus } from "@/lib/billing/revolut/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, ctx) => {
  requirePlatformPermission(ctx, "billing.read");

  const [customersRes, subsRes, invoicesRes, eventsRes, grantsRes] = await Promise.all([
    ctx.serviceClient.from("billing_customers").select("id, workspace_id, created_at").limit(50),
    ctx.serviceClient
      .from("billing_subscriptions")
      .select("id, workspace_id, status, plan_slug, current_period_end")
      .limit(50),
    ctx.serviceClient
      .from("billing_invoices")
      .select("id, workspace_id, status, amount_cents, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.serviceClient
      .from("billing_events")
      .select("id, event_type, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.serviceClient
      .from("usage_credit_grants")
      .select("id, workspace_id, amount, credit_type, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  for (const res of [customersRes, subsRes, invoicesRes, eventsRes, grantsRes]) {
    if (res.error) throw res.error;
  }

  const activeSubs = (subsRes.data ?? []).filter((s) => s.status === "active");
  const revolut = getRevolutStatus();

  return NextResponse.json({
    paymentProvider: "revolut",
    paymentsConnected: revolut.configured,
    paymentsMode: revolut.configured ? revolut.environment : "not_configured",
    webhookVerified: revolut.webhookVerified,
    mrrCents: null,
    arrCents: null,
    activePaidWorkspaces: activeSubs.length,
    billingCustomers: customersRes.data?.length ?? 0,
    subscriptions: subsRes.data ?? [],
    recentInvoices: invoicesRes.data ?? [],
    recentEvents: eventsRes.data ?? [],
    recentGrants: grantsRes.data ?? [],
  });
});
