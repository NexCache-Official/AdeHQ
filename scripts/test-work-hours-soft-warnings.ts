/**
 * V19.9.1d — Work Hours soft warnings tests.
 *
 * Usage: npm run test:work-hours:warnings
 */

import type { WorkHoursCalibrationReport } from "@/lib/ai/work-hours/calibration";
import {
  assertNoForbiddenWorkHoursCopy,
  evaluateWorkHoursSoftWarnings,
  getWorkHoursWarningConfig,
  passesWorkHoursWarningQualityGate,
  SOFT_WARNING_UI_COPY,
  type WorkHoursSoftWarningsResult,
} from "@/lib/ai/work-hours/warnings";

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

function groupRow(
  key: string,
  minutes: number,
): WorkHoursCalibrationReport["byWorkType"][number] {
  return {
    key,
    label: key,
    rows: 10,
    estimatedMinutes: minutes,
    estimatedHours: minutes / 60,
    costUsd: minutes * 0.01,
    usageRows: 10,
    usageCostUsd: minutes * 0.01,
    medianMinutes: minutes / 10,
    p95Minutes: minutes / 5,
    impliedUsdPerMinute: 0.01,
  };
}

function baseReport(
  overrides: Partial<WorkHoursCalibrationReport> = {},
): WorkHoursCalibrationReport {
  const estimatedWorkMinutes = overrides.totals?.estimatedWorkMinutes ?? 600;
  const estimatedWorkHours = estimatedWorkMinutes / 60;

  return {
    workspaceId: "ws_test",
    weekStart: "2026-07-06",
    monthStart: "2026-07-01",
    currentRateUsd: 0.01,
    totals: {
      ledgerRows: 20,
      usageRows: 20,
      estimatedWorkMinutes,
      estimatedWorkHours,
      estimatedCostUsd: estimatedWorkMinutes * 0.01,
      actualCostUsd: estimatedWorkMinutes * 0.01,
      usageResolvedCostUsd: estimatedWorkMinutes * 0.01,
      impliedUsdPerWorkMinute: 0.01,
      ...overrides.totals,
    },
    suggestedRates: {
      conservativeUsdPerMinute: 0.012,
      balancedUsdPerMinute: 0.01,
      aggressiveUsdPerMinute: 0.008,
      recommendation: "Balanced rate matches implied shadow estimate.",
      ...overrides.suggestedRates,
    },
    byWorkType: overrides.byWorkType ?? [
      groupRow("topic_summary", 360),
      groupRow("file_embedding", 240),
    ],
    byCapability: overrides.byCapability ?? [],
    byEmployee: overrides.byEmployee ?? [
      groupRow("emp_a", 360),
      groupRow("emp_b", 240),
    ],
    byProvider: overrides.byProvider ?? [],
    quality: {
      rowsMissingCost: 2,
      rowsMissingWorkUnit: 0,
      rowsMissingUsageEvent: 0,
      zeroMinuteRows: 1,
      usageRowsMissingWorkUnit: 0,
      ledgerRowsWithoutUsageMatch: 4,
      notes: [],
      ...overrides.quality,
    },
    mode: "shadow",
    softWarnings: {
      enabled: true,
      qualityPassed: false,
      warnings: [],
      suppressedReasons: [],
    },
    ...overrides,
  };
}

function assertSoftWarningsShape(result: WorkHoursSoftWarningsResult) {
  assert(typeof result.enabled === "boolean", "enabled must be boolean");
  assert(typeof result.qualityPassed === "boolean", "qualityPassed must be boolean");
  assert(Array.isArray(result.warnings), "warnings must be array");
  assert(Array.isArray(result.suppressedReasons), "suppressedReasons must be array");
  for (const warning of result.warnings) {
    assert(typeof warning.id === "string", "warning.id required");
    assert(["info", "notice", "watch"].includes(warning.severity), "warning.severity invalid");
    assert(typeof warning.title === "string", "warning.title required");
    assert(typeof warning.message === "string", "warning.message required");
    assert(typeof warning.reason === "string", "warning.reason required");
  }
}

