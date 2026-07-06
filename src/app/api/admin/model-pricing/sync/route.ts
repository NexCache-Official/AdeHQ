import { NextRequest, NextResponse } from "next/server";
import { syncModelPricing } from "@/lib/ai/runtime/pricing";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.MODEL_PRICING_CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret")?.trim();
  return header === secret;
}

export async function POST(request: NextRequest) {
  try {
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
    const providerParam = request.nextUrl.searchParams.get("provider");
    const providers =
      providerParam === "vercel" || providerParam === "siliconflow"
        ? ([providerParam] as const)
        : (["vercel", "siliconflow"] as const);

    if (!isCronAuthorized(request)) {
      const { user, client } = await requireAuthUser(request);
      const workspaceId = request.nextUrl.searchParams.get("workspaceId");
      if (!workspaceId) {
        return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
      }
      const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
      if (role !== "owner" && role !== "admin") {
        return NextResponse.json(
          { error: "Only workspace owners and admins can sync model pricing." },
          { status: 403 },
        );
      }
    }

    const serviceClient = createServiceRoleClient();
    const summary = await syncModelPricing(serviceClient, {
      providers: [...providers],
      dryRun,
    });

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ model pricing sync]", error);
    return NextResponse.json({ error: "Model pricing sync failed." }, { status: 500 });
  }
}
