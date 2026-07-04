import { formatWorkTypeLabel } from "@/lib/work-hours/labels";
import type { WorkHoursCalibrationWarningInput } from "./calibration";

export const FORBIDDEN_WORK_HOURS_COPY = [
  "remaining hours",
  "hours left",
  "upgrade",
  "blocked",
  "limit reached",
  "out of hours",
  "billing due",
  "charged",
  "invoice",
  "payment required",
  "you must upgrade",
  "you have",
] as const;

export const SOFT_WARNING_BADGE = "Shadow warning — not enforced";

export const SOFT_WARNING_HELPER =
  "These warnings are based on shadow estimates and are not used for billing or limits.";

export const SOFT_WARNING_QUALITY_NOTE =
  "Not enough reliable shadow data for soft warnings yet.";

export type WorkHoursWarningSeverity = "info" | "notice" | "watch";

export type WorkHoursSoftWarning = {
  id: string;
  severity: WorkHoursWarningSeverity;
  title: string;
  message: string;
  reason: string;
  workType?: string;
  capability?: string;
  employeeId?: string;
};

export type WorkHoursSoftWarningsResult = {
  enabled: boolean;
  qualityPassed: boolean;
  warnings: WorkHoursSoftWarning[];
  suppressedReasons: string[];
};

export type WorkHoursWarningConfig = {
  enabled: boolean;
  minLedgerRows: number;
  maxUnmatchedRatio: number;
  maxMissingCostRatio: number;
  maxZeroMinuteRatio: number;
  highHoursThreshold: number;
  workTypeConcentrationRatio: number;
  embeddingShareRatio: number;
  employeeConcentrationRatio: number;
  rateInstabilityRatio: number;
};

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : defaultValue;
}

export function getWorkHoursWarningConfig(): WorkHoursWarningConfig {
  return {
    enabled: readBoolEnv("AI_WORK_HOURS_SOFT_WARNINGS_ENABLED", true),
    minLedgerRows: readNumberEnv("AI_WORK_HOURS_WARNING_MIN_LEDGER_ROWS", 10),
    maxUnmatchedRatio: readNumberEnv("AI_WORK_HOURS_WARNING_MAX_UNMATCHED_RATIO", 0.5),
    maxMissingCostRatio: readNumberEnv("AI_WORK_HOURS_WARNING_MAX_MISSING_COST_RATIO", 0.4),
    maxZeroMinuteRatio: 0.2,
    highHoursThreshold: readNumberEnv("AI_WORK_HOURS_WARNING_HIGH_HOURS_THRESHOLD", 10),
    workTypeConcentrationRatio: 0.6,
    embeddingShareRatio: 0.4,
    employeeConcentrationRatio: 0.6,
    rateInstabilityRatio: 0.3,
  };
}

export function assertNoForbiddenWorkHoursCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return !FORBIDDEN_WORK_HOURS_COPY.some((phrase) => lower.includes(phrase));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function passesWorkHoursWarningQualityGate(
  report: WorkHoursCalibrationWarningInput,
  config: WorkHoursWarningConfig = getWorkHoursWarningConfig(),
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const ledgerRows = report.totals.ledgerRows;

  if (ledgerRows < config.minLedgerRows) {
    reasons.push(`Need at least ${config.minLedgerRows} shadow ledger rows (have ${ledgerRows}).`);
  }
  if (report.totals.estimatedWorkMinutes <= 0) {
    reasons.push("Estimated Work Minutes must be greater than zero.");
  }
  if (ratio(report.quality.ledgerRowsWithoutUsageMatch, ledgerRows) > config.maxUnmatchedRatio) {
    reasons.push("Too many ledger rows could not be matched to usage events.");
  }
  if (ratio(report.quality.rowsMissingCost, ledgerRows) > config.maxMissingCostRatio) {
    reasons.push("Too many ledger rows are missing cost data.");
  }
  if (ratio(report.quality.zeroMinuteRows, ledgerRows) > config.maxZeroMinuteRatio) {
    reasons.push("Too many zero-minute ledger rows.");
  }

  return { passed: reasons.length === 0, reasons };
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

export function evaluateWorkHoursSoftWarnings(
  report: WorkHoursCalibrationWarningInput,
  options: {
    config?: WorkHoursWarningConfig;
    employeeNames?: Record<string, string>;
  } = {},
): WorkHoursSoftWarningsResult {
  const config = options.config ?? getWorkHoursWarningConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      qualityPassed: false,
      warnings: [],
      suppressedReasons: ["Soft warnings disabled."],
    };
  }

  const quality = passesWorkHoursWarningQualityGate(report, config);
  if (!quality.passed) {
    return {
      enabled: true,
      qualityPassed: false,
      warnings: [],
      suppressedReasons: [SOFT_WARNING_QUALITY_NOTE, ...quality.reasons],
    };
  }

  const warnings: WorkHoursSoftWarning[] = [];
  const totalMinutes = report.totals.estimatedWorkMinutes;
  const totalHours = report.totals.estimatedWorkHours;

  if (totalHours >= config.highHoursThreshold) {
    warnings.push({
      id: "high-weekly-usage",
      severity: totalHours >= config.highHoursThreshold * 1.5 ? "watch" : "notice",
      title: "High weekly shadow estimate",
      message: "Trending high this week based on shadow estimates.",
      reason: `Estimated ${totalHours.toFixed(1)} shadow Work Hours this week.`,
    });
  }

  const workTypeTop = topShare(report.byWorkType, totalMinutes);
  if (workTypeTop.row && workTypeTop.share >= config.workTypeConcentrationRatio) {
    const label = formatWorkTypeLabel(workTypeTop.row.key);
    warnings.push({
      id: "concentrated-work-type",
      severity: workTypeTop.share >= 0.75 ? "watch" : "notice",
      title: "Concentrated work type",
      message: `Most shadow usage this week is from ${label}.`,
      reason: `${Math.round(workTypeTop.share * 100)}% of estimated minutes.`,
      workType: workTypeTop.row.key,
    });
  }

  const embeddingRow = report.byWorkType.find((row) => row.key === "file_embedding");
  const embeddingShare = embeddingRow ? embeddingRow.estimatedMinutes / totalMinutes : 0;
  if (embeddingShare >= config.embeddingShareRatio) {
    warnings.push({
      id: "embedding-heavy-week",
      severity: embeddingShare >= 0.6 ? "watch" : "notice",
      title: "Embedding-heavy week",
      message: "File understanding is a large share of this week’s shadow estimate.",
      reason: `${Math.round(embeddingShare * 100)}% of estimated minutes are file embeddings.`,
      workType: "file_embedding",
      capability: "embedding",
    });
  }

  const employeeTop = topShare(
    report.byEmployee.filter((row) => row.key !== "unknown"),
    totalMinutes,
  );
  if (employeeTop.row && employeeTop.share >= config.employeeConcentrationRatio) {
    const employeeId = employeeTop.row.key;
    const employeeName = options.employeeNames?.[employeeId] ?? employeeId;
    warnings.push({
      id: "employee-concentration",
      severity: employeeTop.share >= 0.75 ? "watch" : "notice",
      title: "Employee concentration",
      message: `Most shadow usage this week is linked to ${employeeName}.`,
      reason: `${Math.round(employeeTop.share * 100)}% of estimated minutes.`,
      employeeId,
    });
  }

  const implied = report.totals.impliedUsdPerWorkMinute;
  const current = report.currentRateUsd;
  if (
    implied != null &&
    implied > 0 &&
    current > 0 &&
    Math.abs(implied - current) / current > config.rateInstabilityRatio
  ) {
    warnings.push({
      id: "calibration-rate-review",
      severity: "info",
      title: "Calibration rate review",
      message: "Calibration rate may need review based on shadow estimate vs usage cost.",
      reason: `Implied $${implied.toFixed(4)}/min vs configured $${current.toFixed(4)}/min.`,
    });
  }

  const validated = warnings.filter((warning) => {
    const copy = `${warning.title} ${warning.message} ${warning.reason}`;
    return assertNoForbiddenWorkHoursCopy(copy);
  });

  return {
    enabled: true,
    qualityPassed: true,
    warnings: validated,
    suppressedReasons: [],
  };
}

export const SOFT_WARNING_UI_COPY = [
  SOFT_WARNING_BADGE,
  SOFT_WARNING_HELPER,
  SOFT_WARNING_QUALITY_NOTE,
  "Soft warnings",
  "Trending high this week based on shadow estimates.",
];
