import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canStartCheckout } from "@/lib/workspace/permissions";
import { startCheckout } from "@/lib/billing/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canStartCheckout(role)) {
      return NextResponse.json({ error: "You cannot start checkout for this workspace." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      planSlug?: string;
      interval?: string;
      promoCode?: string;
    };
    const planSlug = typeof body.planSlug === "string" ? body.planSlug.trim() : "";
    const interval = body.interval === "annual" ? "annual" : "monthly";
    if (!planSlug) {
      return NextResponse.json({ error: "planSlug is required." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const result = await startCheckout(service, {
      workspaceId: params.workspaceId,
      userId: user.id,
      planSlug,
      interval,
      promoCode: body.promoCode?.trim() || null,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ checkout POST]", error);
    return NextResponse.json({ error: "Unable to start checkout." }, { status: 500 });
  }
}
