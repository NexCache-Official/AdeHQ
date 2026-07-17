/**
 * SaaS Company 1 — Lane investor update DOCX + Casey email to skumar@nexcache.com.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-investor-wave";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("E2E_EMAIL / E2E_PASSWORD required");
  process.exit(1);
}
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const MAIL_TO = "skumar@nexcache.com";
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
async function waitNewAi(page, before) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, "wait");
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const busy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    const card = await page
      .getByText(/Saved to Drive|DOCX|Email draft|Document created/i)
      .first()
      .isVisible()
      .catch(() => false);
    if ((after > before || card) && !busy) break;
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
  await shot(page, "saas");

  await page.locator("aside").getByText(/Lane Lloyd|Lane/i).first().click();
  await page.waitForURL(/\/rooms\//, { timeout: SHELL_MS });
  await waitShell(page);
  await page.waitForTimeout(1000);
  let before = await page.locator("[data-message-id]").count().catch(() => 0);
  // settle human after send
  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.fill(
    `Hey Lane — draft a short investor update Word doc for FlowDesk: traction this week, Approvals Inbox packaging, hiring (Casey+Jules), and next 2 milestones. Save it to Drive. Keep it crisp. (${stamp}-doc)`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask-doc");
  await page.waitForTimeout(1500);
  before = await page.locator("[data-message-id]").count().catch(() => 0);
  await waitNewAi(page, before);
  await shot(page, "after-doc");

  await page.locator("aside").getByText(/Casey Nguyen|Casey/i).first().click();
  await waitShell(page);
  await page.waitForTimeout(1000);
  before = await page.locator("[data-message-id]").count().catch(() => 0);
  const box2 = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box2.fill(
    `Casey — please draft a short note to ${MAIL_TO} with subject "FlowDesk investor note — week of testing" summarizing that we're packaging Approvals Inbox for mid-market ops. Leave it for my approval. (${stamp}-mail)`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask-mail");
  await page.waitForTimeout(1500);
  before = await page.locator("[data-message-id]").count().catch(() => 0);
  await waitNewAi(page, before);
  await shot(page, "after-mail");

  await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "approvals");
  const approve = page.getByRole("button", { name: /^Approve$/i }).first();
  if (await approve.isVisible().catch(() => false)) {
    await approve.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, "approved");
    note("flow", "Approved pending send");
  }
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, stamp }, null, 2));
  console.log(JSON.stringify({ bugs, stamp }, null, 2));
  await browser.close().catch(() => {});
}
