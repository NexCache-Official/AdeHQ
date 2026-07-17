/**
 * After a short Casey DM, open Settings → Usage and screenshot the Work Hours meter.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-usage-check";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("E2E_EMAIL / E2E_PASSWORD required");
  process.exit(1);
}
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const SHELL_MS = 60_000;
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
let i = 0;
const bugs = [];
const note = (c, m) => console.log(`[${c}] ${m}`);
const bug = (s, m) => {
  bugs.push({ s, m });
  note(s, m);
};
async function shot(page, label) {
  i += 1;
  await page
    .screenshot({ path: path.join(SHOTS, `${String(i).padStart(2, "0")}-${label}.png`) })
    .catch(() => {});
  note("shot", label);
}
async function waitShell(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    if (
      !(await page
        .getByText(/Loading workspace|Loading…|Loading\.\.\./i)
        .first()
        .isVisible()
        .catch(() => false))
    )
      break;
    await page.waitForTimeout(1500);
  }
}

const browser = await chromium.launch({
  headless: false,
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: 35,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox)/, { timeout: SHELL_MS });
  await waitShell(page);
  if (!/SaaS Company 1/i.test(await page.locator("aside").innerText().catch(() => ""))) {
    await page.locator("aside").locator("button").first().click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /SaaS Company 1/i }).first().click();
    await waitShell(page);
  }

  await page.locator("aside").getByText(/Casey Nguyen|Casey/i).first().click();
  await waitShell(page);
  await page.waitForTimeout(1000);
  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.fill(
    `Hey Casey — one sentence: what's our best demo customer for Approvals Inbox next week? (${stamp})`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask");
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const before = await page.locator("[data-message-id]").count().catch(() => 0);
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, "wait");
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const busy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    if (after > before && !busy) break;
  }
  await shot(page, "after");

  await page.goto(`${BASE}/settings/usage`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await page.waitForTimeout(2000);
  await shot(page, "usage");
  const body = await page.locator("body").innerText();
  const meter = await page.locator("aside").innerText();
  note("usage", body.match(/[\d.]+ AI Work Hours|[\d.]+ \/ [\d.]+/)?.[0] ?? "n/a");
  note("rail", meter.match(/AI Work Hours[\s\S]{0,40}/)?.[0]?.replace(/\s+/g, " ") ?? "n/a");
  if (/0\.00 AI Work Hours|0\.00 \/ 10\.00/i.test(body) && /No hired-employee AI activity/i.test(body)) {
    bug("P1", "Usage still shows 0.00 with no hired-employee activity after Casey reply");
  } else if (!/0\.00 AI Work Hours/i.test(body)) {
    note("flow", "Usage shows non-zero Work Hours");
  }
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, stamp }, null, 2));
  console.log(JSON.stringify({ bugs, stamp }, null, 2));
  await browser.close().catch(() => {});
}
