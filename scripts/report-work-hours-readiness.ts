/**
 * V19.9.1e — Work Hours readiness CLI report.
 *
 * Usage:
 *   npm run report:work-hours:readiness -- --workspaceId=<uuid> --weekStart=2026-07-06
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  getWorkHoursReadinessAudit,
  nextStepLabel,
  verdictLabel,
} from "@/lib/ai/work-hours/readiness";

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

function skip(reason: string) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

function gateLabel(passed: boolean): string {
  return passed ? "pass" : "fail";
}

async function main() {
  loadEnvLocalIfPresent();

  const args = parseArgs(process.argv.slice(2));
  if (!args.workspaceId) {
    console.log(
      "Usage: npm run report:work-hours:readiness -- --workspaceId=<uuid> [--weekStart=YYYY-MM-DD]",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) skip("NEXT_PUBLIC_SUPABASE_URL not configured");
  if (!serviceKey) skip("SUPABASE_SERVICE_ROLE_KEY not configured");

  const client = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const audit = await getWorkHoursReadinessAudit({
    workspaceId: args.workspaceId,
    weekStart: args.weekStart,
    client,
  });

  console.log("Work Hours Readiness Audit");
  console.log(`Workspace: ${audit.workspaceId}`);
  console.log(`Week: ${audit.weekStart}`);
  console.log("");

  console.log(`Verdict: ${verdictLabel(audit.verdict)}`);
  console.log(`Score: ${audit.score}/100`);
  console.log("");

  console.log("Gates:");
  console.log(`- enough ledger rows: ${gateLabel(audit.gates.enoughLedgerRows)}`);
  console.log(`- enough usage rows: ${gateLabel(audit.gates.enoughUsageRows)}`);
  console.log(`- usage linkage: ${gateLabel(audit.gates.linkageQualityOk)}`);
  console.log(`- missing cost coverage: ${gateLabel(audit.gates.missingCostOk)}`);
  console.log(`- rate stability: ${gateLabel(audit.gates.rateStabilityOk)}`);
  console.log(`- soft warnings stable: ${gateLabel(audit.gates.softWarningsStable)}`);
  console.log(`- no extreme outliers: ${gateLabel(audit.gates.noExtremeOutliers)}`);
  console.log("");

  console.log("Metrics:");
  console.log(`- ledger rows: ${audit.metrics.ledgerRows}`);
  console.log(`- usage rows: ${audit.metrics.usageRows}`);
  console.log(`- estimated shadow hours: ${audit.metrics.estimatedWorkHours.toFixed(2)}`);
  console.log(`- unmatched ledger ratio: ${(audit.metrics.ledgerRowsWithoutUsageMatchRatio * 100).toFixed(1)}%`);
  console.log(`- missing cost ratio: ${(audit.metrics.rowsMissingCostRatio * 100).toFixed(1)}%`);
  console.log("");

  console.log("Risks:");
  if (!audit.risks.length) {
    console.log("- (none)");
  } else {
    for (const risk of audit.risks) {
      console.log(`- [${risk.severity}] ${risk.title}: ${risk.message}`);
    }
  }
  console.log("");

  console.log("Recommendations:");
  for (const item of audit.recommendations) {
    console.log(`- ${item}`);
  }
  console.log("");

  console.log(`Next step: ${nextStepLabel(audit.nextStep)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
