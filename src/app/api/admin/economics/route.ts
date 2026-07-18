import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { requirePlatformPermission } from "@/lib/admin/require-platform-admin";
import {
  economicsStatementCsv,
  economicsStatementHtml,
  getEconomicsSummary,
  parseEconomicsRange,
} from "@/lib/admin/queries/economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, ctx) => {
  requirePlatformPermission(ctx, "billing.read");

  const range = parseEconomicsRange(request.nextUrl.searchParams.get("range"));
  const format = (request.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
  const summary = await getEconomicsSummary(ctx.serviceClient, range);

  if (format === "csv") {
    const date = new Date().toISOString().slice(0, 10);
    const body = economicsStatementCsv(summary);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="adehq-economics-${range}-${date}.csv"`,
      },
    });
  }

  if (format === "html") {
    const date = new Date().toISOString().slice(0, 10);
    const body = economicsStatementHtml(summary);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="adehq-economics-${range}-${date}.html"`,
      },
    });
  }

  return NextResponse.json(summary);
});
