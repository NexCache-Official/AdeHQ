import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { getWorkHoursCalibrationReport } from "@/lib/ai/work-hours/calibration";

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

    const { data: employeeRows } = await client
      .from("ai_employees")
      .select("id, name")
      .eq("workspace_id", workspaceId);

    const employeeNames = Object.fromEntries(
      ((employeeRows as { id: string; name: string }[] | null) ?? []).map((row) => [
        row.id,
        row.name,
      ]),
    );

    const report = await getWorkHoursCalibrationReport({
      workspaceId,
      weekStart,
      client,
      employeeNames,
    });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ work-hours calibration GET]", error);
    return NextResponse.json({ error: "Unable to load calibration report." }, { status: 500 });
  }
}
