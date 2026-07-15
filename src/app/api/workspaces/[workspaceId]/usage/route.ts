import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { summarizeWorkspaceUsage } from "@/lib/billing/usage/summary";
import { floorDisplayHours } from "@/lib/billing/usage/round-display";
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

    // Summary already floors leaves and rolls parents up — pass through one shared total.
    const totalWorkHours = floorDisplayHours(summary.totalWorkHours);
    const teamWorkHours = floorDisplayHours(summary.teamWorkHours);
    const guideWorkHours = floorDisplayHours(summary.guideWorkHours);
    const allowance = summary.capacity.unlimited ? null : summary.capacity.allowance;
    const remaining = summary.capacity.unlimited
      ? null
      : Math.max(0, Math.round(((allowance ?? 0) - totalWorkHours) * 100) / 100);

    return NextResponse.json({
      capacity: {
        allowance,
        used: totalWorkHours,
        remaining,
        unlimited: summary.capacity.unlimited,
        warningLevel: summary.capacity.warningLevel,
        resetsAt: summary.capacity.resetsAt,
        periodStart: summary.capacity.periodStart,
        periodEnd: summary.capacity.periodEnd,
        planSlug: summary.capacity.planSlug,
      },
      weekStart: summary.weekStart,
      totalWorkHours,
      teamWorkHours,
      guideWorkHours,
      byEmployee: summary.byEmployee.map((r) => ({
        label: r.label,
        workHours: r.workHours,
      })),
      byWorkType: summary.byWorkType.map((r) => ({
        label: r.label,
        workHours: r.workHours,
      })),
      byEmployeeWorkType: summary.byEmployeeWorkType.map((emp) => ({
        employeeId: emp.employeeId,
        label: emp.label,
        workHours: emp.workHours,
        byIntelligence: emp.byIntelligence.map((intel) => ({
          key: intel.key,
          label: intel.label,
          workHours: intel.workHours,
          byWorkType: intel.byWorkType.map((wt) => ({
            key: wt.key,
            label: wt.label,
            workHours: wt.workHours,
          })),
        })),
        byWorkType: emp.byWorkType.map((wt) => ({
          key: wt.key,
          label: wt.label,
          workHours: wt.workHours,
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
