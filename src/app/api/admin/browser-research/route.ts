import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getBrowserResearchSummary } from "@/lib/admin/queries/browser-research";
import { parseRange } from "@/lib/admin/queries/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const summary = await getBrowserResearchSummary(serviceClient, range);
  return NextResponse.json(summary);
});
