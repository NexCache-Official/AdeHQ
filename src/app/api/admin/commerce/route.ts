import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/require-platform-admin";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { assertCommerceAction, getCommerceRoles, writeCommerceAudit } from "@/lib/billing/commerce/rbac";
import { getPricingPageCatalog, listPublishedPublicCatalog } from "@/lib/billing/commerce/catalog";
import { syncPriceToRevolut } from "@/lib/billing/revolut/provider-sync";
import { reconcileRevolutSubscriptions } from "@/lib/billing/revolut/webhooks";
import { getRevolutStatus } from "@/lib/billing/revolut/client";
import { cancelSubscriptionPaidThrough } from "@/lib/billing/commerce/lifecycle";
import { appendLedgerEntry } from "@/lib/billing/commerce/ledger";
import {
  backfillCommerceAnchors,
  verifyCommerceDualRead,
} from "@/lib/billing/commerce/cutover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AdeHQ Control → Commerce overview + actions. */
export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformAdmin(request);
    const service = createSupabaseSecretClient();
    const roles = await getCommerceRoles(service, admin.userId);
    await assertCommerceAction(service, admin.userId, "view_catalog");

    const [plans, versions, prices, promos, topups, subs, audits, pricing] =
      await Promise.all([
        service.from("billing_plans").select("*").order("sort_order"),
        service
          .from("billing_plan_versions")
          .select("id, plan_id, version, public_name, weekly_included_wh, status, visibility, published_at")
          .order("version", { ascending: false }),
        service
          .from("billing_prices")
          .select("id, plan_version_id, currency, cadence, amount_minor, sync_status, status, revolut_variation_id")
          .order("created_at", { ascending: false }),
        service.from("billing_promotions").select("id, code, name, status, enforcement").limit(50),
        service.from("wh_topup_products").select("*").order("wh_amount"),
        service
          .from("billing_subscriptions")
          .select(
            "id, workspace_id, plan_slug, status, provider_status, service_access_status, current_period_end, external_subscription_id, legacy_manual_renew",
          )
          .order("created_at", { ascending: false })
          .limit(40),
        service
          .from("commerce_audit_events")
          .select("id, action, entity_type, entity_id, reason, created_at")
          .order("created_at", { ascending: false })
          .limit(30),
        getPricingPageCatalog(service).catch(() => []),
      ]);

    return NextResponse.json({
      roles,
      revolut: getRevolutStatus(),
      plans: plans.data ?? [],
      versions: versions.data ?? [],
      prices: prices.data ?? [],
      promotions: promos.data ?? [],
      topups: topups.data ?? [],
      subscriptions: subs.data ?? [],
      audits: audits.data ?? [],
      pricingPreview: pricing,
      notes: {
        noEditLive: true,
        refundPolicy:
          "Payments are non-refundable except where required by applicable law or expressly stated in the subscription terms.",
      },
    });
  } catch (error) {
    console.error("[admin commerce GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin } = await requirePlatformAdmin(request);
    const service = createSupabaseSecretClient();
    const body = (await request.json()) as {
      action?: string;
      priceId?: string;
      workspaceId?: string;
      reason?: string;
      ticketRef?: string;
      amountWh?: number;
      confirmation?: string;
    };

    const action = body.action ?? "";

    if (action === "sync_price") {
      await assertCommerceAction(service, admin.userId, "publish_catalog");
      if (!body.priceId) {
        return NextResponse.json({ error: "priceId required" }, { status: 400 });
      }
      const result = await syncPriceToRevolut(service, body.priceId);
      await writeCommerceAudit(service, {
        actorUserId: admin.userId,
        action: "provider_sync_price",
        entityType: "billing_price",
        entityId: body.priceId,
        reason: body.reason,
        ticketRef: body.ticketRef,
        payload: result,
      });
      return NextResponse.json(result);
    }

    if (action === "reconcile_subscriptions") {
      await assertCommerceAction(service, admin.userId, "repair_subscription");
      const n = await reconcileRevolutSubscriptions(service);
      await writeCommerceAudit(service, {
        actorUserId: admin.userId,
        action: "reconcile_subscriptions",
        entityType: "billing_subscriptions",
        reason: body.reason ?? "Manual reconcile",
        payload: { count: n },
      });
      return NextResponse.json({ reconciled: n });
    }

    if (action === "cancel_subscription") {
      await assertCommerceAction(service, admin.userId, "cancel_subscription");
      if (!body.workspaceId || !body.reason?.trim()) {
        return NextResponse.json({ error: "workspaceId and reason required" }, { status: 400 });
      }
      if (body.confirmation !== "CANCEL") {
        return NextResponse.json({ error: "Type CANCEL to confirm." }, { status: 400 });
      }
      const result = await cancelSubscriptionPaidThrough(service, {
        workspaceId: body.workspaceId,
        actorUserId: admin.userId,
        reason: body.reason,
      });
      return NextResponse.json(result);
    }

    if (action === "grant_goodwill_wh") {
      await assertCommerceAction(service, admin.userId, "grant_goodwill");
      const amount = Number(body.amountWh);
      if (!body.workspaceId || !Number.isFinite(amount) || amount <= 0 || amount > 500) {
        return NextResponse.json(
          { error: "workspaceId and amountWh (1–500) required" },
          { status: 400 },
        );
      }
      if (!body.reason?.trim()) {
        return NextResponse.json({ error: "reason required" }, { status: 400 });
      }
      const idempotencyKey = `goodwill:${body.workspaceId}:${Date.now()}:${amount}`;
      await appendLedgerEntry(service, {
        workspaceId: body.workspaceId,
        entryType: "goodwill_grant",
        amountWh: amount,
        idempotencyKey,
        createdBy: admin.userId,
        reason: body.reason,
      });
      await service.from("wh_credit_lots").insert({
        workspace_id: body.workspaceId,
        lot_type: "goodwill",
        amount_wh: amount,
        remaining_wh: amount,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { ticketRef: body.ticketRef ?? null },
      });
      await writeCommerceAudit(service, {
        actorUserId: admin.userId,
        action: "grant_goodwill_wh",
        entityType: "workspace",
        entityId: body.workspaceId,
        reason: body.reason,
        ticketRef: body.ticketRef,
        payload: { amountWh: amount },
      });
      return NextResponse.json({ ok: true, amountWh: amount });
    }

    if (action === "list_catalog") {
      const catalog = await listPublishedPublicCatalog(service);
      return NextResponse.json({ catalog });
    }

    if (action === "cutover_backfill") {
      await assertCommerceAction(service, admin.userId, "override_safeguards");
      const result = await backfillCommerceAnchors(service);
      await writeCommerceAudit(service, {
        actorUserId: admin.userId,
        action: "cutover_backfill",
        entityType: "workspaces",
        reason: body.reason ?? "Commerce cutover backfill",
        payload: result,
      });
      return NextResponse.json(result);
    }

    if (action === "cutover_verify") {
      await assertCommerceAction(service, admin.userId, "view_catalog");
      const report = await verifyCommerceDualRead(service);
      return NextResponse.json(report);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[admin commerce POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Forbidden" },
      { status: 403 },
    );
  }
}
