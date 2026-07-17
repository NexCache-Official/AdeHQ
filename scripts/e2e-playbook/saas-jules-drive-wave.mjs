/**
 * SaaS Company 1 — Jules (support) + Drive artifact wave.
 * Conversational CEO asks for a support summary DOCX + optional email draft.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-jules-drive";
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
        .getByText(/Loading workspace|Loading…|Loading\.\.\.|Loading inbox/i)
        .first()
        .isVisible()
        .catch(() => false))
    )
      break;
    await page.waitForTimeout(1500);
  }
}
async function waitNewAi(page, label, beforeCount) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, `wait-${label}`);
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const busy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    const card = await page
      .getByText(/Saved to Drive|Document created|DOCX|spreadsheet|Open in Drive|Email draft/i)
      .first()
      .isVisible()
      .catch(() => false);
    if ((after > beforeCount || card) && !busy) break;
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

  await page.locator("aside").getByText(/Jules Drake|Jules/i).first().click();
  await page.waitForURL(/\/rooms\//, { timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "jules-dm");

  const before = await page.locator("[data-message-id]").count().catch(() => 0);
  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.fill(
    `Hey Jules — we're testing support ops for FlowDesk. Can you write a short customer onboarding support summary as a Word doc in Drive (sections: Day-1 checklist, common snags, escalation path)? Then draft a friendly check-in email to ${MAIL_TO} offering a 15-min walkthrough of Approvals Inbox — leave it for my approval, don't send on your own. (${stamp})`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask");
  await waitNewAi(page, "doc", before);
  await shot(page, "after-doc");

  const main = await page.locator("main").innerText().catch(() => "");
  if (!/Drive|DOCX|document|draft|Email/i.test(main)) {
    bug("P1", "Jules reply missing Drive/email evidence");
  }

  // Approve path if needed
  const approve = page.getByRole("button", { name: /^Approve$/i }).first();
  if (await approve.isVisible().catch(() => false)) {
    await approve.click().catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, "approved-inline");
  } else {
    await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
    await waitShell(page);
    await shot(page, "approvals");
    const a2 = page.getByRole("button", { name: /^Approve$/i }).first();
    if (await a2.isVisible().catch(() => false)) {
      await a2.click().catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, "approved-page");
    }
  }

  await page.goto(`${BASE}/drive`, { waitUntil: "domcontentloaded", timeout: SHELL_MS }).catch(async () => {
    await page.locator("aside").getByText(/Drive/i).first().click();
  });
  await waitShell(page);
  await shot(page, "drive");

  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "inbox");
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, stamp }, null, 2));
  console.log(JSON.stringify({ bugs, stamp }, null, 2));
  await browser.close().catch(() => {});
}
