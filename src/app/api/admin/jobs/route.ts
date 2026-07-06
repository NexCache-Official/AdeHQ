import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getJobsSummary } from "@/lib/admin/queries/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const summary = await getJobsSummary(serviceClient);
  return NextResponse.json(summary);
});
