import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertSuperAdmin } from "@/lib/admin/require-platform-admin";
import { getVoiceEconomicsSummary } from "@/lib/admin/queries/voice-economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, ctx) => {
  assertSuperAdmin(ctx.admin);
  const summary = await getVoiceEconomicsSummary(
    ctx.serviceClient,
    request.nextUrl.searchParams.get("range"),
  );
  return NextResponse.json(summary);
});
