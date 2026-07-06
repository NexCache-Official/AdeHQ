import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getSystemHealthSummary } from "@/lib/admin/queries/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const summary = await getSystemHealthSummary(serviceClient);
  return NextResponse.json(summary);
});
