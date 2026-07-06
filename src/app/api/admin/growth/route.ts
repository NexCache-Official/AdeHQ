import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getGrowthSummary } from "@/lib/admin/queries/growth";
import { parseRange } from "@/lib/admin/queries/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const range = parseRange(request.nextUrl.searchParams.get("range"), "30d");
  const summary = await getGrowthSummary(serviceClient, range);
  return NextResponse.json(summary);
});
