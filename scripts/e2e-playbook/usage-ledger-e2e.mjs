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
    // Match app authHeaders(): Bearer from supabase session, not cookies alone.
    let token = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.includes("auth-token")) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        token =
          parsed?.access_token ||
          parsed?.currentSession?.access_token ||
          parsed?.session?.access_token ||
          null;
        if (token) break;
      } catch {
        /* continue */
      }
    }
    if (!token && typeof window !== "undefined") {
      // supabase-js v2 often stores under sb-*-auth-token
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-")) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "{}");
          token = parsed?.access_token || parsed?.currentSession?.access_token || null;
          if (token) break;
        } catch {
          /* continue */
        }
      }
    }
    const headers = token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
    const res = await fetch(`/api/workspaces/${wid}/usage`, {
      credentials: "include",
      headers,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body, hasToken: Boolean(token) };
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
const testStartedAt = new Date().toISOString();
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

  // Open Emily Carter DM from the Direct messages list (not room mentions).
  const emilyDm = page
    .locator("aside, nav")
    .getByText(/^Emily Carter$/i)
    .first();
  if (await emilyDm.isVisible({ timeout: 8000 }).catch(() => false)) {
    await emilyDm.click();
    note("ok", "opened Emily Carter DM");
  } else {
    // Sidebar row may include status text — broader match under Direct messages.
    const emilyRow = page.getByText(/Emily Carter/i).first();
    await emilyRow.click();
    note("ok", "opened Emily Carter (broad match)");
  }
  await page.waitForTimeout(1500);
  await shot(page, "chat");

  const before = await fetchUsage(page, wid);
  if (!before.ok) {
    throw new Error(
      `Usage before failed: ${before.status} hasToken=${before.hasToken} ${JSON.stringify(before.body).slice(0, 200)}`,
    );
  }
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

  // Prefer Balanced chip when present (conversation mode UI).
  const balancedChip = page.getByRole("button", { name: /^Balanced$/i }).first();
  if (await balancedChip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await balancedChip.click();
    note("ok", "selected Balanced mode chip");
  }

  const box = page.getByPlaceholder(/Message/i).first();
  await box.click();
  await box.fill("");
  await box.fill(prompt);
  // Prefer explicit send control — Enter can be swallowed by mention/slash popovers.
  const sendBtn = page.getByRole("button", { name: /Send message/i }).first();
  if (await sendBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    await sendBtn.click();
  } else {
    await box.press("Enter");
  }
  note("send", prompt);

  // Confirm composer cleared and marker appears outside the textarea.
  const sendDeadline = Date.now() + 25000;
  let sentVisible = false;
  while (Date.now() < sendDeadline) {
    const composerVal = await box.inputValue().catch(() => prompt);
    const bubbleText = await page
      .locator("main")
      .evaluate((root, m) => {
        const areas = root.querySelectorAll("textarea");
        let text = root.innerText || "";
        for (const area of areas) {
          if (area.value) text = text.replace(area.value, "");
        }
        return text.includes(m);
      }, marker)
      .catch(() => false);
    if (composerVal.trim() === "" && bubbleText) {
      sentVisible = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  await shot(page, "after-send");
  if (!sentVisible) {
    report.bugs.push({
      severity: "P0",
      msg: "Outbound message with marker never appeared in chat (composer may not have submitted)",
    });
    throw new Error("Outbound message not visible — aborting usage check");
  }
  note("ok", "outbound message visible in transcript");

  // Wait until our bubble leaves "Sending...", then for Emily text after the marker.
  const deadline = Date.now() + 150000;
  let replied = false;
  while (Date.now() < deadline) {
    const stillSending = await page
      .getByText(marker)
      .locator("xpath=ancestor::*[contains(., 'Sending')][1]")
      .isVisible()
      .catch(() => false);
    const mainText = await page.locator("main").innerText().catch(() => "");
    const idx = mainText.lastIndexOf(marker);
    if (idx >= 0 && !stillSending && !/Sending\.\.\./i.test(mainText.slice(idx))) {
      const after = mainText.slice(idx + marker.length);
      // New AI bubble after our send — require weekday answer near Emily.
      if (
        /Emily Carter/i.test(after) &&
        /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(after)
      ) {
        replied = true;
        break;
      }
    }
    await page.waitForTimeout(2500);
  }
  await shot(page, "after-reply");
  if (!replied) {
    report.bugs.push({ severity: "P1", msg: "No AI reply detected after marker within timeout" });
    note("fail", "no reply");
  } else {
    note("ok", "AI reply detected after marker (send finished)");
  }

  // Poll usage until delta appears (ledger write can lag a few seconds).
  let after = null;
  const pollDeadline = Date.now() + 90000;
  while (Date.now() < pollDeadline) {
    after = await fetchUsage(page, wid);
    if (after.ok) {
      const b = Number(report.beforeUsage.totalWorkHours || 0);
      const a = Number(after.body.totalWorkHours || 0);
      if (a > b + 0.0001) break;
    }
    await page.waitForTimeout(4000);
  }

  if (!after?.ok) throw new Error(`Usage after failed: ${after?.status}`);
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
  let ledgerOk = false;
  const sb = supabaseAdmin();
  if (sb) {
    const { data: ledger, error } = await sb
      .from("ai_cost_ledger_entries")
      .select(
        "id, employee_id, work_type, model_id, input_tokens, output_tokens, work_hours_charged, actual_cost_usd, estimated_cost_usd, cost_source, billable_to_workspace, metadata, created_at",
      )
      .eq("workspace_id", wid)
      .gte("created_at", testStartedAt)
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
        (r) =>
          r.billable_to_workspace !== false &&
          Number(r.work_hours_charged) > 0 &&
          String(r.work_type || "").includes("employee"),
      );
      const withTokens = billable.filter(
        (r) => Number(r.input_tokens) > 0 || Number(r.output_tokens) > 0,
      );
      report.results.push({
        check: "ledger_tokens",
        billable: billable.length,
        withTokens: withTokens.length,
      });
      if (withTokens.length === 0 && replied) {
        report.bugs.push({
          severity: "P0",
          msg: "No recent employee ledger rows with tokens + work hours",
        });
      } else if (withTokens.length > 0) {
        ledgerOk = true;
        note("ok", `${withTokens.length} employee ledger row(s) with tokens + hours`);
        // Refresh usage once ledger is confirmed (display is 2dp; period may lag a beat).
        after = await fetchUsage(page, wid);
        if (after.ok) {
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
          note("usage-after-ledger", JSON.stringify(report.afterUsage));
        }
      }
    }
  } else {
    note("warn", "No SUPABASE_SECRET_KEY — skipped direct ledger inspection");
  }

  const afterHrsFinal = Number(report.afterUsage.totalWorkHours || 0);
  const deltaFinal = Math.round((afterHrsFinal - beforeHrs) * 10000) / 10000;
  report.results.push({
    check: "usage_delta_final",
    beforeHrs,
    afterHrs: afterHrsFinal,
    delta: deltaFinal,
  });
  if (deltaFinal > 0) {
    note("ok", `plan usage increased by ${deltaFinal} WH`);
  } else if (ledgerOk) {
    // Tiny charges can round into the same 0.00 display; ledger proof is enough.
    note(
      "ok",
      `ledger billed employee tokens/hours; displayed Usage stayed ${beforeHrs} (2dp rounding)`,
    );
  } else if (replied) {
    report.bugs.push({
      severity: "P0",
      msg: `AI replied but plan usage did not increase (${beforeHrs} → ${afterHrsFinal}) and ledger missing`,
    });
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

  report.passed = report.bugs.length === 0 && (deltaFinal > 0 || ledgerOk);
  note(
    report.passed ? "PASS" : "FAIL",
    `bugs=${report.bugs.length} delta=${deltaFinal} ledgerOk=${ledgerOk}`,
  );
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
