import { NextRequest, NextResponse } from "next/server";
import { syncModelPricing } from "@/lib/ai/runtime/pricing";
import { AuthError } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

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

    let adminUserId: string | null = null;
    if (!isCronAuthorized(request)) {
      const { admin } = await requirePlatformAdmin(request);
      adminUserId = admin.userId;
    }

    const serviceClient = createSupabaseSecretClient();
    const summary = await syncModelPricing(serviceClient, {
      providers: [...providers],
      dryRun,
    });

    if (adminUserId && !dryRun) {
      await writeAuditLog(serviceClient, {
        adminUserId,
        action: "model_pricing_synced",
        targetType: "ai_model_catalog",
        targetId: providers.join(","),
        after: summary as unknown,
        request,
      });
    }

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ model pricing sync]", error);
    return NextResponse.json({ error: "Model pricing sync failed." }, { status: 500 });
  }
}
