import type { SupabaseClient } from "@supabase/supabase-js";
import { formatWorkTypeLabel } from "@/lib/work-hours/labels";
import { WORK_HOURS_SHADOW_MODE } from "./constants";
import {
  getWorkHoursCalibrationReport,
  type WorkHoursCalibrationReport,
} from "./calibration";
import {
  assertNoForbiddenWorkHoursCopy,
  getWorkHoursWarningConfig,
  type WorkHoursSoftWarningsResult,
} from "./warnings";

export const READINESS_UI_BADGE = "Internal readiness audit — no limits enforced";

export const READINESS_UI_COPY = [
  READINESS_UI_BADGE,
  "Limit readiness",
  "Ready for internal simulation",
  "Needs more shadow data",
  "Not ready for caps",
  "Gate checklist",
  "Recommendations",
  "Next step",
] as const;

export type WorkHoursReadinessVerdict =
  | "not_ready"
  | "needs_more_data"
  | "ready_for_internal_simulation";

export type WorkHoursReadinessNextStep =
  | "collect_more_data"
  | "improve_usage_linkage"
  | "tune_work_minute_rate"
  | "ready_for_soft_cap_simulation";

export type WorkHoursReadinessRiskSeverity = "info" | "watch" | "blocker";

export type WorkHoursReadinessRisk = {
  id: string;
  severity: WorkHoursReadinessRiskSeverity;
  title: string;
  message: string;
  affectedArea?: string;
};

export type WorkHoursReadinessGates = {
  enoughLedgerRows: boolean;
  enoughUsageRows: boolean;
  linkageQualityOk: boolean;
  missingCostOk: boolean;
  rateStabilityOk: boolean;
  softWarningsStable: boolean;
  noExtremeOutliers: boolean;
};

export type WorkHoursReadinessMetrics = {
  ledgerRows: number;
  usageRows: number;
  estimatedWorkHours: number;
  estimatedCostUsd: number;
  usageCostUsd: number;
  impliedUsdPerMinute: number | null;
  currentUsdPerMinute: number;
  varianceFromCurrentRatePct: number | null;
  ledgerRowsWithoutUsageMatchRatio: number;
  rowsMissingCostRatio: number;
  zeroMinuteRowsRatio: number;
};

export type WorkHoursReadinessAudit = {
  workspaceId: string;
  weekStart: string;
  mode: "readiness_audit";
  verdict: WorkHoursReadinessVerdict;
  score: number;
  gates: WorkHoursReadinessGates;
  metrics: WorkHoursReadinessMetrics;
  risks: WorkHoursReadinessRisk[];
  recommendations: string[];
  nextStep: WorkHoursReadinessNextStep;
  generatedAt: string;
};

export type WorkHoursReadinessConfig = {
  minLedgerRows: number;
  minUsageRows: number;
  maxUnmatchedRatio: number;
  maxMissingCostRatio: number;
  maxRateVariance: number;
  maxConcentrationRatio: number;
};

export type WorkHoursReadinessParams = {
  workspaceId: string;
  weekStart?: string;
  client: SupabaseClient;
  employeeNames?: Record<string, string>;
};

export type ReadinessEvaluationInput = {
  report: WorkHoursCalibrationReport;
  config?: WorkHoursReadinessConfig;
  employeeNames?: Record<string, string>;
};

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : defaultValue;
}

