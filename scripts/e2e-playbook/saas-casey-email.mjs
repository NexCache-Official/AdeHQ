/**
 * Focused: Casey DM → draft+send email to skumar@nexcache.com → approve.
 * Run alongside/after marathon waves.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-casey-email";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const MAIL_TO = "skumar@nexcache.com";
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
  const name = `${String(i).padStart(2, "0")}-${label}`;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
  note("shot", name);
}
async function waitShell(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    const loading = await page
      .getByText(/Loading inbox|Loading…|Loading\.\.\.|Redirecting/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!loading) break;
    await page.waitForTimeout(1500);
  }
}

const browser = await chromium.launch({
  headless: process.env.E2E_HEADLESS === "1",
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: 40,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox)/, { timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "post-login");

  // Switch to SaaS Company 1 if needed
  const rail = await page.locator("aside").innerText().catch(() => "");
  if (!/SaaS Company 1/i.test(rail) || page.url().includes("/onboarding")) {
    await page.locator("aside").locator("button").first().click();
    await page.waitForTimeout(800);
    const rows = page.getByRole("button", { name: /SaaS Company 1/i });
    const n = await rows.count();
    for (let k = 0; k < n; k++) {
      await rows.nth(k).click({ force: true });
      await page.waitForTimeout(2000);
      await waitShell(page);
      if (!page.url().includes("/onboarding") && /Inbox/i.test(await page.locator("aside").innerText())) break;
      await page.locator("aside").locator("button").first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  await shot(page, "saas");

  // Open Casey via sidebar
  const casey = page.locator("aside").getByText(/Casey Nguyen|Casey/i).first();
  await casey.click();
  await page.waitForURL(/\/rooms\//, { timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "casey-dm");

  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.waitFor({ state: "visible", timeout: SHELL_MS });
  await box.fill(
    `Hey Casey — please send a short friendly email to ${MAIL_TO} inviting them to a 20-minute FlowDesk walkthrough next week. Draft it through the workspace inbox, show me the draft card here, and ask me before anything actually goes out. Keep it human. (${stamp})`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask-sent");

  // Wait up to 60s for reply / draft card
  const t0 = Date.now();
  let sawRefuse = false;
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2000);
    await shot(page, "wait");
    if (await page.getByText(/don'?t have the ability|cannot send|can'?t send email|outside what i can/i).first().isVisible().catch(() => false)) {
      sawRefuse = true;
      break;
    }
    if (await page.getByRole("button", { name: /Approve|Confirm send|Yes, send/i }).first().isVisible().catch(() => false)) break;
    if (await page.getByText(/email draft|Draft ready|approval|skumar@nexcache/i).first().isVisible().catch(() => false)) {
      // keep waiting a bit for approve button
      await page.waitForTimeout(3000);
      break;
    }
  }
  await shot(page, "after-wait");

  if (sawRefuse) {
    bug("P0", "Casey refused email capability");
    await box.fill("Try again now — use the inbox draft tools and put send up for my approval.");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(45000);
    await shot(page, "after-retry");
  }

  const approve = page.getByRole("button", { name: /Approve|Confirm send|Yes, send|Send email/i }).first();
  if (await approve.isVisible({ timeout: 5000 }).catch(() => false)) {
    note("flow", "Approving send");
    await approve.click();
    await page.waitForTimeout(5000);
    await shot(page, "approved");
  } else {
    bug("P1", "No approve button after Casey email ask");
  }

  // Check inbox sent
  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "inbox");
  const sent = page.getByText(/^Sent$/).first();
  if (await sent.isVisible().catch(() => false)) {
    await sent.click();
    await page.waitForTimeout(2000);
    await shot(page, "sent-folder");
  }
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, shots: fs.readdirSync(SHOTS) }, null, 2));
  console.log(JSON.stringify({ bugs }, null, 2));
  await browser.close().catch(() => {});
}
