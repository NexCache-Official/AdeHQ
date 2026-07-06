import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
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

    const service = createServiceRoleClient();
    const summary = await summarizeWorkspaceUsage(service, params.workspaceId, {
      includeCost: false,
    });

    return NextResponse.json({
      capacity: {
        allowance: summary.capacity.unlimited ? null : summary.capacity.allowance,
        used: Math.round(summary.capacity.used * 10) / 10,
        remaining: summary.capacity.unlimited
          ? null
          : Math.round(summary.capacity.remaining * 10) / 10,
        unlimited: summary.capacity.unlimited,
        warningLevel: summary.capacity.warningLevel,
        resetsAt: summary.capacity.resetsAt,
        planSlug: summary.capacity.planSlug,
      },
      weekStart: summary.weekStart,
      totalWorkHours: summary.totalWorkHours,
      byEmployee: summary.byEmployee.map((r) => ({ label: r.label, workHours: r.workHours })),
      byWorkType: summary.byWorkType.map((r) => ({ label: r.label, workHours: r.workHours })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ usage GET]", error);
    return NextResponse.json({ error: "Unable to load usage." }, { status: 500 });
  }
}
