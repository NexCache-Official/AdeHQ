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
      .getByText(/Loading workspace|Loading inbox|Loading…|Loading\.\.\.|Redirecting/i)
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
  // Count after our optimistic human bubble is in the DOM.
  await page.waitForTimeout(1500);
  const afterHumanCount = await page.locator("[data-message-id]").count().catch(() => 0);

  // Wait the full shell budget for Casey's reply / draft card / approve CTA.
  const t0 = Date.now();
  let sawRefuse = false;
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, "wait");
    if (
      await page
        .getByText(/don'?t have the ability|cannot send|can'?t send email|outside what i can/i)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      sawRefuse = true;
      break;
    }
    if (
      await page
        .getByRole("button", { name: /Approve|Confirm send|Yes, send/i })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      break;
    }
    const afterCount = await page.locator("[data-message-id]").count().catch(() => 0);
    const draftUi = await page
      .getByText(/Email draft|Draft ready|Awaiting approval|Needs approval|Approval:\s*Send email/i)
      .first()
      .isVisible()
      .catch(() => false);
    const typingDots = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    const busy = typingDots ||
      (await page
        .getByText(/is (thinking|working|typing)|Reading|Generating/i)
        .first()
        .isVisible()
        .catch(() => false));
    // AI reply = message count grew past the human bubble we already counted.
    if ((afterCount > afterHumanCount || draftUi) && !busy) break;
  }
  await shot(page, "after-wait");

  if (sawRefuse) {
    bug("P0", "Casey refused email capability");
    await box.fill("Try again now — use the inbox draft tools and put send up for my approval.");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(45000);
    await shot(page, "after-retry");
  }

  // Approval card may say "Approve", "Approve & send", or sit next to
  // "Approval: Send email …" copy — try several locators.
  let approved = false;
  const approveCandidates = [
    page.getByRole("button", { name: /^Approve$/i }).first(),
    page.getByRole("button", { name: /Approve & send|Approve and send|Confirm send|Yes, send/i }).first(),
    page.locator("div").filter({ hasText: /Approval:\s*Send email/i }).getByRole("button", { name: /Approve/i }).first(),
    page.locator("button").filter({ hasText: /^Approve$/i }).first(),
  ];
  for (const approve of approveCandidates) {
    if (await approve.isVisible({ timeout: 2000 }).catch(() => false)) {
      note("flow", "Approving send");
      await approve.click();
      await page.waitForTimeout(5000);
      await shot(page, "approved");
      approved = true;
      break;
    }
  }
  if (!approved) {
    // Last resort: any visible Approve near the draft card
    const near = page.getByText(/Email draft|Approval:\s*Send email/i).locator("..").getByRole("button").filter({ hasText: /Approve/i }).first();
    if (await near.isVisible({ timeout: 2000 }).catch(() => false)) {
      note("flow", "Approving send (near draft)");
      await near.click();
      await page.waitForTimeout(5000);
      await shot(page, "approved");
      approved = true;
    }
  }
  if (!approved) {
    // Draft card "Open →" often deep-links into inbox draft / approval
    const openDraft = page.getByRole("link", { name: /Open/i }).filter({ hasText: /Open/i }).first()
      .or(page.locator("a").filter({ hasText: /^Open/i }).first());
    if (await openDraft.isVisible({ timeout: 2000 }).catch(() => false)) {
      note("flow", "Opening email draft card");
      await openDraft.click();
      await page.waitForTimeout(2500);
      await waitShell(page);
      await shot(page, "draft-open");
      for (const name of [/Allow once|^Approve$/i, /Approve & send/i, /^Send$/i]) {
        const btn = page.getByRole("button", { name }).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          note("flow", `Click ${name}`);
          await btn.click();
          await page.waitForTimeout(4000);
          await shot(page, "approved-draft");
          approved = true;
          break;
        }
      }
    }
  }

  if (!approved) {
    // Chat may only show a chip — finish on Approvals page (Allow once / Approve).
    note("flow", "Opening /approvals to finish send");
    await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
    await waitShell(page);
    await page.waitForTimeout(2000);
    await shot(page, "approvals-page");
    // Wait past empty/loading states
    await page.getByText(/You're all caught up|Allow once|Approve|pending/i).first()
      .waitFor({ state: "visible", timeout: SHELL_MS })
      .catch(() => {});
    await shot(page, "approvals-ready");
    const allow = page.getByRole("button", { name: /Allow once|^Approve$/i }).first();
    if (await allow.isVisible({ timeout: 8000 }).catch(() => false)) {
      note("flow", "Approving on Approvals page");
      await allow.click();
      await page.waitForTimeout(5000);
      await shot(page, "approved-page");
      approved = true;
    } else {
      bug("P1", "No approve button in chat or on Approvals page");
      await shot(page, "approvals-empty");
    }
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
