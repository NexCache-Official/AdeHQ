/**
 * Room collaboration E2E — silent steward routing, task book, AI handoff signals.
 * Run: E2E_EMAIL=... E2E_PASSWORD=... node scripts/tmp-room-collab-e2e.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // optional
  }
}
loadEnvLocal();

const OUT = "/tmp/adehq-room-e2e";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE = "https://app.adehq.com";
let shotIdx = 0;
const log = [];
const note = (cat, msg, extra = {}) => {
  const row = { t: new Date().toISOString(), cat, msg, ...extra };
  log.push(row);
  console.log(`[${cat}] ${msg}`);
};

async function shot(page, label) {
  shotIdx += 1;
  await page.screenshot({
    path: path.join(SHOTS, `${String(shotIdx).padStart(2, "0")}-${label}.png`),
    fullPage: false,
  });
  note("shot", label);
}

async function dismissPicker(page) {
  const overlay = page.locator("div.fixed.inset-0.z-50").first();
  if (!(await overlay.isVisible({ timeout: 1200 }).catch(() => false))) return;
  const rep = overlay.getByText(/RealEstatePros/i).first();
  if (await rep.isVisible().catch(() => false)) {
    await rep.click({ force: true });
    await page.waitForTimeout(1200);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|home)/, { timeout: 60000 });
  await dismissPicker(page);
  note("ok", `Login → ${page.url()}`);
  await shot(page, "login");
}

async function openGroupRoom(page) {
  // Prefer a multi-employee room in the sidebar (not Direct Chat).
  const candidates = [
    page.getByText(/Ops|Team|General|Collaboration|War room/i).first(),
    page.locator('[data-room-kind="group"]').first(),
  ];
  for (const c of candidates) {
    if (await c.isVisible({ timeout: 1500 }).catch(() => false)) {
      await c.click();
      await page.waitForTimeout(1200);
      if (await page.getByPlaceholder(/Message/i).first().isVisible().catch(() => false)) {
        note("ux", "Opened group room");
        await shot(page, "group-room");
        return true;
      }
    }
  }
  // Fallback: go to rooms list
  await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const roomLink = page.locator("a[href*='/rooms/']").first();
  if (await roomLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await roomLink.click();
    await page.waitForTimeout(1500);
    note("ux", "Opened first room from /rooms");
    await shot(page, "group-room");
    return true;
  }
  return false;
}

async function send(page, text) {
  const box = page.getByPlaceholder(/Message/i).first();
  await box.click();
  await box.fill(text);
  await page.keyboard.press("Enter");
  note("send", text.slice(0, 140));
  await page.waitForTimeout(2500);
}

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const results = [];
let stoppedOnBug = null;

const HEADLESS = process.env.E2E_HEADLESS === "1";
const browser = await chromium.launch({
  headless: HEADLESS,
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: HEADLESS ? 0 : 40,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

try {
  if (!EMAIL || !PASSWORD) throw new Error("E2E_EMAIL / E2E_PASSWORD required");
  await login(page);
  const opened = await openGroupRoom(page);
  if (!opened) throw new Error("Could not open a group room");

  // 1) Unnamed specialist ask — steward picks silently (no "Steward" speaker)
  const t1 = `We need a short ops risk summary for Thursday's board — who should own that? (${stamp})`;
  await send(page, t1);
  await shot(page, "t1-unnamed-sent");
  await page.waitForTimeout(20000);
  const body1 = await page.locator("main").innerText();
  const stewardSpoke = /\bSteward\b/i.test(body1) && /AI\nSteward/i.test(body1);
  const aiReplied = /AI\n/.test(body1) && body1.includes(stamp);
  results.push({
    id: "t1-silent-route",
    pass: aiReplied && !stewardSpoke,
    stewardSpoke,
    aiReplied,
  });
  note(aiReplied && !stewardSpoke ? "PASS" : "FAIL", "t1-silent-route");
  await shot(page, "t1-unnamed-result");
  if (stewardSpoke) {
    stoppedOnBug = { task: "t1", why: "Steward appeared as a chat speaker" };
    throw new Error(stoppedOnBug.why);
  }

  // 2) Brainstorm
  const t2 = `Brainstorm two angles for reducing field ops overtime next quarter (${stamp}).`;
  await send(page, t2);
  await page.waitForTimeout(25000);
  await shot(page, "t2-brainstorm");
  const body2 = await page.locator("main").innerText();
  results.push({
    id: "t2-brainstorm",
    pass: body2.includes(stamp) && /AI\n/.test(body2),
  });
  note(results.at(-1).pass ? "PASS" : "FAIL", "t2-brainstorm");

  // 3) Task book page visible
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await shot(page, "tasks-page");
  const tasksText = await page.locator("main").innerText();
  results.push({
    id: "t3-tasks-page",
    pass: /task|open|in progress|waiting/i.test(tasksText),
  });
  note(results.at(-1).pass ? "PASS" : "FAIL", "t3-tasks-page");

  if (results.some((r) => !r.pass)) {
    stoppedOnBug = { task: "suite", why: "One or more room E2E checks failed" };
  }
} catch (e) {
  stoppedOnBug = stoppedOnBug ?? { task: "runtime", why: e.message };
  note("STOP", e.message);
  await shot(page, "fatal").catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ at: new Date().toISOString(), results, stoppedOnBug, log }, null, 2),
  );
  console.log("\n=== ROOM E2E SUMMARY ===");
  console.log(JSON.stringify({ stoppedOnBug, results }, null, 2));
  await browser.close();
  process.exitCode = stoppedOnBug ? 2 : 0;
}
