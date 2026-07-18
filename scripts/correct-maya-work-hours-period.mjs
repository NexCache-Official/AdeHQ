#!/usr/bin/env node
/**
 * One-shot ops: subtract Maya-attributed Work Hours already charged into the
 * current open workspace_usage_periods rows, and mark those ledger rows
 * non-billable going forward for consistency.
 *
 * Usage (from repo root, with service role in env):
 *   node scripts/correct-maya-work-hours-period.mjs
 *   node scripts/correct-maya-work-hours-period.mjs --dry-run
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const MAYA_ID = "emp-maya";
const MAYA_KEYS = new Set(["maya_recruiting_manager", "maya"]);
const HIRING_TYPES = new Set(["hiring_recruiter", "hiring_candidates"]);
const dryRun = process.argv.includes("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });

function isMayaEntry(row, mayaIds) {
  const emp = row.employee_id ? String(row.employee_id) : "";
  const wt = (row.work_type ?? "").trim().toLowerCase();
  if (emp === MAYA_ID || mayaIds.has(emp)) return true;
  if (HIRING_TYPES.has(wt)) return true;
  return false;
}

async function main() {
  const now = new Date().toISOString();
  const { data: periods, error: periodErr } = await client
    .from("workspace_usage_periods")
    .select("id, workspace_id, period_start, period_end, ai_work_hours_used, actual_cost_usd")
    .lte("period_start", now)
    .gt("period_end", now);
  if (periodErr) throw periodErr;

  console.log(`Open periods: ${(periods ?? []).length}${dryRun ? " (dry-run)" : ""}`);

  for (const period of periods ?? []) {
    const { data: employees } = await client
      .from("ai_employees")
      .select("id, system_employee_key")
      .eq("workspace_id", period.workspace_id);
    const mayaIds = new Set(
      (employees ?? [])
        .filter(
          (e) =>
            e.id === MAYA_ID ||
            MAYA_KEYS.has(String(e.system_employee_key ?? "")),
        )
        .map((e) => String(e.id)),
    );
    mayaIds.add(MAYA_ID);

    const { data: ledger, error: ledgerErr } = await client
      .from("ai_cost_ledger_entries")
      .select(
        "id, employee_id, work_type, work_hours_charged, actual_cost_usd, estimated_cost_usd, billable_to_workspace",
      )
      .eq("workspace_id", period.workspace_id)
      .gte("created_at", period.period_start)
      .lt("created_at", period.period_end)
      .limit(5000);
    if (ledgerErr) throw ledgerErr;

    let mayaHours = 0;
    let mayaCost = 0;
    const mayaRowIds = [];
    for (const row of ledger ?? []) {
      if (!isMayaEntry(row, mayaIds)) continue;
      if (row.billable_to_workspace === false) continue;
      const hours = Number(row.work_hours_charged ?? 0);
      const cost = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
      if (hours > 0 || cost > 0) {
        mayaHours += hours > 0 ? hours : 0;
        mayaCost += cost > 0 ? cost : 0;
        mayaRowIds.push(row.id);
      }
    }

    if (mayaHours <= 0 && mayaRowIds.length === 0) {
      console.log(`  ${period.workspace_id}: nothing to correct`);
      continue;
    }

    const nextUsed = Math.max(0, Number(period.ai_work_hours_used ?? 0) - mayaHours);
    const nextCost = Math.max(0, Number(period.actual_cost_usd ?? 0) - mayaCost);

    console.log(
      `  ${period.workspace_id}: refund ${mayaHours.toFixed(4)} WH / $${mayaCost.toFixed(6)} ` +
        `(${mayaRowIds.length} ledger rows) → used ${nextUsed.toFixed(4)}`,
    );

    if (dryRun) continue;

    if (mayaRowIds.length) {
      const { error: markErr } = await client
        .from("ai_cost_ledger_entries")
        .update({
          billable_to_workspace: false,
          platform_overhead: true,
          work_hours_charged: 0,
        })
        .in("id", mayaRowIds);
      if (markErr) throw markErr;
    }

    const { error: updErr } = await client
      .from("workspace_usage_periods")
      .update({
        ai_work_hours_used: nextUsed,
        actual_cost_usd: nextCost,
      })
      .eq("id", period.id);
    if (updErr) throw updErr;
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
