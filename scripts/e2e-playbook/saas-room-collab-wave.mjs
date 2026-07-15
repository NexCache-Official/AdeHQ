/**
 * SaaS Company 1 — Engineering room collab with @mentions (post ambient-governance fix).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-room-collab";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
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
  slowMo: 40,
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

  await page.locator("aside").getByText(/Engineering/i).first().click();
  await page.waitForURL(/\/rooms\//, { timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "room");

  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.fill(
    `@Lane Lloyd @Casey Nguyen @Jules Drake — need help locking a one-liner for Approvals Inbox and who we demo first next week. Keep it short and opinionated. (${stamp})`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "sent");
  // Wait for the human bubble to land, THEN baseline — otherwise we false-pass
  // on our own message count increasing.
  const settleT0 = Date.now();
  while (Date.now() - settleT0 < SHELL_MS) {
    const stuck = await page.getByText(/^Sending…$|^Sending\.\.\.$/i).first().isVisible().catch(() => false);
    if (!stuck) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1200);
  const before = await page.locator("[data-message-id]").count().catch(() => 0);

  const t0 = Date.now();
  let grew = false;
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, "wait");
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const busy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    const stampVisible = await page.getByText(stamp).first().isVisible().catch(() => false);
    // Prefer detecting a reply that isn't just our stamp line (AI won't echo stamp alone).
    if (after > before && !busy) {
      grew = true;
      break;
    }
    if (!busy && Date.now() - t0 > 45000 && stampVisible && after === before) break;
  }
  await shot(page, "done");
  if (!grew) bug("P0", "No AI reply in Engineering after @mentions within 60s");
  else note("flow", "Got AI reply(s) in Engineering");
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, stamp }, null, 2));
  console.log(JSON.stringify({ bugs, stamp }, null, 2));
  await browser.close().catch(() => {});
}
