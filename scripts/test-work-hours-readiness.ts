/**
 * V19.9.1e — Work Hours readiness audit tests.
 *
 * Usage: npm run test:work-hours:readiness
 */

import {
  calculateCalibrationQuality,
  calculateCalibrationSummary,
  groupCalibrationRows,
  suggestWorkMinuteUsdRate,
  type CalibrationUsageRow,
  type WorkHoursCalibrationReport,
} from "@/lib/ai/work-hours/calibration";
import { WORK_HOURS_SHADOW_MODE } from "@/lib/ai/work-hours/constants";
import type { ShadowWorkMinutesLedgerRow } from "@/lib/ai/work-hours/ledger";
import {
  assertNoForbiddenReadinessCopy,
  evaluateHardLimitReadiness,
  calculateReadinessScore,
  getWorkHoursReadinessConfig,
  READINESS_UI_COPY,
  type WorkHoursReadinessAudit,
} from "@/lib/ai/work-hours/readiness";
import { evaluateWorkHoursSoftWarnings } from "@/lib/ai/work-hours/warnings";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

function ledgerRow(
  partial: Partial<ShadowWorkMinutesLedgerRow> & Pick<ShadowWorkMinutesLedgerRow, "id">,
): ShadowWorkMinutesLedgerRow {
  return {
    workspaceId: "ws_test",
    sourceType: "topic_summary",
    workMinutesEstimated: 1,
    workMinutesCharged: null,
    billingWeekStart: "2026-07-06",
    billingMonthStart: "2026-07-01",
    mode: "shadow",
    metadata: {},
    createdAt: "2026-07-06T12:00:00.000Z",
    ...partial,
  };
}

function buildReportFromLedger(
  ledgerRows: ShadowWorkMinutesLedgerRow[],
  currentRateUsd = 0.01,
): WorkHoursCalibrationReport {
  const usageRows: CalibrationUsageRow[] = ledgerRows
    .filter((row) => row.workUnitId)
    .map((row) => ({
      id: row.usageEventId ?? `usage_${row.id}`,
      workspaceId: row.workspaceId,
      employeeId: row.employeeId,
      provider: row.providerName ?? "siliconflow",
      model: "deepseek-ai/DeepSeek-V4-Flash",
      capability: row.capability,
      workUnitId: row.workUnitId,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: row.estimatedCostUsd ?? 0.02,
      actualCostUsd: row.actualCostUsd,
      resolvedCostUsd: row.actualCostUsd ?? row.estimatedCostUsd ?? 0.02,
      createdAt: row.createdAt,
    }));

  const totals = calculateCalibrationSummary({ ledgerRows, usageRows });
  const byWorkType = groupCalibrationRows({ ledgerRows, usageRows, dimension: "workType" });
  const usageIdsWithLedger = new Set(
    ledgerRows.map((row) => row.usageEventId).filter(Boolean) as string[],
  );
  const workUnitIdsWithUsage = new Set(
    usageRows.map((row) => row.workUnitId).filter(Boolean) as string[],
  );
  const quality = calculateCalibrationQuality({
    ledgerRows,
    usageRows,
    usageIdsWithLedger,
    workUnitIdsWithLedger: workUnitIdsWithUsage,
  });
  const suggestedRates = suggestWorkMinuteUsdRate({
    impliedUsdPerWorkMinute: totals.impliedUsdPerWorkMinute,
    currentRateUsd,
    groupRates: byWorkType
      .map((row) => row.impliedUsdPerMinute)
      .filter((rate): rate is number => rate != null && rate > 0),
  });

  const base = {
    workspaceId: "ws_test",
    weekStart: "2026-07-06",
    monthStart: "2026-07-01",
    currentRateUsd,
    totals,
    suggestedRates,
    byWorkType,
    byCapability: groupCalibrationRows({ ledgerRows, usageRows, dimension: "capability" }),
    byEmployee: groupCalibrationRows({ ledgerRows, usageRows, dimension: "employee" }),
    byProvider: groupCalibrationRows({ ledgerRows, usageRows, dimension: "provider" }),
    quality,
    mode: WORK_HOURS_SHADOW_MODE,
  };

  return {
    ...base,
    softWarnings: evaluateWorkHoursSoftWarnings(base),
  };
}

