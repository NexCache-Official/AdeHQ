import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { summarizeWorkspaceUsage } from "@/lib/billing/usage/summary";
import { canViewUsage } from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer-facing usage summary — AI Work Hours only, never raw provider cost. */
export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canViewUsage(role)) {
      return NextResponse.json({ error: "You cannot view usage for this workspace." }, { status: 403 });
    }

    const service = createSupabaseSecretClient();
    const summary = await summarizeWorkspaceUsage(service, params.workspaceId, {
      includeCost: false,
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      capacity: {
        allowance: summary.capacity.unlimited ? null : round2(summary.capacity.allowance),
        used: round2(summary.capacity.used),
        remaining: summary.capacity.unlimited ? null : round2(summary.capacity.remaining),
        unlimited: summary.capacity.unlimited,
        warningLevel: summary.capacity.warningLevel,
        resetsAt: summary.capacity.resetsAt,
        periodStart: summary.capacity.periodStart,
        periodEnd: summary.capacity.periodEnd,
        planSlug: summary.capacity.planSlug,
      },
      weekStart: summary.weekStart,
      totalWorkHours: summary.totalWorkHours,
      teamWorkHours: summary.teamWorkHours,
      guideWorkHours: summary.guideWorkHours,
      byEmployee: summary.byEmployee.map((r) => ({
        label: r.label,
        workHours: round2(r.workHours),
      })),
      byWorkType: summary.byWorkType.map((r) => ({
        label: r.label,
        workHours: round2(r.workHours),
      })),
      byEmployeeWorkType: summary.byEmployeeWorkType.map((emp) => ({
        employeeId: emp.employeeId,
        label: emp.label,
        workHours: round2(emp.workHours),
        byWorkType: emp.byWorkType.map((wt) => ({
          key: wt.key,
          label: wt.label,
          workHours: round2(wt.workHours),
        })),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ usage GET]", error);
    return NextResponse.json({ error: "Unable to load usage." }, { status: 500 });
  }
}
