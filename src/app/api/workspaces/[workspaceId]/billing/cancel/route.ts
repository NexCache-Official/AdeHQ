import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canChangePlan } from "@/lib/workspace/permissions";
import { cancelSubscriptionPaidThrough, REFUND_POLICY_COPY } from "@/lib/billing/commerce/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancel Revolut subscription immediately; keep AdeHQ access until paid-through date. */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canChangePlan(role)) {
      return NextResponse.json({ error: "Only workspace admins can cancel the plan." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || "Customer requested cancellation";

    const service = createSupabaseSecretClient();
    const result = await cancelSubscriptionPaidThrough(service, {
      workspaceId: params.workspaceId,
      actorUserId: user.id,
      reason,
    });

    return NextResponse.json({
      ...result,
      refundPolicy: REFUND_POLICY_COPY,
      message: `Your subscription will not renew. You keep paid features until ${result.serviceAccessEndsAt}.`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ billing cancel]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cancel subscription." },
      { status: 500 },
    );
  }
}