function makeHealthyLedger(count: number): ShadowWorkMinutesLedgerRow[] {
  return Array.from({ length: count }, (_, index) =>
    ledgerRow({
      id: `healthy_${index}`,
      workType: index % 5 === 0 ? "file_embedding" : "topic_summary",
      employeeId: index % 3 === 0 ? "emp_a" : "emp_b",
      workMinutesEstimated: 2,
      actualCostUsd: 0.02,
      estimatedCostUsd: 0.02,
      workUnitId: `wu_${index}`,
      usageEventId: `ue_${index}`,
    }),
  );
}

function assertAuditShape(audit: WorkHoursReadinessAudit) {
  assert(audit.mode === "readiness_audit", "mode must be readiness_audit");
  assert(typeof audit.verdict === "string", "verdict required");
  assert(audit.score >= 0 && audit.score <= 100, "score out of range");
  assert(typeof audit.gates.enoughLedgerRows === "boolean", "gates.enoughLedgerRows required");
  assert(typeof audit.metrics.ledgerRows === "number", "metrics.ledgerRows required");
  assert(Array.isArray(audit.risks), "risks must be array");
  assert(Array.isArray(audit.recommendations), "recommendations must be array");
  assert(typeof audit.nextStep === "string", "nextStep required");
  assert(audit.verdict !== ("ready_for_hard_limits" as never), "must not expose hard limit readiness");
}

