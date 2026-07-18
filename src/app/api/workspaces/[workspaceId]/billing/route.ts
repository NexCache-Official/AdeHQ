import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getWorkspaceBillingSummary } from "@/lib/billing/subscription";
import { reconcileWorkspacePendingSubscription } from "@/lib/billing/revolut/webhooks";
import {
  canApplyPromoCode,
  canChangePlan,
  canStartCheckout,
  canViewBilling,
} from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canViewBilling(role)) {
      return NextResponse.json({ error: "You cannot view billing for this workspace." }, { status: 403 });
    }

    const service = createSupabaseSecretClient();
    // Self-heal: activate from Revolut's authoritative state if the webhook hasn't
    // landed yet, so the UI doesn't get stuck waiting on webhook delivery alone.
    try {
      await reconcileWorkspacePendingSubscription(service, params.workspaceId);
    } catch (err) {
      console.error("[AdeHQ billing GET] reconcile failed", err);
    }
    const summary = await getWorkspaceBillingSummary(service, params.workspaceId);

    return NextResponse.json(
      {
        ...summary,
        permissions: {
          canViewBilling: canViewBilling(role),
          canStartCheckout: canStartCheckout(role),
          canApplyPromoCode: canApplyPromoCode(role),
          canChangePlan: canChangePlan(role),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ billing GET]", error);
    return NextResponse.json({ error: "Unable to load billing." }, { status: 500 });
  }
}