export function getWorkHoursReadinessConfig(): WorkHoursReadinessConfig {
  return {
    minLedgerRows: readNumberEnv("AI_WORK_HOURS_READINESS_MIN_LEDGER_ROWS", 50),
    minUsageRows: readNumberEnv("AI_WORK_HOURS_READINESS_MIN_USAGE_ROWS", 30),
    maxUnmatchedRatio: readNumberEnv("AI_WORK_HOURS_READINESS_MAX_UNMATCHED_RATIO", 0.35),
    maxMissingCostRatio: readNumberEnv("AI_WORK_HOURS_READINESS_MAX_MISSING_COST_RATIO", 0.25),
    maxRateVariance: readNumberEnv("AI_WORK_HOURS_READINESS_MAX_RATE_VARIANCE", 0.25),
    maxConcentrationRatio: readNumberEnv("AI_WORK_HOURS_READINESS_MAX_CONCENTRATION_RATIO", 0.8),
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function topShare<T extends { estimatedMinutes: number }>(
  rows: T[],
  totalMinutes: number,
): { row: T | null; share: number } {
  if (!rows.length || totalMinutes <= 0) return { row: null, share: 0 };
  const top = [...rows].sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)[0] ?? null;
  if (!top) return { row: null, share: 0 };
  return { row: top, share: top.estimatedMinutes / totalMinutes };
}

function buildMetrics(
  report: WorkHoursCalibrationReport,
): WorkHoursReadinessMetrics {
  const ledgerRows = report.totals.ledgerRows;
  const implied = report.totals.impliedUsdPerWorkMinute;
  const current = report.currentRateUsd;
  const varianceFromCurrentRatePct =
    implied != null && implied > 0 && current > 0
      ? Math.abs(implied - current) / current
      : null;

  return {
    ledgerRows,
    usageRows: report.totals.usageRows,
    estimatedWorkHours: report.totals.estimatedWorkHours,
    estimatedCostUsd: report.totals.estimatedCostUsd,
    usageCostUsd: report.totals.usageResolvedCostUsd,
    impliedUsdPerMinute: implied,
    currentUsdPerMinute: current,
    varianceFromCurrentRatePct,
    ledgerRowsWithoutUsageMatchRatio: ratio(
      report.quality.ledgerRowsWithoutUsageMatch,
      ledgerRows,
    ),
    rowsMissingCostRatio: ratio(report.quality.rowsMissingCost, ledgerRows),
    zeroMinuteRowsRatio: ratio(report.quality.zeroMinuteRows, ledgerRows),
  };
}

function evaluateSoftWarningsStable(
  softWarnings: WorkHoursSoftWarningsResult,
  ledgerRows: number,
): boolean {
  if (!softWarnings.enabled) return true;
  if (softWarnings.qualityPassed) return true;
  const warningConfig = getWorkHoursWarningConfig();
  if (ledgerRows < warningConfig.minLedgerRows) return true;
  return softWarnings.suppressedReasons.length > 0;
}

function buildGates(
  report: WorkHoursCalibrationReport,
  metrics: WorkHoursReadinessMetrics,
  config: WorkHoursReadinessConfig,
): WorkHoursReadinessGates {
  const totalMinutes = report.totals.estimatedWorkMinutes;
  const workTypeTop = topShare(report.byWorkType, totalMinutes);
  const employeeTop = topShare(
    report.byEmployee.filter((row) => row.key !== "unknown"),
    totalMinutes,
  );

  const rateStable =
    metrics.varianceFromCurrentRatePct == null
      ? metrics.ledgerRows === 0
      : metrics.varianceFromCurrentRatePct <= config.maxRateVariance;

  return {
    enoughLedgerRows: metrics.ledgerRows >= config.minLedgerRows,
    enoughUsageRows: metrics.usageRows >= config.minUsageRows,
    linkageQualityOk:
      metrics.ledgerRows === 0
        ? false
        : metrics.ledgerRowsWithoutUsageMatchRatio <= config.maxUnmatchedRatio,
    missingCostOk:
      metrics.ledgerRows === 0
        ? false
        : metrics.rowsMissingCostRatio <= config.maxMissingCostRatio,
    rateStabilityOk: rateStable,
    softWarningsStable: evaluateSoftWarningsStable(report.softWarnings, metrics.ledgerRows),
    noExtremeOutliers:
      (workTypeTop.share <= config.maxConcentrationRatio || workTypeTop.row == null) &&
      (employeeTop.share <= config.maxConcentrationRatio || employeeTop.row == null),
  };
}

function buildRisks(
  report: WorkHoursCalibrationReport,
  metrics: WorkHoursReadinessMetrics,
  gates: WorkHoursReadinessGates,
  config: WorkHoursReadinessConfig,
  employeeNames: Record<string, string>,
): WorkHoursReadinessRisk[] {
  const risks: WorkHoursReadinessRisk[] = [];
  const totalMinutes = report.totals.estimatedWorkMinutes;

  if (metrics.ledgerRows === 0) {
    risks.push({
      id: "no-shadow-data",
      severity: "info",
      title: "No shadow ledger data",
      message: "No shadow Work Hours were recorded for this week.",
      affectedArea: "shadow_ledger",
    });
  }

  if (!gates.enoughLedgerRows && metrics.ledgerRows > 0) {
    risks.push({
      id: "low-ledger-volume",
      severity: "info",
      title: "Low shadow ledger volume",
      message: `Only ${metrics.ledgerRows} ledger rows this week; need at least ${config.minLedgerRows} for readiness.`,
      affectedArea: "shadow_ledger",
    });
  }

  if (!gates.enoughUsageRows && metrics.usageRows > 0) {
    risks.push({
      id: "low-usage-volume",
      severity: "info",
      title: "Low usage event volume",
      message: `Only ${metrics.usageRows} usage rows this week; need at least ${config.minUsageRows} for readiness.`,
      affectedArea: "ai_usage_events",
    });
  }

  if (!gates.linkageQualityOk && metrics.ledgerRows > 0) {
    risks.push({
      id: "poor-usage-linkage",
      severity: "blocker",
      title: "Usage linkage quality is poor",
      message: `${Math.round(metrics.ledgerRowsWithoutUsageMatchRatio * 100)}% of ledger rows could not be matched to usage events.`,
      affectedArea: "usage_linkage",
    });
  }

  if (!gates.missingCostOk && metrics.ledgerRows > 0) {
    risks.push({
      id: "missing-cost-data",
      severity: "blocker",
      title: "Too many rows missing cost",
      message: `${Math.round(metrics.rowsMissingCostRatio * 100)}% of ledger rows are missing resolved cost data.`,
      affectedArea: "cost_data",
    });
  }

  if (!gates.rateStabilityOk && metrics.varianceFromCurrentRatePct != null) {
    const pct = Math.round(metrics.varianceFromCurrentRatePct * 100);
    risks.push({
      id: "unstable-work-minute-rate",
      severity: pct > 50 ? "blocker" : "watch",
      title: "Work minute rate may need tuning",
      message: `Implied shadow rate differs from AI_WORK_MINUTE_USD by about ${pct}%.`,
      affectedArea: "AI_WORK_MINUTE_USD",
    });
  }

  if (!gates.softWarningsStable) {
    risks.push({
      id: "soft-warnings-unstable",
      severity: "watch",
      title: "Soft warning quality is inconsistent",
      message:
        "Shadow data volume looks sufficient, but soft warning quality gates are not passing consistently.",
      affectedArea: "soft_warnings",
    });
  }

  const workTypeTop = topShare(report.byWorkType, totalMinutes);
  if (!gates.noExtremeOutliers && workTypeTop.row && workTypeTop.share > config.maxConcentrationRatio) {
    risks.push({
      id: "work-type-concentration",
      severity: "watch",
      title: "Work type concentration outlier",
      message: `${formatWorkTypeLabel(workTypeTop.row.key)} accounts for ${Math.round(workTypeTop.share * 100)}% of shadow minutes — caps could feel unfair.`,
      affectedArea: workTypeTop.row.key,
    });
  }

  const employeeTop = topShare(
    report.byEmployee.filter((row) => row.key !== "unknown"),
    totalMinutes,
  );
  if (!gates.noExtremeOutliers && employeeTop.row && employeeTop.share > config.maxConcentrationRatio) {
    const name = employeeNames[employeeTop.row.key] ?? employeeTop.row.key;
    risks.push({
      id: "employee-concentration",
      severity: "watch",
      title: "Employee concentration outlier",
      message: `${name} accounts for ${Math.round(employeeTop.share * 100)}% of shadow minutes — caps could feel unfair.`,
      affectedArea: employeeTop.row.key,
    });
  }

  if (metrics.zeroMinuteRowsRatio > 0.15 && metrics.ledgerRows > 0) {
    risks.push({
      id: "zero-minute-rows",
      severity: "watch",
      title: "Zero-minute ledger rows",
      message: `${Math.round(metrics.zeroMinuteRowsRatio * 100)}% of ledger rows have zero estimated minutes.`,
      affectedArea: "shadow_ledger",
    });
  }

  return risks;
}

function buildRecommendations(
  gates: WorkHoursReadinessGates,
  risks: WorkHoursReadinessRisk[],
  config: WorkHoursReadinessConfig,
): string[] {
  const recommendations: string[] = [];

  if (!gates.enoughLedgerRows || !gates.enoughUsageRows) {
    recommendations.push(
      "Collect more shadow activity before simulating internal caps — aim for at least one full week of representative usage.",
    );
  }

  if (!gates.linkageQualityOk) {
    recommendations.push(
      "Improve ai_usage_events linkage to shadow ledger rows (work_unit_id and usage_event_id coverage).",
    );
  }

  if (!gates.missingCostOk) {
    recommendations.push(
      "Ensure usage events resolve actual or estimated cost before shadow minutes are derived.",
    );
  }

  if (!gates.rateStabilityOk) {
    recommendations.push(
      "Review AI_WORK_MINUTE_USD against implied shadow cost per minute before any internal cap simulation.",
    );
  }

  if (!gates.noExtremeOutliers) {
    recommendations.push(
      "Review concentrated work types or employees before caps — uneven workloads can produce unfair internal simulations.",
    );
  }

  if (!gates.softWarningsStable) {
    recommendations.push(
      "Stabilize soft warning inputs by improving shadow data quality before relying on advisory signals.",
    );
  }

  const blockers = risks.filter((risk) => risk.severity === "blocker");
  if (blockers.length === 0 && Object.values(gates).every(Boolean)) {
    recommendations.push(
      "Shadow metering quality looks acceptable for an internal soft-cap simulation — still advisory only, not customer enforcement.",
    );
  }

  if (!recommendations.length) {
    recommendations.push(
      `Continue collecting shadow data until at least ${config.minLedgerRows} ledger rows and ${config.minUsageRows} usage rows are available.`,
    );
  }

  return recommendations;
}

function resolveNextStep(
  verdict: WorkHoursReadinessVerdict,
  gates: WorkHoursReadinessGates,
): WorkHoursReadinessNextStep {
  if (verdict === "ready_for_internal_simulation") {
    return "ready_for_soft_cap_simulation";
  }
  if (!gates.linkageQualityOk) return "improve_usage_linkage";
  if (!gates.rateStabilityOk) return "tune_work_minute_rate";
  return "collect_more_data";
}

function resolveVerdict(
  gates: WorkHoursReadinessGates,
  risks: WorkHoursReadinessRisk[],
  metrics: WorkHoursReadinessMetrics,
  config: WorkHoursReadinessConfig,
): WorkHoursReadinessVerdict {
  const hasBlocker = risks.some((risk) => risk.severity === "blocker");

  if (metrics.ledgerRows === 0 || metrics.usageRows === 0) {
    return hasBlocker ? "not_ready" : "needs_more_data";
  }

  if (hasBlocker) return "not_ready";

  if (!gates.enoughLedgerRows || !gates.enoughUsageRows) {
    return "needs_more_data";
  }

  if (!gates.linkageQualityOk || !gates.missingCostOk) return "not_ready";

  if (
    metrics.varianceFromCurrentRatePct != null &&
    metrics.varianceFromCurrentRatePct > config.maxRateVariance * 2
  ) {
    return "not_ready";
  }

  const allGatesPass = Object.values(gates).every(Boolean);
  if (allGatesPass) return "ready_for_internal_simulation";

  if (!gates.rateStabilityOk || !gates.softWarningsStable || !reportHasMeaningfulActivity(metrics)) {
    return "needs_more_data";
  }

  return "needs_more_data";
}

function reportHasMeaningfulActivity(metrics: WorkHoursReadinessMetrics): boolean {
  return metrics.estimatedWorkHours > 0 && metrics.ledgerRows >= 10;
}

export function calculateReadinessScore(input: {
  gates: WorkHoursReadinessGates;
  risks: WorkHoursReadinessRisk[];
}): number {
  const gateValues = Object.values(input.gates);
  const gateScore = (gateValues.filter(Boolean).length / gateValues.length) * 70;

  let penalty = 0;
  for (const risk of input.risks) {
    if (risk.severity === "blocker") penalty += 25;
    else if (risk.severity === "watch") penalty += 8;
    else penalty += 3;
  }

  return Math.max(0, Math.min(100, Math.round(gateScore + 30 - penalty)));
}

export function evaluateHardLimitReadiness(
  input: ReadinessEvaluationInput,
): WorkHoursReadinessAudit {
  const config = input.config ?? getWorkHoursReadinessConfig();
  const employeeNames = input.employeeNames ?? {};
  const report = input.report;
  const metrics = buildMetrics(report);
  const gates = buildGates(report, metrics, config);
  const risks = buildRisks(report, metrics, gates, config, employeeNames);
  const verdict = resolveVerdict(gates, risks, metrics, config);
  const score = calculateReadinessScore({ gates, risks });
  const recommendations = buildRecommendations(gates, risks, config);

  return {
    workspaceId: report.workspaceId,
    weekStart: report.weekStart,
    mode: "readiness_audit",
    verdict,
    score,
    gates,
    metrics,
    risks,
    recommendations,
    nextStep: resolveNextStep(verdict, gates),
    generatedAt: new Date().toISOString(),
  };
}

export async function getWorkHoursReadinessAudit(
  params: WorkHoursReadinessParams,
): Promise<WorkHoursReadinessAudit> {
  const report = await getWorkHoursCalibrationReport({
    workspaceId: params.workspaceId,
    weekStart: params.weekStart,
    client: params.client,
    employeeNames: params.employeeNames,
  });

  return evaluateHardLimitReadiness({
    report,
    employeeNames: params.employeeNames,
  });
}

export function assertNoForbiddenReadinessCopy(text: string): boolean {
  const lower = text.toLowerCase();
  const extraForbidden = ["hard limit enabled"];
  if (extraForbidden.some((phrase) => lower.includes(phrase))) return false;
  return assertNoForbiddenWorkHoursCopy(text);
}

export function verdictLabel(verdict: WorkHoursReadinessVerdict): string {
  if (verdict === "ready_for_internal_simulation") return "Ready for internal simulation";
  if (verdict === "needs_more_data") return "Needs more shadow data";
  return "Not ready for caps";
}

export function nextStepLabel(nextStep: WorkHoursReadinessNextStep): string {
  switch (nextStep) {
    case "ready_for_soft_cap_simulation":
      return "Ready for internal soft-cap simulation";
    case "improve_usage_linkage":
      return "Improve usage linkage";
    case "tune_work_minute_rate":
      return "Tune AI_WORK_MINUTE_USD";
    default:
      return "Collect more shadow data";
  }
}
