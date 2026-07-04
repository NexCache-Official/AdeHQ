"use client";

import { useState } from "react";
import { useWorkHoursCalibration } from "@/hooks/useWorkHoursCalibration";
import {
  CALIBRATION_UI_BADGE,
  type WorkHoursCalibrationReport,
} from "@/lib/ai/work-hours/calibration";
import {
  SOFT_WARNING_BADGE,
  SOFT_WARNING_HELPER,
  SOFT_WARNING_QUALITY_NOTE,
} from "@/lib/ai/work-hours/warnings";
import {
  formatEstimatedHours,
  formatEstimatedMinutes,
  formatWorkTypeLabel,
} from "@/lib/work-hours/labels";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(4)}`;
}

function QualityWarnings({ report }: { report: WorkHoursCalibrationReport }) {
  const warnings = [
    report.quality.rowsMissingCost > 0
      ? `${report.quality.rowsMissingCost} ledger row(s) missing cost`
      : null,
    report.quality.rowsMissingWorkUnit > 0
      ? `${report.quality.rowsMissingWorkUnit} ledger row(s) missing work unit linkage`
      : null,
    report.quality.rowsMissingUsageEvent > 0
      ? `${report.quality.rowsMissingUsageEvent} ledger row(s) missing usage event linkage`
      : null,
    report.quality.ledgerRowsWithoutUsageMatch > 0
      ? `${report.quality.ledgerRowsWithoutUsageMatch} ledger row(s) could not be matched to usage events`
      : null,
  ].filter(Boolean);

  if (!warnings.length && !report.quality.notes.length) {
    return (
      <p className="text-sm text-slate-500">No major data quality gaps detected for this week.</p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-amber-800">
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {report.quality.notes.map((note) => (
        <p key={note} className="text-slate-600">
          {note}
        </p>
      ))}
    </div>
  );
}

export type WorkHoursCalibrationSectionProps = {
  workspaceId: string;
  weekStart?: string;
};

export function WorkHoursCalibrationSection({
  workspaceId,
  weekStart,
}: WorkHoursCalibrationSectionProps) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useWorkHoursCalibration(workspaceId, weekStart, open);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-sm font-medium text-slate-900">Calibration</div>
          <div className="text-xs text-slate-500">{CALIBRATION_UI_BADGE}</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          <p className="mb-4 text-sm text-slate-600">
            Compare shadow Work Minutes against usage cost to tune AI_WORK_MINUTE_USD.
          </p>

          {loading && (
            <p className="text-sm text-slate-500">Loading calibration report…</p>
          )}

          {!loading && error && (
            <p className="text-sm text-rose-700">{error}</p>
          )}

          {!loading && !error && data && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Current rate" value={formatUsd(data.currentRateUsd)} />
                <Metric
                  label="Implied USD / Work Minute"
                  value={formatUsd(data.totals.impliedUsdPerWorkMinute)}
                />
                <Metric
                  label="Suggested balanced rate"
                  value={formatUsd(data.suggestedRates.balancedUsdPerMinute)}
                />
                <Metric
                  label="Total estimated hours"
                  value={formatEstimatedHours(data.totals.estimatedWorkHours)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label="Shadow Work Minutes"
                  value={formatEstimatedMinutes(data.totals.estimatedWorkMinutes)}
                />
                <Metric
                  label="Usage resolved cost"
                  value={formatUsd(data.totals.usageResolvedCostUsd)}
                />
              </div>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {data.suggestedRates.recommendation}
              </p>

              <SoftWarningsSection report={data} />

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Data quality
                </h4>
                <QualityWarnings report={data} />
              </div>

              {data.byWorkType.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    By work type
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.08em] text-slate-400">
                        <tr>
                          <th className="pb-2 pr-4 font-semibold">Work type</th>
                          <th className="pb-2 pr-4 font-semibold">Minutes</th>
                          <th className="pb-2 pr-4 font-semibold">Median</th>
                          <th className="pb-2 pr-4 font-semibold">P95</th>
                          <th className="pb-2 font-semibold">Implied $/min</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byWorkType.map((row) => (
                          <tr key={row.key} className="border-t border-slate-100">
                            <td className="py-2 pr-4 text-slate-700">
                              {formatWorkTypeLabel(row.key)}
                            </td>
                            <td className="py-2 pr-4 tabular-nums">{formatEstimatedMinutes(row.estimatedMinutes)}</td>
                            <td className="py-2 pr-4 tabular-nums">{formatEstimatedMinutes(row.medianMinutes)}</td>
                            <td className="py-2 pr-4 tabular-nums">{formatEstimatedMinutes(row.p95Minutes)}</td>
                            <td className="py-2 tabular-nums">{formatUsd(row.impliedUsdPerMinute)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function severityStyles(severity: "info" | "notice" | "watch"): string {
  if (severity === "watch") return "border-sky-200 bg-sky-50 text-sky-900";
  if (severity === "notice") return "border-indigo-200 bg-indigo-50 text-indigo-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function SoftWarningsSection({ report }: { report: WorkHoursCalibrationReport }) {
  const { softWarnings } = report;

  if (!softWarnings.enabled) {
    return null;
  }

  const showQualityNote =
    !softWarnings.qualityPassed &&
    (softWarnings.suppressedReasons.length > 0 || softWarnings.warnings.length === 0);

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        Soft warnings
      </h4>
      <p className="mb-3 text-xs text-slate-500">{SOFT_WARNING_HELPER}</p>

      {softWarnings.warnings.length > 0 && (
        <div className="space-y-2">
          {softWarnings.warnings.map((warning) => (
            <div
              key={warning.id}
              className={cn("rounded-lg border px-3 py-2.5", severityStyles(warning.severity))}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.08em] opacity-80">
                  {SOFT_WARNING_BADGE}
                </span>
                <span className="text-sm font-medium">{warning.title}</span>
              </div>
              <p className="mt-1 text-sm opacity-90">{warning.message}</p>
            </div>
          ))}
        </div>
      )}

      {showQualityNote && (
        <p className="text-sm text-slate-500">{SOFT_WARNING_QUALITY_NOTE}</p>
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
