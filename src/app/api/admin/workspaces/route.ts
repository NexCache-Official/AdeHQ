import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { listWorkspaces } from "@/lib/admin/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const search = request.nextUrl.searchParams.get("search");
  const workspaces = await listWorkspaces(serviceClient, search);
  return NextResponse.json({ workspaces });
});
