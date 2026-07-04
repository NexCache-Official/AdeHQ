"use client";

import { useMemo, useState } from "react";
import { Card, Button } from "@/components/ui";
import { useWorkHoursShadow } from "@/hooks/useWorkHoursShadow";
import {
  formatBillingWeekRange,
  formatCapabilityLabel,
  formatEstimatedHours,
  formatEstimatedMinutes,
  formatWorkTypeLabel,
  isEmptyShadowSummary,
  WORK_HOURS_SHADOW_BADGE,
  WORK_HOURS_SHADOW_HELPER,
} from "@/lib/work-hours/labels";
import { cn } from "@/lib/utils";
import { Activity, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { WorkHoursCalibrationSection } from "@/components/work-hours/WorkHoursCalibrationSection";
import { WorkHoursReadinessSection } from "@/components/work-hours/WorkHoursReadinessSection";
import { WorkHoursSoftCapSimulationSection } from "@/components/work-hours/WorkHoursSoftCapSimulationSection";

type BreakdownRow = {
  label: string;
  minutes: number;
};

function BreakdownList({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (!rows.length) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={`${title}-${row.label}`}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <span className="truncate text-sm text-slate-700">{row.label}</span>
            <span className="ml-3 shrink-0 text-sm font-medium tabular-nums text-slate-900">
              {formatEstimatedMinutes(row.minutes)} min
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type WorkHoursShadowPanelProps = {
  workspaceId: string;
  employeeNames?: Record<string, string>;
  weekStart?: string;
  className?: string;
};

export function WorkHoursShadowPanel({
  workspaceId,
  employeeNames = {},
  weekStart,
  className,
}: WorkHoursShadowPanelProps) {
  const { data, loading, error, refetch } = useWorkHoursShadow(workspaceId, weekStart);
  const [debugOpen, setDebugOpen] = useState(false);

  const employeeRows = useMemo(() => {
    if (!data) return [];
    return data.byEmployee.map((row) => ({
      label: employeeNames[row.employeeId] ?? row.employeeId ?? "Unknown employee",
      minutes: row.minutes,
    }));
  }, [data, employeeNames]);

  const capabilityRows = useMemo(() => {
    if (!data) return [];
    return data.byCapability.map((row) => ({
      label: formatCapabilityLabel(row.capability),
      minutes: row.minutes,
    }));
  }, [data]);

  const workTypeRows = useMemo(() => {
    if (!data) return [];
    return data.byWorkType.map((row) => ({
      label: formatWorkTypeLabel(row.workType),
      minutes: row.minutes,
    }));
  }, [data]);

  const empty = data ? isEmptyShadowSummary(data) : false;

  return (
    <Card className={cn("p-6", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent-600" />
            <h2 className="text-sm font-semibold text-slate-900">AI Usage</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">{WORK_HOURS_SHADOW_HELPER}</p>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-800">
          {WORK_HOURS_SHADOW_BADGE}
        </span>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
            Current billing week
          </div>
          <div className="text-sm text-slate-700">
            {data?.weekStart ? formatBillingWeekRange(data.weekStart) : "—"}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Loading shadow Work Hours…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800">
          <p className="font-medium">Unable to load shadow Work Hours.</p>
          <p className="mt-1 text-rose-700/90">{error}</p>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            No shadow Work Hours recorded for this week yet.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Estimates appear here as AI actions complete in shadow mode.
          </p>
        </div>
      )}

      {!loading && !error && data && !empty && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
                Estimated Work Hours
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {formatEstimatedHours(data.totalEstimatedHours)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
                Estimated Work Minutes
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {formatEstimatedMinutes(data.totalEstimatedMinutes)}
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <BreakdownList title="By employee" rows={employeeRows} />
            <BreakdownList title="By capability" rows={capabilityRows} />
            <BreakdownList title="By work type" rows={workTypeRows} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-slate-700"
              onClick={() => setDebugOpen((open) => !open)}
            >
              Debug details
              {debugOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {debugOpen && (
              <div className="border-t border-slate-200 px-3 py-3 text-xs text-slate-600">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-400">Mode</dt>
                    <dd>{data.mode}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Week start (UTC)</dt>
                    <dd>{data.weekStart}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Workspace</dt>
                    <dd className="truncate">{data.workspaceId}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Breakdown rows</dt>
                    <dd>
                      {data.byEmployee.length + data.byCapability.length + data.byWorkType.length}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <WorkHoursCalibrationSection workspaceId={workspaceId} weekStart={data?.weekStart ?? weekStart} />
        <WorkHoursReadinessSection workspaceId={workspaceId} weekStart={data?.weekStart ?? weekStart} />
        <WorkHoursSoftCapSimulationSection
          workspaceId={workspaceId}
          weekStart={data?.weekStart ?? weekStart}
          employeeNames={employeeNames}
        />
      </div>
    </Card>
  );
}
