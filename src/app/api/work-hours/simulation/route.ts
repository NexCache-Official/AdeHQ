import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { getSoftCapSimulationSummary } from "@/lib/ai/work-hours/soft-cap-simulation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const weekStart = request.nextUrl.searchParams.get("weekStart")?.trim() || undefined;
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const summary = await getSoftCapSimulationSummary(client, workspaceId, weekStart);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ work-hours simulation GET]", error);
    return NextResponse.json({ error: "Unable to load soft-cap simulation summary." }, { status: 500 });
  }
}
