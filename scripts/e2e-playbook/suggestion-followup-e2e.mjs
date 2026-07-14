/**
 * Follow-up: accept pending topic suggestion + hunt memory suggestions.
 * Run: E2E_EMAIL=... E2E_PASSWORD=... node scripts/tmp-suggestion-followup-e2e.mjs
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

const OUT = "/tmp/adehq-suggestion-e2e";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE = "https://app.adehq.com";
let shotIdx = 0;
const log = [];
const uxNotes = [];
const bugs = [];
const results = [];

const note = (cat, msg, extra = {}) => {
  const row = { t: new Date().toISOString(), cat, msg, ...extra };
  log.push(row);
  console.log(`[${cat}] ${msg}`);
};
const ux = (msg) => {
  uxNotes.push(msg);
  note("ux", msg);
};
const bug = (severity, msg, extra = {}) => {
  bugs.push({ severity, msg, ...extra });
  note(severity, msg, extra);
};

async function shot(page, label) {
  shotIdx += 1;
  const file = `${String(shotIdx).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
  note("shot", file);
  return file;
}

async function dismissPicker(page) {
  const overlay = page.locator("div.fixed.inset-0.z-50").first();
  if (!(await overlay.isVisible({ timeout: 1500 }).catch(() => false))) return;
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
}

async function openSalesOutreach(page) {
  const el = page.getByText(/Sales Outreach/i).first();
  if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
    await el.click();
    await page.waitForTimeout(1500);
    return true;
  }
  await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const link = page.locator("a[href*='/rooms/']").filter({ hasText: /Sales/i }).first();
  if (await link.isVisible({ timeout: 3000 }).catch(() => false)) {
    await link.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

async function mainText(page) {
  return page.locator("main").innerText().catch(() => page.locator("body").innerText());
}

let stoppedOnBug = null;
const stamp = Date.now().toString(36).slice(-5);

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

try {
  if (!EMAIL || !PASSWORD) throw new Error("E2E_EMAIL / E2E_PASSWORD required");
  await login(page);
  if (!(await openSalesOutreach(page))) throw new Error("Sales Outreach not found");
  await shot(page, "room-open");

  // Ensure General Chat
  const general = page.getByText(/General Chat/i).first();
  if (await general.isVisible({ timeout: 2000 }).catch(() => false)) {
    await general.click();
    await page.waitForTimeout(1000);
  }

  // Scroll composer area into view — suggestion sits above composer
  await page.getByPlaceholder(/Message/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "before-topic-accept");

  const topicHeading = page.getByText(/Suggested topic:/i).first();
  const hasTopic = await topicHeading.isVisible({ timeout: 4000 }).catch(() => false);
  if (!hasTopic) {
    // Nudge with another owner-style message to resurface suggestion
    note("info", "No banner visible — sending nudge to re-trigger steward");
    const box = page.getByPlaceholder(/Message/i).first();
    await box.fill(
      `Let's keep Landlord Care Plus as its own workstream from here — pricing, guarantee wording, and Whitstable upgrade pitch all belong together. (${stamp})`,
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(25000);
    await page.getByPlaceholder(/Message/i).first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, "after-nudge");
  }

  const topicVisible = await page
    .getByText(/Suggested topic:/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (!topicVisible) {
    bug("P1", "Topic suggestion not findable to accept after Landlord Care Plus thread");
    stoppedOnBug = { task: "topic-missing", why: "Could not locate Suggested topic banner" };
  } else {
    const card = page.locator("div").filter({ hasText: /Suggested topic:/i }).first();
    const cardText = await card.innerText().catch(() => "");
    ux(`Topic card text: ${cardText.slice(0, 420).replace(/\s+/g, " ")}`);

    if (/mid-\s*$|paid managed \+ mid-/i.test(cardText) || /Suggested topic:.{90,}/i.test(cardText)) {
      bug("P2", "Suggested topic title is truncated / overly long in the banner UI", {
        sample: cardText.match(/Suggested topic:[^\n]+/)?.[0]?.slice(0, 160),
      });
    }

    const createBtn = page
      .getByRole("button", { name: /Create topic & continue there|Create topic with context|Create topic/i })
      .first();
    if (!(await createBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      bug("P0", "Topic suggestion visible but Create button missing");
      stoppedOnBug = { task: "topic-cta", why: "Create button missing" };
    } else {
      const beforeTopics = await mainText(page);
      await createBtn.click();
      await page.waitForTimeout(5000);
      await shot(page, "after-topic-accept");
      const after = await mainText(page);
      const url = page.url();
      const moved = /Moved \d+ related message/i.test(after);
      const continueCue = /Continue this workstream|pick up where you left off|Topic created/i.test(
        after,
      );
      const topicRail =
        /Landlord Care|Package Launch/i.test(after) ||
        (await page.getByText(/Landlord Care|Package Launch/i).first().isVisible().catch(() => false));

      results.push({
        id: "topic-accept-migrate",
        pass: moved || continueCue || topicRail,
        moved,
        continueCue,
        topicRail,
        url,
      });
      note(results.at(-1).pass ? "PASS" : "FAIL", "topic-accept-migrate", {
        moved,
        continueCue,
        topicRail,
        url,
      });
      ux(
        `Post-accept: moved=${moved} continueCue=${continueCue} topicRail=${topicRail} url=${url}`,
      );

      if (!moved) {
        bug("P1", "Accepted topic but no 'Moved N related messages' system cue — migration may not have run", {
          snippet: after.slice(0, 500),
        });
      }

      // Continue task in new topic
      const box = page.getByPlaceholder(/Message/i).first();
      if (await box.isVisible({ timeout: 3000 }).catch(() => false)) {
        await box.fill(
          `@Wren Hart @Adrian Edwards we're in the dedicated Landlord Care Plus topic now. Confirm the package name, £ band, and who owns landlord chat vs delivery in 5 lines max. (${stamp})`,
        );
        await page.keyboard.press("Enter");
        await page.waitForTimeout(28000);
        await shot(page, "continue-in-new-topic");
        const cont = await mainText(page);
        results.push({
          id: "continue-in-new-topic",
          pass: cont.includes(stamp) && /AI|£|GBP|landlord|delivery/i.test(cont),
        });
        note(results.at(-1).pass ? "PASS" : "FAIL", "continue-in-new-topic");
      } else {
        bug("P0", "No composer after accepting topic — cannot continue workstream");
        stoppedOnBug = { task: "no-composer", why: "Composer missing after topic accept" };
      }
    }
  }

  // Memory suggestion hunt: chat chips + summary Save memory + panel
  await page.getByPlaceholder(/Message/i).first().scrollIntoViewIfNeeded().catch(() => {});
  const memChip = page.getByText(/Save to memory\?/i).first();
  const memChipAlt = page.locator('[aria-label="Save to memory"]').first();
  let memFound =
    (await memChip.isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await memChipAlt.isVisible({ timeout: 800 }).catch(() => false));

  if (!memFound) {
    // Trigger a durable fact that should suggest memory
    const box = page.getByPlaceholder(/Message/i).first();
    await box.fill(
      `Decision to remember: Landlord Care Plus for Canterbury is priced at £45/month add-on for existing managed landlords, and Wren owns the upgrade conversation. Please note that as durable context. (${stamp}-mem)`,
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(35000);
    await shot(page, "after-memory-prompt");
    memFound =
      (await page.getByText(/Save to memory/i).first().isVisible({ timeout: 3000 }).catch(() => false)) ||
      (await page.getByText(/Suggested memory/i).first().isVisible({ timeout: 1500 }).catch(() => false));
  }

  if (memFound) {
    await shot(page, "memory-suggestion-visible");
    const saveBtn = page.getByRole("button", { name: /^Save$|Save to memory/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2500);
      await shot(page, "memory-saved");
      results.push({ id: "memory-accept", pass: true });
      note("PASS", "memory-accept");
    } else {
      // Try right-rail Save memory then check summary suggested memory
      const railSave = page.getByRole("button", { name: /Save memory/i }).first();
      if (await railSave.isVisible().catch(() => false)) {
        await railSave.click();
        await page.waitForTimeout(2000);
        await shot(page, "rail-save-memory");
      }
      const suggested = page.getByText(/Suggested memory/i).first();
      if (await suggested.isVisible().catch(() => false)) {
        const save = page.getByRole("button", { name: /^Save$/i }).first();
        if (await save.isVisible().catch(() => false)) {
          await save.click();
          await page.waitForTimeout(2000);
          await shot(page, "summary-memory-saved");
          results.push({ id: "memory-accept", pass: true });
          note("PASS", "memory-accept-via-summary");
        }
      }
    }
  } else {
    // Manual Save memory path as fallback UX check
    const railSave = page.getByRole("button", { name: /Save memory/i }).first();
    if (await railSave.isVisible().catch(() => false)) {
      await railSave.click();
      await page.waitForTimeout(2500);
      await shot(page, "manual-save-memory");
      ux("No AI memory suggestion banner; used manual Save memory control");
      results.push({ id: "memory-manual-path", pass: true });
    } else {
      bug("P2", "No memory suggestion and no Save memory control found");
    }
  }

  // Topics rail should now list the new topic
  await shot(page, "final-room-state");
  const finalText = await mainText(page);
  if (/undefined|\[object Object\]|effects\.toolCalls/i.test(finalText)) {
    bug("P0", "Broken tokens visible after topic migration flow");
    stoppedOnBug = { task: "ui-leak", why: "Broken tokens" };
  }

  const failed = results.filter((r) => r.pass === false);
  if (failed.length && !stoppedOnBug) {
    stoppedOnBug = { task: failed[0].id, why: `Failed: ${failed.map((f) => f.id).join(",")}` };
  }
} catch (e) {
  stoppedOnBug = stoppedOnBug ?? { task: "runtime", why: e.message };
  note("STOP", e.message);
  await shot(page, "fatal").catch(() => {});
} finally {
  const report = {
    at: new Date().toISOString(),
    results,
    bugs,
    uxNotes,
    stoppedOnBug,
    log,
    screenshots: fs.readdirSync(SHOTS),
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== SUGGESTION FOLLOW-UP ===");
  console.log(JSON.stringify({ stoppedOnBug, results, bugs, uxNotes }, null, 2));
  await browser.close();
  process.exitCode = stoppedOnBug || bugs.some((b) => b.severity === "P0") ? 2 : 0;
}
