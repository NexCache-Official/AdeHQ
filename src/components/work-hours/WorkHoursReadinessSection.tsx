"use client";

import { useState } from "react";
import { useWorkHoursReadiness } from "@/hooks/useWorkHoursReadiness";
import {
  nextStepLabel,
  READINESS_UI_BADGE,
  verdictLabel,
  type WorkHoursReadinessAudit,
  type WorkHoursReadinessGates,
} from "@/lib/ai/work-hours/readiness";
import { formatEstimatedHours } from "@/lib/work-hours/labels";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

export type WorkHoursReadinessSectionProps = {
  workspaceId: string;
  weekStart?: string;
};

const GATE_LABELS: Record<keyof WorkHoursReadinessGates, string> = {
  enoughLedgerRows: "Enough shadow ledger rows",
  enoughUsageRows: "Enough usage rows",
  linkageQualityOk: "Usage linkage quality",
  missingCostOk: "Cost data coverage",
  rateStabilityOk: "Work minute rate stability",
  softWarningsStable: "Soft warnings stable",
  noExtremeOutliers: "No extreme concentration outliers",
};

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(4)}`;
}

function verdictStyles(verdict: WorkHoursReadinessAudit["verdict"]): string {
  if (verdict === "ready_for_internal_simulation") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (verdict === "needs_more_data") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function riskStyles(severity: "info" | "watch" | "blocker"): string {
  if (severity === "blocker") return "border-slate-300 bg-slate-100 text-slate-800";
  if (severity === "watch") return "border-sky-200 bg-sky-50 text-sky-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function WorkHoursReadinessSection({
  workspaceId,
  weekStart,
}: WorkHoursReadinessSectionProps) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useWorkHoursReadiness(workspaceId, weekStart, open);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-sm font-medium text-slate-900">Limit readiness</div>
          <div className="text-xs text-slate-500">{READINESS_UI_BADGE}</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          {loading && (
            <p className="text-sm text-slate-500">Loading readiness audit…</p>
          )}

          {!loading && error && (
            <p className="text-sm text-rose-700">{error}</p>
          )}

          {!loading && !error && data && (
            <div className="space-y-5">
              <div className={cn("rounded-lg border px-3 py-2.5", verdictStyles(data.verdict))}>
                <div className="text-xs font-medium uppercase tracking-[0.08em] opacity-80">
                  Verdict
                </div>
                <div className="mt-1 text-sm font-semibold">{verdictLabel(data.verdict)}</div>
                <div className="mt-1 text-sm opacity-90">Readiness score: {data.score}/100</div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Gate checklist
                </h4>
                <ul className="space-y-1.5 text-sm">
                  {(Object.keys(GATE_LABELS) as Array<keyof WorkHoursReadinessGates>).map((key) => (
                    <li key={key} className="flex items-center gap-2 text-slate-700">
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                          data.gates[key]
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {data.gates[key] ? "✓" : "·"}
                      </span>
                      {GATE_LABELS[key]}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Metric label="Ledger rows" value={String(data.metrics.ledgerRows)} />
                <Metric label="Usage rows" value={String(data.metrics.usageRows)} />
                <Metric
                  label="Shadow hours"
                  value={formatEstimatedHours(data.metrics.estimatedWorkHours)}
                />
                <Metric label="Implied $/min" value={formatUsd(data.metrics.impliedUsdPerMinute)} />
                <Metric label="Current $/min" value={formatUsd(data.metrics.currentUsdPerMinute)} />
                <Metric
                  label="Rate variance"
                  value={formatPct(data.metrics.varianceFromCurrentRatePct)}
                />
                <Metric
                  label="Unmatched ledger ratio"
                  value={formatPct(data.metrics.ledgerRowsWithoutUsageMatchRatio)}
                />
                <Metric
                  label="Missing cost ratio"
                  value={formatPct(data.metrics.rowsMissingCostRatio)}
                />
                <Metric
                  label="Zero-minute ratio"
                  value={formatPct(data.metrics.zeroMinuteRowsRatio)}
                />
              </div>

              {data.risks.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Risks
                  </h4>
                  <div className="space-y-2">
                    {data.risks.map((risk) => (
                      <div
                        key={risk.id}
                        className={cn("rounded-lg border px-3 py-2.5", riskStyles(risk.severity))}
                      >
                        <div className="text-sm font-medium">{risk.title}</div>
                        <p className="mt-1 text-sm opacity-90">{risk.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.recommendations.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Recommendations
                  </h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {data.recommendations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Next step: {nextStepLabel(data.nextStep)}
              </p>
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
