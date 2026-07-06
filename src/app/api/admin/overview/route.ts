import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { getOverviewSummary } from "@/lib/admin/queries/overview";
import { parseRange } from "@/lib/admin/queries/helpers";
import { buildMeta } from "@/lib/admin/metrics/query";
import { parseWorkspaceFilters } from "@/lib/admin/workspace-filters";
import { getOpenIncidentCount } from "@/lib/admin/queries/incidents";
import { getModelsSummary } from "@/lib/admin/queries/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const filters = parseWorkspaceFilters(request.nextUrl.searchParams);
  const [summary, openIncidents, models] = await Promise.all([
    getOverviewSummary(serviceClient, range),
    getOpenIncidentCount(serviceClient),
    getModelsSummary(serviceClient),
  ]);
  return NextResponse.json({
    data: summary,
    meta: buildMeta({ range, filters }),
    openIncidents,
    providerHealth: models.providerHealth,
  });
});
