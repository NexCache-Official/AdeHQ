import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getModelsSummary } from "@/lib/admin/queries/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const summary = await getModelsSummary(serviceClient);
  return NextResponse.json(summary);
});
