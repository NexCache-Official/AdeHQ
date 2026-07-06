import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { listUsers } from "@/lib/admin/queries/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const search = request.nextUrl.searchParams.get("search");
  const users = await listUsers(serviceClient, search);
  return NextResponse.json({ users });
});
