/**
 * V19.9.1c — Work Hours calibration CLI report.
 *
 * Usage:
 *   npm run report:work-hours:calibration -- --workspaceId=<uuid> --weekStart=2026-07-06
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { getWorkHoursCalibrationReport } from "@/lib/ai/work-hours/calibration";
import { formatWorkTypeLabel } from "@/lib/work-hours/labels";

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value = ""] = token.slice(2).split("=");
    args[key] = value;
  }
  return args;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(4)}`;
}

function skip(reason: string) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

async function main() {
  loadEnvLocalIfPresent();

  const args = parseArgs(process.argv.slice(2));
  if (!args.workspaceId) {
    console.log("Usage: npm run report:work-hours:calibration -- --workspaceId=<uuid> [--weekStart=YYYY-MM-DD]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url) skip("NEXT_PUBLIC_SUPABASE_URL not configured");
  if (!secretKey) skip("SUPABASE_SECRET_KEY not configured");

  const client = createClient(url as string, secretKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const report = await getWorkHoursCalibrationReport({
    workspaceId: args.workspaceId,
    weekStart: args.weekStart,
    client,
  });

  console.log("Work Hours Calibration Report");
  console.log(`Workspace: ${report.workspaceId}`);
  console.log(`Week: ${report.weekStart}`);
  console.log(`Month: ${report.monthStart}`);
  console.log("");

  console.log("Totals:");
  console.log(`- Shadow Work Hours: ${report.totals.estimatedWorkHours.toFixed(2)}`);
  console.log(`- Shadow Work Minutes: ${report.totals.estimatedWorkMinutes.toFixed(2)}`);
  console.log(`- Ledger cost USD: ${formatUsd(report.totals.estimatedCostUsd)}`);
  console.log(`- Usage resolved cost USD: ${formatUsd(report.totals.usageResolvedCostUsd)}`);
  console.log(`- Implied USD / Work Minute: ${formatUsd(report.totals.impliedUsdPerWorkMinute)}`);
  console.log(`- Ledger rows: ${report.totals.ledgerRows}`);
  console.log(`- Usage rows: ${report.totals.usageRows}`);
  console.log("");

  console.log("Suggested rates:");
  console.log(`- Conservative: ${formatUsd(report.suggestedRates.conservativeUsdPerMinute)}`);
  console.log(`- Balanced: ${formatUsd(report.suggestedRates.balancedUsdPerMinute)}`);
  console.log(`- Aggressive: ${formatUsd(report.suggestedRates.aggressiveUsdPerMinute)}`);
  console.log(`- Recommendation: ${report.suggestedRates.recommendation}`);
  console.log("");

  console.log("By work type:");
  if (!report.byWorkType.length) {
    console.log("- (none)");
  } else {
    for (const row of report.byWorkType) {
      console.log(
        `- ${formatWorkTypeLabel(row.key)}: ${row.estimatedMinutes.toFixed(2)} min, median ${row.medianMinutes.toFixed(2)}, p95 ${row.p95Minutes.toFixed(2)}, implied ${formatUsd(row.impliedUsdPerMinute)}`,
      );
    }
  }
  console.log("");

  console.log("Data quality:");
  console.log(`- Rows missing cost: ${report.quality.rowsMissingCost}`);
  console.log(`- Rows missing work unit: ${report.quality.rowsMissingWorkUnit}`);
  console.log(`- Rows missing usage event: ${report.quality.rowsMissingUsageEvent}`);
  console.log(`- Zero-minute rows: ${report.quality.zeroMinuteRows}`);
  console.log(`- Ledger rows without usage match: ${report.quality.ledgerRowsWithoutUsageMatch}`);
  for (const note of report.quality.notes) {
    console.log(`- Note: ${note}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
