import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getSecuritySummary } from "@/lib/admin/queries/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const summary = await getSecuritySummary(serviceClient);
  return NextResponse.json(summary);
});
