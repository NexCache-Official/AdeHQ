import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getFilesStorageSummary } from "@/lib/admin/queries/files-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const summary = await getFilesStorageSummary(serviceClient);
  return NextResponse.json(summary);
});
