"use client";

import { useStore } from "@/lib/demo-store";
import {
  useWorkspaceUsage,
  type EmployeeWorkTypeUsage,
} from "@/hooks/useWorkspaceUsage";
import { PageHeader } from "@/components/Page";
import { Card } from "@/components/ui";
import { Gauge } from "lucide-react";

function formatHrs(n: number): string {
  return n.toFixed(2);
}

export default function SettingsUsagePage() {
  const { state } = useStore();
  const { data, loading, error } = useWorkspaceUsage(state.workspace.id);

  const rows: EmployeeWorkTypeUsage[] = data?.byEmployeeWorkType ?? [];
  // Always derive from the API's single floored period total — never mix capacity.used.
  const periodTotal = data?.totalWorkHours ?? 0;
  const teamTotal =
    data?.teamWorkHours ?? rows.reduce((s, r) => s + r.workHours, 0);
  const guideHours = data?.guideWorkHours ?? Math.max(0, periodTotal - teamTotal);

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="One pooled total for your plan. Breakdowns below are that same total, not extra hours. Maya (guide) is listed separately. Week resets Mon 00:00 UTC · also resets at month end."
        icon={<Gauge className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <Card className="p-6 text-sm text-ink-3">Loading…</Card>
      ) : (
        <>
          <Card className="mb-4 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              Plan usage this period (the only total that counts)
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {formatHrs(periodTotal)} AI Work Hours
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {formatHrs(periodTotal)} of{" "}
              {data?.capacity.unlimited
                ? "unlimited"
                : `${(data?.capacity.allowance ?? 0).toFixed(2)}`}{" "}
              pooled workspace hours used — do not add breakdown rows together.
            </p>
            {guideHours > 0 && (
              <p className="mt-2 text-xs text-ink-3">
                Includes {formatHrs(guideHours)} hrs from Maya / guide activity (not listed below).
              </p>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Breakdown of that same total</h2>
              <p className="text-sm font-semibold tabular-nums text-ink">
                Hire team {formatHrs(teamTotal)} hrs
              </p>
            </div>
            <p className="mb-4 text-xs text-ink-3">
              Hours per hired employee, by Auto / work type and capability.
              These rows explain the plan total above — they are not added on top of it.
            </p>

            {rows.length === 0 ? (
              <p className="text-sm text-ink-3">No hired-employee AI activity yet this period.</p>
            ) : (
              <div className="space-y-4">
                {rows.map((employee) => {
                  const intelRows = employee.byIntelligence ?? [];
                  return (
                    <div
                      key={employee.employeeId}
                      className="rounded-xl border border-border-2 bg-muted/30 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">{employee.label}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                          {formatHrs(employee.workHours)} hrs
                        </p>
                      </div>

                      {intelRows.length === 0 && employee.byWorkType.length === 0 ? (
                        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-ink-3">
                          No billable work this period
                        </p>
                      ) : intelRows.length > 0 ? (
                        <div className="space-y-2">
                          {intelRows.map((intel) => (
                            <div
                              key={`${employee.employeeId}-${intel.key}`}
                              className="rounded-lg bg-surface px-3 py-2"
                            >
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-ink-2">{intel.label}</span>
                                <span className="shrink-0 text-sm tabular-nums text-ink">
                                  {formatHrs(intel.workHours)} hrs
                                </span>
                              </div>
                              <div className="space-y-1 border-l border-border-2 pl-3">
                                {intel.byWorkType.map((wt) => (
                                  <div
                                    key={`${employee.employeeId}-${intel.key}-${wt.key}`}
                                    className="flex items-center justify-between gap-3"
                                  >
                                    <span className="truncate text-xs text-ink-3">{wt.label}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-ink-2">
                                      {formatHrs(wt.workHours)} hrs
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {employee.byWorkType.map((wt) => (
                            <div
                              key={`${employee.employeeId}-${wt.key}`}
                              className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"
                            >
                              <span className="truncate text-sm text-ink-2">{wt.label}</span>
                              <span className="ml-3 shrink-0 text-sm tabular-nums text-ink">
                                {formatHrs(wt.workHours)} hrs
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between border-t border-border-2 pt-3">
                  <span className="text-sm font-medium text-ink">Hire team total</span>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatHrs(teamTotal)} hrs
                  </span>
                </div>
                {guideHours > 0 && (
                  <div className="flex items-center justify-between text-ink-3">
                    <span className="text-sm">Maya / guide</span>
                    <span className="text-sm tabular-nums">{formatHrs(guideHours)} hrs</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">Period total</span>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatHrs(periodTotal)} hrs
                  </span>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
