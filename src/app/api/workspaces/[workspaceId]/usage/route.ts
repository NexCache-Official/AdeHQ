import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { summarizeWorkspaceUsage } from "@/lib/billing/usage/summary";
import { floorDisplayHours } from "@/lib/billing/usage/round-display";
import { canViewUsage } from "@/lib/workspace/permissions";
import { reconcileWorkspacePendingSubscription } from "@/lib/billing/revolut/webhooks";

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
    try {
      await reconcileWorkspacePendingSubscription(service, params.workspaceId);
    } catch (err) {
      console.error("[AdeHQ usage GET] reconcile failed", err);
    }

    const summary = await summarizeWorkspaceUsage(service, params.workspaceId, {
      includeCost: false,
    });

    // Probe against the same commerce period capacity uses (not legacy Monday UTC).
    const startIso = summary.capacity.periodStart;
    const endExclusiveIso = summary.capacity.periodEnd;
    const [periodProbe, ledgerProbe] = await Promise.all([
      service
        .from("workspace_usage_periods")
        .select("id, ai_work_hours_used, period_start, period_end, plan_slug, ai_work_hours_allowance")
        .eq("workspace_id", params.workspaceId)
        .eq("status", "active")
        .lte("period_start", new Date().toISOString())
        .gt("period_end", new Date().toISOString())
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("ai_cost_ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", params.workspaceId)
        .gte("created_at", startIso)
        .lt("created_at", endExclusiveIso),
    ]);
    if (periodProbe.error || ledgerProbe.error) {
      console.error("[AdeHQ usage GET] probe failed", {
        workspaceId: params.workspaceId,
        periodError: periodProbe.error,
        ledgerError: ledgerProbe.error,
      });
    }

    // Summary already floors leaves and rolls parents up — pass through one shared total.
    // Prefer period counter when summarize somehow returns 0 despite probe usage.
    const periodUsedRaw = Number(periodProbe.data?.ai_work_hours_used ?? 0);
    const periodUsed = floorDisplayHours(periodUsedRaw);
    let totalWorkHours = floorDisplayHours(summary.totalWorkHours);
    let teamWorkHours = floorDisplayHours(summary.teamWorkHours);
    let guideWorkHours = floorDisplayHours(summary.guideWorkHours);
    if (totalWorkHours <= 0 && periodUsed > 0) {
      totalWorkHours = periodUsed;
      teamWorkHours = periodUsed;
      guideWorkHours = 0;
    }
    const allowance = summary.capacity.unlimited ? null : summary.capacity.allowance;
    const remaining = summary.capacity.unlimited
      ? null
      : Math.max(0, Math.round(((allowance ?? 0) - totalWorkHours) * 100) / 100);

    const body: Record<string, unknown> = {
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
    };

    if (request.nextUrl.searchParams.get("debug") === "1") {
      body.debug = {
        workspaceId: params.workspaceId,
        startIso,
        endExclusiveIso,
        periodProbe: periodProbe.data,
        periodError: periodProbe.error,
        ledgerCount: ledgerProbe.count ?? 0,
        ledgerError: ledgerProbe.error,
        summaryTotal: summary.totalWorkHours,
        summaryCapacityUsed: summary.capacity.used,
      };
    }

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ usage GET]", error);
    return NextResponse.json({ error: "Unable to load usage." }, { status: 500 });
  }
}
