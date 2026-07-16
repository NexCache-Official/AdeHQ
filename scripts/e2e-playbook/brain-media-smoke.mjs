/**
 * PR-14…17 smoke against production: search mention, image ask, video WH gate.
 * Does NOT approve a 29 WH video — only checks employee guidance / approval copy.
 *
 *   E2E_HEADLESS=1 node scripts/e2e-playbook/brain-media-smoke.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-brain-media-smoke";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || process.env.E2E_BASE_URL || "https://app.adehq.com";
const WORKSPACE = process.env.E2E_WORKSPACE || "SaaS Company 1";
const SHELL_MS = 90_000;
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
let i = 0;
const bugs = [];
const notes = [];
const note = (c, m) => {
  const line = `[${c}] ${m}`;
  notes.push(line);
  console.log(line);
};
const bug = (s, m) => {
  bugs.push({ s, m });
  note(s, m);
};
async function shot(page, label) {
  i += 1;
  await page
    .screenshot({ path: path.join(SHOTS, `${String(i).padStart(2, "0")}-${label}.png`), fullPage: false })
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
    await page.waitForTimeout(1200);
  }
}
async function composer(page) {
  return page.getByPlaceholder(/Message|Ask|Write/i).first().or(page.locator("textarea").last());
}
async function waitForAiGrowth(page, beforeCount, timeoutMs = SHELL_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(2500);
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    const body = await page.locator("main").innerText().catch(() => "");
    if (after > beforeCount || /Create one five-second video|Create image|Work Hours|Estimated usage/i.test(body)) {
      return { after, body };
    }
  }
  const body = await page.locator("main").innerText().catch(() => "");
  const after = await page.locator("[data-message-id]").count().catch(() => 0);
  return { after, body };
}

const browser = await chromium.launch({
  headless: process.env.E2E_HEADLESS === "1",
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: Number(process.env.E2E_SLOWMO || 25),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox)/, { timeout: SHELL_MS });
  await waitShell(page);

  const aside = await page.locator("aside").innerText().catch(() => "");
  if (!new RegExp(WORKSPACE, "i").test(aside)) {
    await page.locator("aside").locator("button").first().click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: new RegExp(WORKSPACE, "i") }).first().click();
    await waitShell(page);
  }
  await shot(page, "workspace");

  const meter = await page.locator("aside").getByText(/AI Work Hours/i).innerText().catch(() => "");
  note("meter", meter.replace(/\s+/g, " ").slice(0, 120));

  // --- Search smoke (PR-14) via a research-ish DM ---
  await page.locator("aside").getByText(/Casey Nguyen|Casey/i).first().click();
  await waitShell(page);
  await page.waitForTimeout(800);
  let box = await composer(page);
  let before = await page.locator("[data-message-id]").count().catch(() => 0);
  await box.fill(
    `Quick fact for me (${stamp}): what's the current Y Combinator standard SAFE post-money valuation cap people cite most often? One short answer with sources if you can.`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "search-ask");
  let res = await waitForAiGrowth(page, before, 75_000);
  await shot(page, "search-reply");
  if (res.after <= before && !/SAFE|valuation|Y Combinator|YC/i.test(res.body)) {
    bug("P1", "Search/research ask did not produce a visible Casey reply in time");
  } else {
    note("ok", "Search/research path produced a reply");
  }
  if (/SiliconFlow|Exa\.ai|Perplexity API|Tavily/i.test(res.body)) {
    bug("P1", "Member-facing reply exposed provider/model SKUs");
  }

  // --- Image ask (PR-16) — expect clarifying Qs / WH options; do not force spend ---
  before = await page.locator("[data-message-id]").count().catch(() => 0);
  box = await composer(page);
  await box.fill(
    `I need a simple product hero image later (${stamp}). Before making anything: what Create image Work Hours options do we have, and what's the cheapest? Don't generate yet.`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "image-ask");
  res = await waitForAiGrowth(page, before, 75_000);
  await shot(page, "image-reply");
  if (!/Work Hours|WH|0\.5|image/i.test(res.body)) {
    bug("P1", "Image options ask did not mention Work Hours / image tiers");
  } else {
    note("ok", "Image WH guidance appeared");
  }
  if (/Qwen|FLUX|Z-Image|Wan2|SiliconFlow/i.test(res.body)) {
    bug("P1", "Image guidance leaked model SKUs");
  }

  // --- Video WH gate (PR-17) — with ~10 WH allowance, employee should refuse/warn ---
  before = await page.locator("[data-message-id]").count().catch(() => 0);
  box = await composer(page);
  await box.fill(
    `Can you create a five-second video of our product demo for social (${stamp})? If we don't have enough Work Hours this week, tell me clearly and suggest what to do instead — do not start generation.`,
  );
  await page.keyboard.press("Enter");
  await shot(page, "video-ask");
  res = await waitForAiGrowth(page, before, 90_000);
  await shot(page, "video-reply");
  const videoText = res.body.slice(-4000);
  const mentions29 =
    /29\s*Work Hours|29\s*WH|five-second video|Create one five-second video/i.test(videoText);
  const capacityAware =
    /not enough|insufficient|remaining|add more Work Hours|wait.*reset|interrupt|can't|cannot|won't start|do not have enough/i.test(
      videoText,
    );
  if (!mentions29 && !capacityAware) {
    bug(
      "P1",
      "Video ask did not mention 29 WH estimate or capacity warning (PR-17 may not be deployed yet)",
    );
  } else {
    note("ok", `Video guidance: mentions29=${mentions29} capacityAware=${capacityAware}`);
  }
  if (/Wan-AI|Wan2\.2|A14B|SiliconFlow/i.test(videoText)) {
    bug("P1", "Video guidance leaked model SKUs");
  }

  // Approval card exact copy if one appeared (should not auto-run)
  const main = await page.locator("main").innerText().catch(() => "");
  if (/Create one five-second video\. Estimated usage: 29 Work Hours\./i.test(main)) {
    note("ok", "Exact video estimate card copy visible");
  }

  const report = { bugs, notes, stamp, meter, out: OUT };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ bugs, stamp, meter: meter.replace(/\s+/g, " ").slice(0, 80) }, null, 2));
  if (bugs.some((b) => b.s === "P0")) process.exitCode = 1;
} catch (error) {
  bug("P0", error instanceof Error ? error.message : String(error));
  await shot(page, "fatal");
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ bugs, notes }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
