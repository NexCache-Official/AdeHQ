import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminRoute } from "@/lib/admin/api-route";
import { listIntegrationToolRuns } from "@/lib/admin/queries/tool-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const params = request.nextUrl.searchParams;
  const filters = {
    workspaceId: params.get("workspaceId") ?? undefined,
    employeeId: params.get("employeeId") ?? undefined,
    toolName: params.get("toolName") ?? undefined,
    status: params.get("status") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  };

  const payload = await listIntegrationToolRuns(serviceClient, filters);
  return NextResponse.json(payload);
});

const PatchBodySchema = z.object({
  note: z.string().optional(),
});

export const PATCH = adminRoute(async (request) => {
  PatchBodySchema.parse(await request.json().catch(() => ({})));
  return NextResponse.json({ ok: true });
});
