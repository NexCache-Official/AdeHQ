import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { listAuditLogs } from "@/lib/admin/queries/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const action = request.nextUrl.searchParams.get("action");
  const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
  const entries = await listAuditLogs(serviceClient, { action, limit });
  return NextResponse.json({ entries });
});
