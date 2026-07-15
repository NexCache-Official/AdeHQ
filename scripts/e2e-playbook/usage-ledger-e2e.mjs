/**
 * Verify a normal AI employee reply is billed to the cost ledger and Usage API.
 *
 * Run:
 *   E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-playbook/usage-ledger-e2e.mjs
 *
 * Optional:
 *   E2E_BASE_URL=https://app.adehq.com
 *   E2E_HEADLESS=1
 *   Loads SUPABASE_* from .env.local when present for ledger detail checks.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE = process.env.E2E_BASE_URL || "https://app.adehq.com";
const OUT = "/tmp/adehq-usage-ledger";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const report = {
  bugs: [],
  results: [],
  log: [],
  beforeUsage: null,
  afterUsage: null,
  ledgerRows: [],
  passed: false,
};

const note = (c, m, e = {}) => {
  report.log.push({ c, m, ...e });
  console.log(`[${c}] ${m}`);
};

let shotI = 0;
async function shot(page, label) {
  shotI += 1;
  const f = `${String(shotI).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(SHOTS, f), fullPage: false });
  note("shot", f);
}

async function dismissPicker(page) {
  const overlay = page.locator("div.fixed.inset-0.z-50").first();
  if (!(await overlay.isVisible({ timeout: 1200 }).catch(() => false))) return;
  const rep = overlay.getByText(/RealEstatePros/i).first();
  if (await rep.isVisible().catch(() => false)) await rep.click({ force: true });
  else await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
}

async function fetchUsage(page, workspaceId) {
  return page.evaluate(async (wid) => {
    const res = await fetch(`/api/workspaces/${wid}/usage`, {
      credentials: "include",
    });
    const body = await res.json();
    return { ok: res.ok, status: res.status, body };
  }, workspaceId);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

if (!EMAIL || !PASSWORD) {
  console.error("E2E_EMAIL / E2E_PASSWORD required");
  process.exit(1);
}

const HEADLESS = process.env.E2E_HEADLESS === "1";
const marker = `usage-ledger-${Date.now().toString(36)}`;
const prompt = `Quick ops check (${marker}): in one short sentence, name the best weekday for landlord viewings in Canterbury. No tools, no search — just answer briefly.`;

const browser = await chromium.launch({
  headless: HEADLESS,
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: HEADLESS ? 0 : 35,
});
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|home)/, { timeout: 60000 });
  await dismissPicker(page);
  note("ok", "logged in");

  let wid =
    process.env.E2E_WORKSPACE_ID ||
    process.env.ADEHQ_E2E_WORKSPACE_ID ||
    null;

  if (!wid) {
    const seen = new Set();
    const onReq = (req) => {
      const m = req.url().match(/\/api\/workspaces\/([0-9a-f-]{36})\//i);
      if (m) seen.add(m[1]);
    };
    page.on("request", onReq);
    await page.goto(`${BASE}/settings/usage`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    page.off("request", onReq);
    wid = [...seen][0] || null;
  }

  if (!wid) {
    const sb = supabaseAdmin();
    if (sb) {
      const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      const user = (users?.users || []).find(
        (u) => String(u.email || "").toLowerCase() === EMAIL.toLowerCase(),
      );
      if (user) {
        const { data: membership } = await sb
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();
        wid = membership?.workspace_id ? String(membership.workspace_id) : null;
      }
    }
  }

  if (!wid) throw new Error("Could not resolve workspace id");
  note("ok", `workspace ${wid}`);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await dismissPicker(page);

  // Prefer a hired employee DM (Emily) so the reply is attributed.
  const emily = page.getByText(/Emily Carter/i).first();
  if (await emily.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emily.click();
    note("ok", "opened Emily Carter DM");
  } else {
    await page.getByText(/Sales Outreach/i).first().click();
    await page.waitForTimeout(1000);
    note("ok", "fallback: Sales Outreach room");
  }
  await page.waitForTimeout(1200);
  await shot(page, "chat");

  const before = await fetchUsage(page, wid);
  if (!before.ok) throw new Error(`Usage before failed: ${before.status}`);
  report.beforeUsage = {
    totalWorkHours: before.body.totalWorkHours,
    teamWorkHours: before.body.teamWorkHours,
    employees: (before.body.byEmployeeWorkType || []).map((e) => ({
      label: e.label,
      workHours: e.workHours,
      intelligence: (e.byIntelligence || []).map((i) => ({
        label: i.label,
        workHours: i.workHours,
        workTypes: i.byWorkType,
      })),
    })),
  };
  note("usage-before", JSON.stringify(report.beforeUsage));

  const box = page.getByPlaceholder(/Message/i).first();
  await box.fill(prompt);
  await page.keyboard.press("Enter");
  note("send", prompt);

  // Wait for an AI reply containing a weekday-ish answer or any assistant bubble growth.
  const deadline = Date.now() + 120000;
  let replied = false;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("main, [data-testid='chat'], body").first().innerText();
    if (
      new RegExp(marker, "i").test(bodyText) &&
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|viewing)/i.test(
        bodyText,
      )
    ) {
      replied = true;
      break;
    }
    // Also accept if we see a new employee message after send
    if (
      /Emily|Adrian|Priya|Wren/i.test(bodyText) &&
      /(monday|tuesday|wednesday|thursday|friday|viewing|landlord)/i.test(bodyText) &&
      Date.now() - deadline + 120000 > 15000
    ) {
      replied = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  await shot(page, "after-reply");
  if (!replied) {
    report.bugs.push({ severity: "P1", msg: "No AI reply detected within timeout" });
    note("fail", "no reply");
  } else {
    note("ok", "AI reply detected");
  }

  // Allow ledger write + period rollup
  await page.waitForTimeout(8000);

  const after = await fetchUsage(page, wid);
  if (!after.ok) throw new Error(`Usage after failed: ${after.status}`);
  report.afterUsage = {
    totalWorkHours: after.body.totalWorkHours,
    teamWorkHours: after.body.teamWorkHours,
    employees: (after.body.byEmployeeWorkType || []).map((e) => ({
      label: e.label,
      workHours: e.workHours,
      intelligence: (e.byIntelligence || []).map((i) => ({
        label: i.label,
        workHours: i.workHours,
        workTypes: i.byWorkType,
      })),
    })),
  };
  note("usage-after", JSON.stringify(report.afterUsage));

  const beforeHrs = Number(report.beforeUsage.totalWorkHours || 0);
  const afterHrs = Number(report.afterUsage.totalWorkHours || 0);
  const delta = Math.round((afterHrs - beforeHrs) * 10000) / 10000;
  report.results.push({ check: "usage_delta", beforeHrs, afterHrs, delta });

  if (!(afterHrs >= beforeHrs)) {
    report.bugs.push({
      severity: "P0",
      msg: `Usage total went down or missing: ${beforeHrs} → ${afterHrs}`,
    });
  }
  if (delta <= 0 && replied) {
    report.bugs.push({
      severity: "P0",
      msg: `AI replied but plan usage did not increase (${beforeHrs} → ${afterHrs})`,
    });
  } else if (delta > 0) {
    note("ok", `plan usage increased by ${delta} WH`);
  }

  const hasIntelligence = (report.afterUsage.employees || []).some(
    (e) => Array.isArray(e.intelligence) && e.intelligence.length > 0,
  );
  report.results.push({ check: "intelligence_breakdown_present", hasIntelligence });
  if (!hasIntelligence) {
    report.bugs.push({
      severity: "P1",
      msg: "Usage response missing byIntelligence breakdown for employees",
    });
  } else {
    note("ok", "intelligence breakdown present in usage API");
  }

  // Ledger detail via service role (tokens/model/hours) — never shown to customer UI
  const sb = supabaseAdmin();
  if (sb) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: ledger, error } = await sb
      .from("ai_cost_ledger_entries")
      .select(
        "id, employee_id, work_type, model_id, input_tokens, output_tokens, work_hours_charged, actual_cost_usd, estimated_cost_usd, cost_source, billable_to_workspace, metadata, created_at",
      )
      .eq("workspace_id", wid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      report.bugs.push({ severity: "P1", msg: `Ledger query failed: ${error.message}` });
      note("fail", error.message);
    } else {
      report.ledgerRows = (ledger || []).map((r) => ({
        id: r.id,
        employee_id: r.employee_id,
        work_type: r.work_type,
        model_id: r.model_id,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        work_hours_charged: r.work_hours_charged,
        actual_cost_usd: r.actual_cost_usd,
        estimated_cost_usd: r.estimated_cost_usd,
        cost_source: r.cost_source,
        billable_to_workspace: r.billable_to_workspace,
        intelligenceMode: r.metadata?.intelligenceMode ?? null,
        created_at: r.created_at,
      }));
      note("ledger", `recent rows: ${report.ledgerRows.length}`);
      for (const row of report.ledgerRows.slice(0, 5)) {
        note(
          "ledger-row",
          `${row.work_type} emp=${row.employee_id?.slice(0, 8) ?? "null"} model=${row.model_id ?? "null"} in=${row.input_tokens} out=${row.output_tokens} wh=${row.work_hours_charged} intel=${row.intelligenceMode ?? "n/a"}`,
        );
      }
      const billable = report.ledgerRows.filter(
        (r) => r.billable_to_workspace !== false && Number(r.work_hours_charged) > 0,
      );
      if (billable.length === 0 && replied) {
        report.bugs.push({
          severity: "P0",
          msg: "No recent billable ledger rows with work_hours_charged > 0",
        });
      } else if (billable.length > 0) {
        note("ok", `${billable.length} recent billable ledger row(s)`);
        const withTokens = billable.filter(
          (r) => Number(r.input_tokens) > 0 || Number(r.output_tokens) > 0,
        );
        report.results.push({
          check: "ledger_tokens",
          billable: billable.length,
          withTokens: withTokens.length,
        });
        if (withTokens.length === 0) {
          note(
            "warn",
            "Billable rows exist but none have input/output tokens (may be flat search estimate)",
          );
        } else {
          note("ok", `${withTokens.length} ledger row(s) include token counts`);
        }
      }
    }
  } else {
    note("warn", "No SUPABASE_SECRET_KEY — skipped direct ledger inspection");
  }

  // Usage page smoke
  await page.goto(`${BASE}/settings/usage`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, "usage-page");
  const usageText = await page.locator("body").innerText();
  if (!/Plan usage this period|AI Work Hours/i.test(usageText)) {
    report.bugs.push({ severity: "P1", msg: "Usage page missing plan total heading" });
  }
  if (/intelligence/i.test(usageText)) {
    note("ok", "Usage page shows intelligence labels");
    report.results.push({ check: "usage_page_intelligence", ok: true });
  } else {
    note("warn", "Usage page did not show 'intelligence' text yet (deploy lag?)");
    report.results.push({ check: "usage_page_intelligence", ok: false });
  }

  report.passed = report.bugs.length === 0 && delta > 0;
  note(report.passed ? "PASS" : "FAIL", `bugs=${report.bugs.length} delta=${delta}`);
} catch (err) {
  report.bugs.push({ severity: "P0", msg: err instanceof Error ? err.message : String(err) });
  note("error", report.bugs.at(-1).msg);
  await shot(page, "error").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`\nReport: ${path.join(OUT, "report.json")}`);
  process.exit(report.passed ? 0 : 1);
}
