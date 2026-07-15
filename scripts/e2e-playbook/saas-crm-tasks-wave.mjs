/**
 * SaaS Company 1 — CRM + tasks wave via Lane DM (conversational).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-saas-crm-wave";
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
const bug = (s, m) => { bugs.push({ s, m }); note(s, m); };
async function shot(page, label) {
  i += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(i).padStart(2, "0")}-${label}.png`) }).catch(() => {});
  note("shot", label);
}
async function waitShell(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    if (!(await page.getByText(/Loading workspace|Loading…|Loading\.\.\./i).first().isVisible().catch(() => false))) break;
    await page.waitForTimeout(1500);
  }
}
async function waitAi(page, label) {
  const before = await page.locator("[data-message-id]").count().catch(() => 0);
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    await page.waitForTimeout(2500);
    await shot(page, `wait-${label}`);
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const busy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
    const card = await page.getByText(/Contact created|Deal created|Task created|CRM/i).first().isVisible().catch(() => false);
    if ((after > before || card) && !busy) break;
  }
}

const browser = await chromium.launch({ headless: false, channel: process.env.E2E_CHANNEL || "chrome", slowMo: 40 });
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
  await shot(page, "lane-dm");

  const box = page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
  await box.fill(
    `Hey Lane — can you add a CRM contact for Taylor Quinn at Northwind Ops (taylor.quinn+${stamp}@example.com), create a deal "FlowDesk Mid-market Pilot — Northwind" at $18k, and a task for me to review the pilot brief by Friday? Keep replies short. (${stamp})`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "ask");
  await page.waitForTimeout(1500);
  await waitAi(page, "crm");
  await shot(page, "after-crm");

  const body = await page.locator("body").innerText();
  if (!/Contact|Deal|Task|CRM|Northwind/i.test(body)) {
    bug("P1", "No CRM/task evidence in Lane reply");
  } else {
    note("flow", "Saw CRM/task related content");
  }

  await page.goto(`${BASE}/crm`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "crm-page");
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await shot(page, "tasks-page");
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, stamp }, null, 2));
  console.log(JSON.stringify({ bugs }, null, 2));
  await browser.close().catch(() => {});
}
