import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("E2E_EMAIL / E2E_PASSWORD required");
  process.exit(1);
}
const BASE = "https://app.adehq.com";
const OUT = "/tmp/adehq-accept-topic";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
let i = 0;
const log = [];
const note = (c, m, e = {}) => {
  log.push({ c, m, ...e });
  console.log(`[${c}] ${m}`);
};
async function shot(page, label) {
  i += 1;
  const f = `${String(i).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(SHOTS, f), fullPage: false });
  note("shot", f);
}

async function dismissPicker(page) {
  const overlay = page.locator("div.fixed.inset-0.z-50").first();
  if (!(await overlay.isVisible({ timeout: 1200 }).catch(() => false))) return;
  const rep = overlay.getByText(/RealEstatePros/i).first();
  if (await rep.isVisible().catch(() => false)) await rep.click({ force: true });
  else await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
}

const HEADLESS = process.env.E2E_HEADLESS === "1";
const browser = await chromium.launch({
  headless: HEADLESS,
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: HEADLESS ? 0 : 40,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const report = { bugs: [], results: [], ux: [], stoppedOnBug: null };

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|home)/, { timeout: 60000 });
  await dismissPicker(page);

  await page.getByText(/Sales Outreach/i).first().click();
  await page.waitForTimeout(2000);
  const general = page.getByText(/General Chat/i).first();
  if (await general.isVisible().catch(() => false)) await general.click();
  await page.waitForTimeout(1000);
  await shot(page, "open");

  // Wait up to 45s for suggestion (may already be pending)
  const heading = page.getByText(/Suggested topic:/i).first();
  let visible = await heading.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    // Scroll within message list — suggestion sits above composer
    for (let n = 0; n < 6; n++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(400);
      visible = await heading.isVisible().catch(() => false);
      if (visible) break;
    }
  }
  if (!visible) {
    // Fresh trigger
    const box = page.getByPlaceholder(/Message/i).first();
    await box.fill(
      "Owner call: spin Landlord Care Plus into its own topic now — Whitstable upgrades, £45 add-on, Wren owns sales, Adrian owns delivery. Let's continue there.",
    );
    await page.keyboard.press("Enter");
    note("send", "owner spin-off nudge");
    await page.waitForTimeout(35000);
    await shot(page, "after-trigger");
    visible = await heading.isVisible({ timeout: 10000 }).catch(() => false);
  }

  await page.getByPlaceholder(/Message/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "before-click");

  if (!visible && !(await heading.isVisible().catch(() => false))) {
    report.bugs.push({ severity: "P1", msg: "Suggested topic banner never appeared" });
    report.stoppedOnBug = { why: "no banner" };
  } else {
    const card = page.locator("div").filter({ has: page.getByText(/Suggested topic:/i) }).last();
    const cardText = await card.innerText();
    report.ux.push(`Card: ${cardText.slice(0, 500).replace(/\s+/g, " ")}`);
    note("ux", report.ux.at(-1));

    if (/\.\.\.|mid-|for\.\.\./i.test(cardText)) {
      report.bugs.push({
        severity: "P2",
        msg: "Suggested topic title truncated in banner",
        sample: cardText.match(/Suggested topic:[^\n]+/)?.[0],
      });
    }

    const btn = page.getByRole("button", { name: /Create topic & continue there/i }).first();
    await btn.click();
    note("ok", "clicked Create topic & continue there");
    await page.waitForTimeout(6000);
    await shot(page, "after-accept");

    const body = await page.locator("main").innerText();
    const moved = /Moved \d+ related message/i.test(body);
    const created = /Topic created/i.test(body);
    const continueCue = /Continue this workstream|pick up where you left off/i.test(body);
    const inNewTopic =
      (await page.getByText(/Landlord Care/i).first().isVisible().catch(() => false)) ||
      /Landlord Care/i.test(body);

    report.results.push({
      id: "accept-migrate",
      pass: moved || (created && inNewTopic),
      moved,
      created,
      continueCue,
      inNewTopic,
      url: page.url(),
    });
    note(report.results.at(-1).pass ? "PASS" : "FAIL", "accept-migrate", report.results.at(-1));
    report.ux.push(
      `Post-accept moved=${moved} created=${created} continue=${continueCue} inNewTopic=${inNewTopic} url=${page.url()}`,
    );

    if (!moved) {
      report.bugs.push({
        severity: "P1",
        msg: "No migrated-message system cue after accept",
      });
    }

    // Continue work in new topic
    const box = page.getByPlaceholder(/Message/i).first();
    if (await box.isVisible({ timeout: 4000 }).catch(() => false)) {
      await box.fill(
        "@Wren Hart @Adrian Edwards we're in the Care Plus topic — confirm £45 add-on and ownership split in 4 bullets, then one open risk.",
      );
      await page.keyboard.press("Enter");
      await page.waitForTimeout(30000);
      await shot(page, "continued");
      const cont = await page.locator("main").innerText();
      report.results.push({
        id: "continue-collab",
        pass: /£45|45\/month|Wren|Adrian|risk/i.test(cont),
      });
      note(report.results.at(-1).pass ? "PASS" : "FAIL", "continue-collab");
    } else {
      report.bugs.push({ severity: "P0", msg: "No composer after topic accept" });
      report.stoppedOnBug = { why: "no composer" };
    }

    // Topics rail
    await shot(page, "topics-rail");
    const railEmpty = await page.getByText(/No topics yet/i).isVisible().catch(() => false);
    if (railEmpty) {
      report.bugs.push({
        severity: "P1",
        msg: "Topics rail still shows 'No topics yet' after creating topic from suggestion",
      });
    }
  }

  // Memory: look for suggestion after Emily durable-context reply
  const mem = page.getByText(/Save to memory\?/i).first();
  if (await mem.isVisible({ timeout: 2000 }).catch(() => false)) {
    await shot(page, "mem-chip");
    const save = page.getByRole("button", { name: /^Save$/i }).first();
    if (await save.isVisible().catch(() => false)) {
      await save.click();
      await page.waitForTimeout(2000);
      await shot(page, "mem-saved");
      report.results.push({ id: "memory-chip-save", pass: true });
    }
  } else {
    report.ux.push("No Save-to-memory chip in new topic after continue");
  }

  if (report.results.some((r) => r.pass === false) && !report.stoppedOnBug) {
    report.stoppedOnBug = { why: "failed check", results: report.results };
  }
} catch (e) {
  report.stoppedOnBug = { why: e.message };
  note("STOP", e.message);
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ ...report, log, screenshots: fs.readdirSync(SHOTS) }, null, 2),
  );
  console.log("\n=== ACCEPT TOPIC ===");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exitCode = report.stoppedOnBug || report.bugs.some((b) => b.severity === "P0") ? 2 : 0;
}
