import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getUsageSummary, parseCohort, parseGroupBy } from "@/lib/admin/queries/usage";
import { parseRange } from "@/lib/admin/queries/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const groupBy = parseGroupBy(request.nextUrl.searchParams.get("groupBy"));
  const cohort = parseCohort(request.nextUrl.searchParams.get("cohort"));
  const summary = await getUsageSummary(serviceClient, range, groupBy, cohort);
  return NextResponse.json(summary);
});
