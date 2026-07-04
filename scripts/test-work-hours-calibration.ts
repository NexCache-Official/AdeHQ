/**
 * V19.9.1c — Work Hours calibration helper tests.
 *
 * Usage: npm run test:work-hours:calibration
 */

import {
  assertNoForbiddenCalibrationCopy,
  calculateCalibrationQuality,
  calculateCalibrationSummary,
  calculateImpliedUsdPerWorkMinute,
  CALIBRATION_UI_COPY,
  groupCalibrationRows,
  median,
  percentile,
  suggestWorkMinuteUsdRate,
  type CalibrationUsageRow,
} from "@/lib/ai/work-hours/calibration";
import type { ShadowWorkMinutesLedgerRow } from "@/lib/ai/work-hours/ledger";

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

function ledgerRow(partial: Partial<ShadowWorkMinutesLedgerRow> & Pick<ShadowWorkMinutesLedgerRow, "id">): ShadowWorkMinutesLedgerRow {
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

function usageRow(partial: Partial<CalibrationUsageRow> & Pick<CalibrationUsageRow, "id">): CalibrationUsageRow {
  return {
    workspaceId: "ws_test",
    provider: "siliconflow",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.01,
    resolvedCostUsd: 0.01,
    createdAt: "2026-07-06T12:00:00.000Z",
    ...partial,
  };
}

async function main() {
  console.log("AdeHQ Work Hours Calibration — V19.9.1c\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("implied rate calculation: cost / minutes", () => {
    assert(calculateImpliedUsdPerWorkMinute(1, 100) === 0.01, "expected 0.01");
    assert(calculateImpliedUsdPerWorkMinute(0, 100) === null, "zero cost should be null");
    assert(calculateImpliedUsdPerWorkMinute(1, 0) === null, "zero minutes should be null");
  });

  await run("suggested rates return conservative/balanced/aggressive values", () => {
    const rates = suggestWorkMinuteUsdRate({
      impliedUsdPerWorkMinute: 0.012,
      currentRateUsd: 0.01,
      groupRates: [0.011, 0.013],
    });
    assert(rates.balancedUsdPerMinute === 0.012, "balanced should match implied");
    assert(rates.conservativeUsdPerMinute > rates.balancedUsdPerMinute, "conservative should be higher");
    assert(rates.aggressiveUsdPerMinute < rates.balancedUsdPerMinute, "aggressive should be lower");
    assert(rates.recommendation.length > 0, "recommendation should be present");
  });

  await run("median and p95 calculate correctly", () => {
    const values = [1, 2, 3, 4, 20];
    assert(median(values) === 3, "median mismatch");
    assert(percentile(values, 95) === 20, "p95 mismatch");
  });

  await run("grouping by workType/capability/employee/provider", () => {
    const ledgerRows = [
      ledgerRow({
        id: "l1",
        workType: "topic_summary",
        capability: "summarization",
        employeeId: "emp_a",
        providerName: "siliconflow",
        workMinutesEstimated: 2,
        actualCostUsd: 0.02,
      }),
      ledgerRow({
        id: "l2",
        workType: "file_embedding",
        capability: "embedding",
        employeeId: "emp_b",
        providerName: "siliconflow",
        workMinutesEstimated: 1,
        actualCostUsd: 0.01,
      }),
    ];
    const usageRows = [
      usageRow({ id: "u1", capability: "summarization", employeeId: "emp_a", provider: "siliconflow" }),
    ];

    assert(
      groupCalibrationRows({ ledgerRows, usageRows, dimension: "workType" }).length === 2,
      "expected 2 work types",
    );
    assert(
      groupCalibrationRows({ ledgerRows, usageRows, dimension: "capability" }).length === 2,
      "expected 2 capabilities",
    );
    assert(
      groupCalibrationRows({ ledgerRows, usageRows, dimension: "employee" }).length === 2,
      "expected 2 employees",
    );
    assert(
      groupCalibrationRows({ ledgerRows, usageRows, dimension: "provider" }).length === 1,
      "expected 1 provider",
    );
  });

  await run("missing cost increments quality.rowsMissingCost", () => {
    const quality = calculateCalibrationQuality({
      ledgerRows: [
        ledgerRow({ id: "l1", actualCostUsd: undefined, estimatedCostUsd: undefined }),
      ],
      usageRows: [],
      usageIdsWithLedger: new Set(),
      workUnitIdsWithLedger: new Set(),
    });
    assert(quality.rowsMissingCost === 1, "expected missing cost");
  });

  await run("missing links increment work unit / usage event counters", () => {
    const quality = calculateCalibrationQuality({
      ledgerRows: [ledgerRow({ id: "l1", workUnitId: undefined, usageEventId: undefined })],
      usageRows: [usageRow({ id: "u1", workUnitId: undefined })],
      usageIdsWithLedger: new Set(),
      workUnitIdsWithLedger: new Set(),
    });
    assert(quality.rowsMissingWorkUnit === 1, "expected missing work unit");
    assert(quality.rowsMissingUsageEvent === 1, "expected missing usage event");
    assert(quality.usageRowsMissingWorkUnit === 1, "expected usage missing work unit");
    assert(quality.ledgerRowsWithoutUsageMatch === 1, "expected unmatched ledger row");
  });

  await run("empty data returns zero totals and useful notes", () => {
    const totals = calculateCalibrationSummary({ ledgerRows: [], usageRows: [] });
    assert(totals.ledgerRows === 0, "expected zero ledger rows");
    assert(totals.estimatedWorkMinutes === 0, "expected zero minutes");
    assert(totals.impliedUsdPerWorkMinute === null, "expected null implied rate");

    const quality = calculateCalibrationQuality({
      ledgerRows: [],
      usageRows: [],
      usageIdsWithLedger: new Set(),
      workUnitIdsWithLedger: new Set(),
    });
    assert(quality.notes.length >= 2, "expected helpful notes");
  });

  await run("forbidden copy guard for calibration UI/helpers", () => {
    const copy = CALIBRATION_UI_COPY.join("\n");
    assert(assertNoForbiddenCalibrationCopy(copy), `forbidden copy found in:\n${copy}`);
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
