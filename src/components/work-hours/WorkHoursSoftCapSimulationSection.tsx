"use client";

import { useState } from "react";
import { useWorkHoursSoftCapSimulation } from "@/hooks/useWorkHoursSoftCapSimulation";
import {
  SOFT_CAP_SIMULATION_BADGE,
  SOFT_CAP_SIMULATION_HELPER,
  type SoftCapSimulationAction,
} from "@/lib/ai/work-hours/soft-cap-simulation";
import { formatEstimatedHours, formatEstimatedMinutes, formatWorkTypeLabel } from "@/lib/work-hours/labels";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

export type WorkHoursSoftCapSimulationSectionProps = {
  workspaceId: string;
  weekStart?: string;
  employeeNames?: Record<string, string>;
};

function actionLabel(action: SoftCapSimulationAction): string {
  if (action === "would_have_capped") return "Would have exceeded internal soft cap";
  if (action === "warn_only") return "Would have warned";
  return "Within simulation";
}

function actionStyles(action: SoftCapSimulationAction): string {
  if (action === "would_have_capped") return "border-sky-200 bg-sky-50 text-sky-900";
  if (action === "warn_only") return "border-indigo-200 bg-indigo-50 text-indigo-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function WorkHoursSoftCapSimulationSection({
  workspaceId,
  weekStart,
  employeeNames = {},
}: WorkHoursSoftCapSimulationSectionProps) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useWorkHoursSoftCapSimulation(workspaceId, weekStart, open);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-sm font-medium text-slate-900">Soft-cap simulation</div>
          <div className="text-xs text-slate-500">{SOFT_CAP_SIMULATION_BADGE}</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          <p className="mb-4 text-sm text-slate-600">{SOFT_CAP_SIMULATION_HELPER}</p>

          {loading && (
            <p className="text-sm text-slate-500">Loading soft-cap simulation…</p>
          )}

          {!loading && error && (
            <p className="text-sm text-rose-700">{error}</p>
          )}

          {!loading && !error && data && (
            <div className="space-y-5">
              {!data.enabled && (
                <p className="text-sm text-slate-500">Soft-cap simulation is disabled in environment config.</p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Internal workspace soft cap"
                  value={`${formatEstimatedMinutes(data.workspaceSoftCapMinutes)} min`}
                />
                <Metric
                  label="Current shadow usage"
                  value={`${formatEstimatedMinutes(data.usedMinutes)} min (${formatEstimatedHours(data.usedHours)} h)`}
                />
                <Metric
                  label="Simulated cap progress"
                  value={`${data.simulatedCapProgressPct}%`}
                />
                <Metric
                  label="Employee soft cap (simulation)"
                  value={`${formatEstimatedMinutes(data.employeeSoftCapMinutes)} min`}
                />
              </div>

              {data.projectedEvents.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Simulation event summary
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {data.projectedEvents.map((row) => (
                      <span
                        key={row.action}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          actionStyles(row.action),
                        )}
                      >
                        {actionLabel(row.action)} · {row.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.recentSimulationEvents.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Recent simulation events
                  </h4>
                  <div className="space-y-2">
                    {data.recentSimulationEvents.map((event) => (
                      <div
                        key={event.id}
                        className={cn("rounded-lg border px-3 py-2.5", actionStyles(event.action))}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>{actionLabel(event.action)}</span>
                          <span className="text-xs opacity-70">
                            {formatWorkTypeLabel(event.workType ?? event.sourceType)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs opacity-80">
                          +{formatEstimatedMinutes(event.estimatedNextMinutes)} min shadow estimate · projected{" "}
                          {formatEstimatedMinutes(event.projectedMinutesAfter)} min
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.byEmployee.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    By employee
                  </h4>
                  <div className="space-y-2">
                    {data.byEmployee.map((row) => (
                      <div
                        key={row.employeeId}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <span className="truncate text-sm text-slate-700">
                          {employeeNames[row.employeeId] ?? row.employeeId}
                        </span>
                        <span className="ml-3 shrink-0 text-xs tabular-nums text-slate-600">
                          {formatEstimatedMinutes(row.usedMinutes)} min · {row.simulatedCapProgressPct}% simulated cap
                          {row.eventCount > 0 ? ` · ${row.eventCount} event(s)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.byWorkType.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    By work type
                  </h4>
                  <div className="space-y-2">
                    {data.byWorkType.map((row) => (
                      <div
                        key={row.workType}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <span className="text-sm text-slate-700">{formatWorkTypeLabel(row.workType)}</span>
                        <span className="ml-3 shrink-0 text-xs tabular-nums text-slate-600">
                          {formatEstimatedMinutes(row.usedMinutes)} min
                          {row.eventCount > 0 ? ` · ${row.eventCount} event(s)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.recentSimulationEvents.length === 0 && data.usedMinutes <= 0 && (
                <p className="text-sm text-slate-500">
                  No shadow usage or simulation events for this week yet.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular-nums text-slate-900")}>{value}</div>
    </div>
  );
}
