import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { reconcileRevolutSubscriptions } from "@/lib/billing/revolut/webhooks";
import {
  applyServiceAccessEndIfDue,
  markSubscriptionReadOnlyIfGraceExpired,
} from "@/lib/billing/commerce/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron: reconcile Revolut subscription state + apply paid-through / grace expiry.
 * Protect with CRON_SECRET or BILLING_RECONCILE_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret =
    process.env.BILLING_RECONCILE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") ?? "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createSupabaseSecretClient();
  const reconciled = await reconcileRevolutSubscriptions(service, 100);

  const { data: ending } = await service
    .from("billing_subscriptions")
    .select("workspace_id")
    .in("service_access_status", ["scheduled_to_end", "grace"])
    .limit(200);

  let ended = 0;
  let readOnly = 0;
  for (const row of ending ?? []) {
    const workspaceId = String(row.workspace_id);
    if (await applyServiceAccessEndIfDue(service, workspaceId)) ended += 1;
    if (await markSubscriptionReadOnlyIfGraceExpired(service, workspaceId)) readOnly += 1;
  }

  return NextResponse.json({ reconciled, ended, readOnly });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
