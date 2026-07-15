/**
 * SaaS Company 1 — workforce / calendar / settings / home smoke + screenshots.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-nav-wave";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const SHELL_MS = 60_000;
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
        .getByText(/Loading workspace|Loading…|Loading\.\.\.|Loading Drive|Loading inbox/i)
        .first()
        .isVisible()
        .catch(() => false))
    )
      break;
    await page.waitForTimeout(1500);
  }
}
async function visit(page, pathName, label) {
  await page.goto(`${BASE}${pathName}`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await page.waitForTimeout(1200);
  await shot(page, label);
  const body = await page.locator("body").innerText().catch(() => "");
  if (/Something went wrong|Application error|Internal Server Error/i.test(body)) {
    bug("P0", `Error on ${pathName}`);
  }
  return body;
}

const browser = await chromium.launch({
  headless: false,
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: 30,
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
  await shot(page, "saas");

  const hours = await page.locator("aside").getByText(/AI Work Hours/i).innerText().catch(() => "");
  note("meter", hours.replace(/\s+/g, " ").slice(0, 80));

  await visit(page, "/", "home");
  await visit(page, "/workforce", "workforce");
  await visit(page, "/calendar", "calendar");
  await visit(page, "/settings/usage", "usage");
  await visit(page, "/drive", "drive");
  await visit(page, "/approvals", "approvals");
  await visit(page, "/inbox", "inbox");

  // Open hire flow (don't complete if wizard is long)
  const hire = page.getByRole("button", { name: /Hire AI Employee/i }).first();
  if (await hire.isVisible().catch(() => false)) {
    await hire.click();
    await page.waitForTimeout(2000);
    await shot(page, "hire-open");
    const close = page.getByRole("button", { name: /Close|Cancel|Back|Not now/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  }
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs }, null, 2));
  console.log(JSON.stringify({ bugs }, null, 2));
  await browser.close().catch(() => {});
}
