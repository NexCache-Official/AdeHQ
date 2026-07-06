import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getWorkHoursSummary } from "@/lib/admin/queries/work-hours";
import { parseRange } from "@/lib/admin/queries/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const range = parseRange(request.nextUrl.searchParams.get("range"), "30d");
  const summary = await getWorkHoursSummary(serviceClient, range);
  return NextResponse.json(summary);
});