async function main() {
  console.log("AdeHQ Work Hours Soft Warnings — V19.9.1d\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("no data: returns no warnings and qualityPassed=false", () => {
    const report = baseReport({
      totals: {
        ledgerRows: 0,
        usageRows: 0,
        estimatedWorkMinutes: 0,
        estimatedWorkHours: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        usageResolvedCostUsd: 0,
        impliedUsdPerWorkMinute: null,
      },
      byWorkType: [],
      byEmployee: [],
      quality: {
        rowsMissingCost: 0,
        rowsMissingWorkUnit: 0,
        rowsMissingUsageEvent: 0,
        zeroMinuteRows: 0,
        usageRowsMissingWorkUnit: 0,
        ledgerRowsWithoutUsageMatch: 0,
        notes: ["No shadow ledger rows for this week."],
      },
    });
    const result = evaluateWorkHoursSoftWarnings(report);
    assertSoftWarningsShape(result);
    assert(result.enabled, "warnings feature should be enabled by default");
    assert(!result.qualityPassed, "quality gate should fail with no data");
    assert(result.warnings.length === 0, "expected no warnings");
    assert(result.suppressedReasons.length > 0, "expected suppression reasons");
  });

  await run("low quality: warnings suppressed with reasons", () => {
    const report = baseReport({
      totals: {
        ledgerRows: 5,
        usageRows: 5,
        estimatedWorkMinutes: 120,
        estimatedWorkHours: 2,
        estimatedCostUsd: 1.2,
        actualCostUsd: 1.2,
        usageResolvedCostUsd: 1.2,
        impliedUsdPerWorkMinute: 0.01,
      },
      quality: {
        rowsMissingCost: 3,
        rowsMissingWorkUnit: 0,
        rowsMissingUsageEvent: 0,
        zeroMinuteRows: 2,
        usageRowsMissingWorkUnit: 0,
        ledgerRowsWithoutUsageMatch: 4,
        notes: [],
      },
    });
    const gate = passesWorkHoursWarningQualityGate(report);
    assert(!gate.passed, "expected quality gate failure");
    const result = evaluateWorkHoursSoftWarnings(report);
    assert(!result.qualityPassed, "qualityPassed should be false");
    assert(result.warnings.length === 0, "warnings should be suppressed");
    assert(result.suppressedReasons.length > 0, "expected suppression reasons");
  });

  await run("high weekly estimated usage: returns advisory warning", () => {
    const report = baseReport({
      totals: {
        ledgerRows: 20,
        usageRows: 20,
        estimatedWorkMinutes: 660,
        estimatedWorkHours: 11,
        estimatedCostUsd: 6.6,
        actualCostUsd: 6.6,
        usageResolvedCostUsd: 6.6,
        impliedUsdPerWorkMinute: 0.01,
      },
      byWorkType: [groupRow("topic_summary", 660)],
      byEmployee: [groupRow("emp_a", 660)],
    });
    const result = evaluateWorkHoursSoftWarnings(report);
    assert(result.qualityPassed, "quality gate should pass");
    const warning = result.warnings.find((item) => item.id === "high-weekly-usage");
    assert(Boolean(warning), "expected high weekly usage warning");
    assert(
      warning!.message.includes("shadow estimate"),
      "message should mention shadow estimate",
    );
  });

  await run("concentrated work type: returns work-type warning", () => {
    const report = baseReport({
      byWorkType: [groupRow("topic_summary", 540), groupRow("file_embedding", 60)],
    });
    const result = evaluateWorkHoursSoftWarnings(report);
    const warning = result.warnings.find((item) => item.id === "concentrated-work-type");
    assert(Boolean(warning), "expected concentrated work type warning");
    assert(warning!.workType === "topic_summary", "expected topic_summary work type");
  });

  await run("embedding-heavy week: returns embedding warning", () => {
    const report = baseReport({
      byWorkType: [groupRow("file_embedding", 360), groupRow("topic_summary", 240)],
    });
    const result = evaluateWorkHoursSoftWarnings(report);
    const warning = result.warnings.find((item) => item.id === "embedding-heavy-week");
    assert(Boolean(warning), "expected embedding-heavy warning");
    assert(warning!.workType === "file_embedding", "expected file_embedding work type");
  });

  await run("employee concentration: returns employee warning", () => {
    const report = baseReport({
      byEmployee: [groupRow("emp_a", 540), groupRow("emp_b", 60)],
    });
    const result = evaluateWorkHoursSoftWarnings(
      report,
      { employeeNames: { emp_a: "Maya" } },
    );
    const warning = result.warnings.find((item) => item.id === "employee-concentration");
    assert(Boolean(warning), "expected employee concentration warning");
    assert(warning!.message.includes("Maya"), "expected employee name in message");
  });

  await run("rate instability: returns calibration review warning", () => {
    const report = baseReport({
      totals: {
        ledgerRows: 20,
        usageRows: 20,
        estimatedWorkMinutes: 600,
        estimatedWorkHours: 10,
        estimatedCostUsd: 9,
        actualCostUsd: 9,
        usageResolvedCostUsd: 9,
        impliedUsdPerWorkMinute: 0.015,
      },
    });
    const result = evaluateWorkHoursSoftWarnings(report);
    const warning = result.warnings.find((item) => item.id === "calibration-rate-review");
    assert(Boolean(warning), "expected calibration rate review warning");
    assert(warning!.severity === "info", "expected info severity");
  });

  await run("forbidden copy: no warning contains billing/limit language", () => {
    const scenarios = [
      baseReport({
        totals: {
          ledgerRows: 20,
          usageRows: 20,
          estimatedWorkMinutes: 720,
          estimatedWorkHours: 12,
          estimatedCostUsd: 7.2,
          actualCostUsd: 7.2,
          usageResolvedCostUsd: 7.2,
          impliedUsdPerWorkMinute: 0.015,
        },
        byWorkType: [groupRow("file_embedding", 720)],
        byEmployee: [groupRow("emp_a", 720)],
      }),
    ];

    const uiCopy = SOFT_WARNING_UI_COPY.join("\n");
    assert(assertNoForbiddenWorkHoursCopy(uiCopy), `forbidden copy in UI helpers:\n${uiCopy}`);

    for (const report of scenarios) {
      const result = evaluateWorkHoursSoftWarnings(report, { employeeNames: { emp_a: "Maya" } });
      for (const warning of result.warnings) {
        const copy = `${warning.title} ${warning.message} ${warning.reason}`;
        assert(assertNoForbiddenWorkHoursCopy(copy), `forbidden copy in warning:\n${copy}`);
      }
    }
  });

  await run("endpoint shape: softWarnings included in calibration response helper shape", () => {
    const report = baseReport();
    const result = evaluateWorkHoursSoftWarnings(report);
    report.softWarnings = result;
    assertSoftWarningsShape(report.softWarnings);
    assert("softWarnings" in report, "report should include softWarnings");
  });

  await run("disabled env: AI_WORK_HOURS_SOFT_WARNINGS_ENABLED=false returns enabled=false", () => {
    const previous = process.env.AI_WORK_HOURS_SOFT_WARNINGS_ENABLED;
    process.env.AI_WORK_HOURS_SOFT_WARNINGS_ENABLED = "false";
    try {
      const config = getWorkHoursWarningConfig();
      assert(!config.enabled, "config.enabled should be false");
      const result = evaluateWorkHoursSoftWarnings(baseReport(), { config });
      assert(!result.enabled, "result.enabled should be false");
      assert(result.warnings.length === 0, "expected no warnings when disabled");
    } finally {
      if (previous === undefined) delete process.env.AI_WORK_HOURS_SOFT_WARNINGS_ENABLED;
      else process.env.AI_WORK_HOURS_SOFT_WARNINGS_ENABLED = previous;
    }
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
