import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { summarizeWorkspaceUsage } from "@/lib/billing/usage/summary";
import { allocateDisplayHours } from "@/lib/billing/usage/round-display";
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
    const totalWorkHours = round2(summary.totalWorkHours);
    const teamWorkHours = round2(summary.teamWorkHours);
    const guideWorkHours = round2(summary.guideWorkHours);

    const employeeRaw = summary.byEmployeeWorkType.map((emp) => emp.workHours);
    const employeeDisplay = allocateDisplayHours(employeeRaw, teamWorkHours);

    const byEmployeeWorkType = summary.byEmployeeWorkType.map((emp, empIdx) => {
      const empHours = employeeDisplay[empIdx] ?? 0;
      const intelRaw = emp.byIntelligence.map((intel) => intel.workHours);
      const intelDisplay = allocateDisplayHours(intelRaw, empHours);

      const byIntelligence = emp.byIntelligence.map((intel, intelIdx) => {
        const intelHours = intelDisplay[intelIdx] ?? 0;
        const wtRaw = intel.byWorkType.map((wt) => wt.workHours);
        const wtDisplay = allocateDisplayHours(wtRaw, intelHours);
        return {
          key: intel.key,
          label: intel.label,
          workHours: intelHours,
          byWorkType: intel.byWorkType.map((wt, wtIdx) => ({
            key: wt.key,
            label: wt.label,
            workHours: wtDisplay[wtIdx] ?? 0,
          })),
        };
      });

      const flatRaw = emp.byWorkType.map((wt) => wt.workHours);
      const flatDisplay = allocateDisplayHours(flatRaw, empHours);

      return {
        employeeId: emp.employeeId,
        label: emp.label,
        workHours: empHours,
        byIntelligence,
        byWorkType: emp.byWorkType.map((wt, wtIdx) => ({
          key: wt.key,
          label: wt.label,
          workHours: flatDisplay[wtIdx] ?? 0,
        })),
      };
    });

    const byEmployeeRaw = summary.byEmployee.map((r) => r.workHours);
    const byEmployeeDisplay = allocateDisplayHours(byEmployeeRaw, teamWorkHours);

    const byWorkTypeRaw = summary.byWorkType.map((r) => r.workHours);
    // Work-type rollup includes Maya; match period total.
    const byWorkTypeDisplay = allocateDisplayHours(byWorkTypeRaw, totalWorkHours);

    return NextResponse.json({
      capacity: {
        allowance: summary.capacity.unlimited ? null : round2(summary.capacity.allowance),
        // Keep meter identical to the ledger-backed period total.
        used: totalWorkHours,
        remaining: summary.capacity.unlimited ? null : round2(summary.capacity.remaining),
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
      byEmployee: summary.byEmployee.map((r, i) => ({
        label: r.label,
        workHours: byEmployeeDisplay[i] ?? 0,
      })),
      byWorkType: summary.byWorkType.map((r, i) => ({
        label: r.label,
        workHours: byWorkTypeDisplay[i] ?? 0,
      })),
      byEmployeeWorkType,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ usage GET]", error);
    return NextResponse.json({ error: "Unable to load usage." }, { status: 500 });
  }
}
