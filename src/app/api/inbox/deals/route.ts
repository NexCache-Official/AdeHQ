import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

/** Thin deal list for Slice D attach-deal picker (not full CRM context). */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "read");
    const { data, error } = await ctx.secret
      .from("crm_deals")
      .select("id, name, stage_name, status")
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({
      deals: (data ?? []).map((d) => ({
        id: String(d.id),
        name: String(d.name),
        stageName: String(d.stage_name ?? ""),
      })),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