async function main() {
  console.log("AdeHQ Work Hours Readiness — V19.9.1e\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  const config = getWorkHoursReadinessConfig();

  await run("empty data: verdict = needs_more_data or not_ready, no crash", () => {
    const report = buildReportFromLedger([]);
    const audit = evaluateHardLimitReadiness({ report, config });
    assertAuditShape(audit);
    assert(
      audit.verdict === "needs_more_data" || audit.verdict === "not_ready",
      `unexpected verdict: ${audit.verdict}`,
    );
  });

  await run("poor linkage: fails linkage gate and creates risk", () => {
    const rows = makeHealthyLedger(60).map((row, index) =>
      index < 30 ? { ...row, usageEventId: undefined, workUnitId: undefined } : row,
    );
    const report = buildReportFromLedger(rows);
    report.totals.usageRows = 40;
    const audit = evaluateHardLimitReadiness({ report, config });
    assert(!audit.gates.linkageQualityOk, "expected linkage gate failure");
    assert(
      audit.risks.some((risk) => risk.id === "poor-usage-linkage"),
      "expected linkage risk",
    );
  });

  await run("missing cost: fails missing cost gate and creates risk", () => {
    const rows = makeHealthyLedger(60).map((row, index) =>
      index < 20
        ? { ...row, actualCostUsd: undefined, estimatedCostUsd: undefined }
        : row,
    );
    const report = buildReportFromLedger(rows);
    report.totals.usageRows = 40;
    const audit = evaluateHardLimitReadiness({ report, config });
    assert(!audit.gates.missingCostOk, "expected missing cost gate failure");
    assert(
      audit.risks.some((risk) => risk.id === "missing-cost-data"),
      "expected missing cost risk",
    );
  });

  await run("unstable rate: fails rate stability gate and recommends tuning AI_WORK_MINUTE_USD", () => {
    const rows = makeHealthyLedger(60).map((row) => ({
      ...row,
      workMinutesEstimated: 1,
      actualCostUsd: 0.02,
      estimatedCostUsd: 0.02,
    }));
    const report = buildReportFromLedger(rows, 0.01);
    report.totals.usageRows = 40;
    const audit = evaluateHardLimitReadiness({ report, config });
    assert(!audit.gates.rateStabilityOk, "expected rate stability gate failure");
    assert(
      audit.recommendations.some((item) => item.includes("AI_WORK_MINUTE_USD")),
      "expected rate tuning recommendation",
    );
  });

  await run("concentration outlier: creates outlier risk when one work type dominates", () => {
    const rows = makeHealthyLedger(60).map((row, index) =>
      index < 50
        ? { ...row, workType: "file_embedding", employeeId: "emp_a" }
        : { ...row, workType: "topic_summary", employeeId: "emp_b" },
    );
    const report = buildReportFromLedger(rows);
    report.totals.usageRows = 40;
    const audit = evaluateHardLimitReadiness({ report, config });
    assert(!audit.gates.noExtremeOutliers, "expected outlier gate failure");
    assert(
      audit.risks.some((risk) => risk.id === "work-type-concentration"),
      "expected work type concentration risk",
    );
  });

  await run("good data: verdict = ready_for_internal_simulation", () => {
    const rows = makeHealthyLedger(60);
    const report = buildReportFromLedger(rows);
    report.totals.usageRows = 40;
    report.softWarnings = evaluateWorkHoursSoftWarnings(report);
    const audit = evaluateHardLimitReadiness({ report, config });
    assert(audit.verdict === "ready_for_internal_simulation", `expected ready verdict, got ${audit.verdict}`);
    assert(Object.values(audit.gates).every(Boolean), "expected all gates to pass");
  });

  await run("score range: score always between 0 and 100", () => {
    const scenarios = [
      buildReportFromLedger([]),
      buildReportFromLedger(makeHealthyLedger(5)),
      buildReportFromLedger(makeHealthyLedger(60)),
    ];
    for (const report of scenarios) {
      const audit = evaluateHardLimitReadiness({ report, config });
      assert(audit.score >= 0 && audit.score <= 100, `score out of range: ${audit.score}`);
      const direct = calculateReadinessScore({ gates: audit.gates, risks: audit.risks });
      assert(direct >= 0 && direct <= 100, `direct score out of range: ${direct}`);
    }
  });

  await run("next step: returns expected follow-up actions", () => {
    const lowData = evaluateHardLimitReadiness({
      report: buildReportFromLedger(makeHealthyLedger(5)),
      config,
    });
    assert(lowData.nextStep === "collect_more_data", "expected collect_more_data");

    const linkageRows = makeHealthyLedger(60).map((row) => ({
      ...row,
      usageEventId: undefined,
      workUnitId: undefined,
    }));
    const linkage = evaluateHardLimitReadiness({
      report: buildReportFromLedger(linkageRows),
      config,
    });
    assert(linkage.nextStep === "improve_usage_linkage", "expected improve_usage_linkage");

    const rateRows = makeHealthyLedger(60).map((row) => ({
      ...row,
      workMinutesEstimated: 1,
      actualCostUsd: 0.03,
      estimatedCostUsd: 0.03,
    }));
    const rateReport = buildReportFromLedger(rateRows, 0.01);
    rateReport.totals.usageRows = 40;
    const rateAudit = evaluateHardLimitReadiness({ report: rateReport, config });
    assert(
      rateAudit.nextStep === "tune_work_minute_rate" || rateAudit.nextStep === "improve_usage_linkage",
      `unexpected next step: ${rateAudit.nextStep}`,
    );

    const good = evaluateHardLimitReadiness({
      report: (() => {
        const report = buildReportFromLedger(makeHealthyLedger(60));
        report.totals.usageRows = 40;
        return report;
      })(),
      config,
    });
    if (good.verdict === "ready_for_internal_simulation") {
      assert(
        good.nextStep === "ready_for_soft_cap_simulation",
        "expected ready_for_soft_cap_simulation",
      );
    }
  });

  await run("forbidden copy: UI/report strings avoid billing/enforcement language", () => {
    const copy = READINESS_UI_COPY.join("\n");
    assert(assertNoForbiddenReadinessCopy(copy), `forbidden copy in UI helpers:\n${copy}`);

    const audit = evaluateHardLimitReadiness({
      report: buildReportFromLedger(makeHealthyLedger(60)),
      config,
    });
    const reportCopy = [
      ...audit.risks.map((risk) => `${risk.title} ${risk.message}`),
      ...audit.recommendations,
    ].join("\n");
    assert(assertNoForbiddenReadinessCopy(reportCopy), `forbidden copy in audit output:\n${reportCopy}`);
  });

  await run("endpoint shape: readiness response contains required fields", () => {
    const audit = evaluateHardLimitReadiness({
      report: buildReportFromLedger(makeHealthyLedger(10)),
      config,
    });
    assertAuditShape(audit);
    assert("gates" in audit, "gates missing");
    assert("metrics" in audit, "metrics missing");
    assert("recommendations" in audit, "recommendations missing");
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
