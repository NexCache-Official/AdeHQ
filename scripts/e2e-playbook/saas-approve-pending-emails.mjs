/**
 * Approve all pending Casey send-email cards on /approvals for SaaS Company 1.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-approve-all";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const SHELL_MS = 60_000;
let i = 0;
const note = (c, m) => console.log(`[${c}] ${m}`);
async function shot(page, label) {
  i += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(i).padStart(2, "0")}-${label}.png`) }).catch(() => {});
  note("shot", label);
}
async function waitShell(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    const loading = await page.getByText(/Loading workspace|Loading…|Loading\.\.\./i).first().isVisible().catch(() => false);
    if (!loading) break;
    await page.waitForTimeout(1500);
  }
}

const browser = await chromium.launch({ headless: false, channel: process.env.E2E_CHANNEL || "chrome", slowMo: 40 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox|approvals)/, { timeout: SHELL_MS });
  await waitShell(page);

  // Land on SaaS
  const rail = await page.locator("aside").innerText().catch(() => "");
  if (!/SaaS Company 1/i.test(rail)) {
    await page.locator("aside").locator("button").first().click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /SaaS Company 1/i }).first().click();
    await waitShell(page);
  }

  await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await page.getByText(/pending|Approve|You're all caught up/i).first().waitFor({ timeout: SHELL_MS }).catch(() => {});
  await shot(page, "approvals");

  let approved = 0;
  for (let n = 0; n < 12; n++) {
    const btn = page.getByRole("button", { name: /^Approve$/i }).first();
    if (!(await btn.isVisible({ timeout: 2500 }).catch(() => false))) break;
    note("flow", `Approve #${n + 1}`);
    await btn.click();
    approved += 1;
    await page.waitForTimeout(2500);
    await shot(page, `approved-${n + 1}`);
  }
  note("flow", `Approved ${approved} pending email sends`);
  await shot(page, "done");

  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  const sent = page.getByText(/^Sent$/).first();
  if (await sent.isVisible().catch(() => false)) {
    await sent.click();
    await page.waitForTimeout(2500);
  }
  await shot(page, "inbox-sent");
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ approved }, null, 2));
} catch (e) {
  note("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  await browser.close().catch(() => {});
}
