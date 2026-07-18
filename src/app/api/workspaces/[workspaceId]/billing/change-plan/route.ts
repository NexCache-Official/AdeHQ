import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canChangePlan } from "@/lib/workspace/permissions";
import { scheduleDowngrade } from "@/lib/billing/commerce/lifecycle";
import { startCheckout } from "@/lib/billing/checkout";
import type { BillingCadence, PlanCode } from "@/lib/billing/commerce/types";
import { isValidPlanSlug } from "@/lib/billing/commerce/types";
import { getPublishedPrice } from "@/lib/billing/commerce/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Known tier ranks; custom plans fall back to published monthly price for ordering. */
const KNOWN_TIER: Record<string, number> = {
  free: 0,
  pro: 1,
  team: 2,
  business: 3,
  enterprise: 4,
};

/**
 * Upgrade → start Revolut subscription checkout for the higher plan.
 * Downgrade → schedule at next billing renewal (WH at next usage boundary).
 * Accepts any published paid plan slug (including custom Plans-hub codes).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canChangePlan(role)) {
      return NextResponse.json({ error: "Only workspace admins can change the plan." }, { status: 403 });
    }

    const body = (await request.json()) as {
      planSlug?: string;
      interval?: BillingCadence;
      reason?: string;
      promoCode?: string;
    };
    const target = (body.planSlug ?? "").toLowerCase() as PlanCode;
    const cadence = (body.interval ?? "monthly") as BillingCadence;
    if (!target || (!isValidPlanSlug(target) && target !== "free")) {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: sub } = await service
      .from("billing_subscriptions")
      .select("plan_slug, billing_cadence")
      .eq("workspace_id", params.workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const current = String(sub?.plan_slug ?? "free").toLowerCase();

    const [currentPrice, targetPrice] = await Promise.all([
      current === "free"
        ? Promise.resolve(null)
        : getPublishedPrice(service, current, cadence),
      target === "free"
        ? Promise.resolve(null)
        : getPublishedPrice(service, target, cadence),
    ]);

    const rank = (slug: string, amountMinor: number | null) => {
      if (slug in KNOWN_TIER) return KNOWN_TIER[slug]! * 1_000_000;
      // Custom plans: order by list price so upgrades/downgrades still make sense.
      return 100_000 + Math.max(0, amountMinor ?? 0);
    };

    const currentTier = rank(current, currentPrice?.amountMinor ?? 0);
    const targetTier = rank(target, targetPrice?.amountMinor ?? 0);

    if (target === "free" || targetTier < currentTier) {
      if (target === "free") {
        return NextResponse.json(
          {
            error:
              "To move to Free, cancel your subscription (access continues until paid-through).",
          },
          { status: 400 },
        );
      }
      if (!targetPrice) {
        return NextResponse.json({ error: "Target plan is not available." }, { status: 400 });
      }
      await scheduleDowngrade(service, {
        workspaceId: params.workspaceId,
        targetPlanCode: target,
        cadence: (sub?.billing_cadence as BillingCadence) ?? cadence,
        actorUserId: user.id,
        reason: body.reason?.trim() || "Customer requested downgrade",
      });
      return NextResponse.json({
        mode: "downgrade_scheduled",
        message:
          "Downgrade scheduled. The lower price applies at your next billing renewal; weekly Work Hours change at the first usage-period boundary on or after that date.",
      });
    }

    if (target === current || targetTier === currentTier) {
      return NextResponse.json({ error: "Already on this plan tier." }, { status: 400 });
    }

    if (!targetPrice) {
      return NextResponse.json({ error: "Target plan is not available." }, { status: 400 });
    }

    const checkout = await startCheckout(service, {
      workspaceId: params.workspaceId,
      userId: user.id,
      planSlug: target,
      interval: cadence,
      customerEmail: user.email,
      promoCode: body.promoCode?.trim() || null,
    });

    return NextResponse.json({
      mode: "upgrade_checkout",
      ...checkout,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ billing change-plan]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to change plan." },
      { status: 500 },
    );
  }
}
