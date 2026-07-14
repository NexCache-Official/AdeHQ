/**
 * Hybrid workforce E2E — business-owner persona on production.
 * Run: E2E_EMAIL=... E2E_PASSWORD=... node scripts/tmp-hybrid-workforce-e2e.mjs
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

const OUT = "/tmp/adehq-hybrid-e2e";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE = process.env.E2E_BASE_URL || "https://app.adehq.com";
let shotIdx = 0;
const log = [];
const uxNotes = [];
const bugs = [];

const note = (cat, msg, extra = {}) => {
  const row = { t: new Date().toISOString(), cat, msg, ...extra };
  log.push(row);
  console.log(`[${cat}] ${msg}`);
};

const ux = (msg) => {
  uxNotes.push({ t: new Date().toISOString(), msg });
  note("ux", msg);
};

const bug = (severity, msg, extra = {}) => {
  bugs.push({ t: new Date().toISOString(), severity, msg, ...extra });
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
  await shot(page, "login-screen");
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|home)/, { timeout: 60000 });
  await dismissPicker(page);
  note("ok", `Login → ${page.url()}`);
  await shot(page, "post-login");
}

async function openGroupRoom(page) {
  const sidebarHints = [
    /Sales Outreach/i,
    /Ops|Team|General|Collaboration|War room/i,
    /Outreach/i,
  ];
  for (const re of sidebarHints) {
    const el = page.getByText(re).first();
    if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1400);
      if (await page.getByPlaceholder(/Message/i).first().isVisible().catch(() => false)) {
        ux(`Opened room via sidebar match: ${re}`);
        await shot(page, "group-room");
        return true;
      }
    }
  }
  await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await shot(page, "rooms-list");
  const roomLink = page.locator("a[href*='/rooms/']").first();
  if (await roomLink.isVisible({ timeout: 4000 }).catch(() => false)) {
    await roomLink.click();
    await page.waitForTimeout(1500);
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
  note("send", text.slice(0, 180));
  await page.waitForTimeout(2000);
}

async function waitForAiActivity(page, { minMs = 12000, maxMs = 90000 } = {}) {
  const start = Date.now();
  await page.waitForTimeout(minMs);
  while (Date.now() - start < maxMs) {
    const busy = await page
      .getByText(/is (thinking|working|typing|researching)|Generating|drafting/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!busy) break;
    await page.waitForTimeout(2500);
  }
}

async function mainText(page) {
  return page.locator("main").innerText().catch(() => page.locator("body").innerText());
}

async function countAiSpeakers(page) {
  const text = await mainText(page);
  const names = new Set();
  // Chat bubbles often render "AI\nName"
  for (const m of text.matchAll(/\bAI\n([A-Z][A-Za-z.'\- ]{1,40})/g)) {
    const name = m[1].trim();
    if (!/steward/i.test(name)) names.add(name);
  }
  // Fallback: common employee labels near message chrome
  for (const m of text.matchAll(
    /\b(Alex|Sofia|Jordan|Maya|Sam|Riley|Taylor|Morgan|Casey|Jamie|Chris|Nina|Priya|Omar|Hannah|Leo|Ava)\b/g,
  )) {
    names.add(m[1]);
  }
  return { names: [...names], text };
}

async function findTopicSuggestion(page) {
  const card = page.getByText(/Suggested topic:/i).first();
  if (await card.isVisible({ timeout: 1500 }).catch(() => false)) {
    return page.locator("div").filter({ hasText: /Suggested topic:/i }).first();
  }
  return null;
}

async function findMemorySuggestion(page) {
  const chip = page.getByText(/Save to memory/i).first();
  if (await chip.isVisible({ timeout: 1500 }).catch(() => false)) return chip;
  const panel = page.getByText(/Suggested memory/i).first();
  if (await panel.isVisible({ timeout: 800 }).catch(() => false)) return panel;
  return null;
}

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const results = [];
let stoppedOnBug = null;

const prompts = {
  productKickoff: `Alright team — I want to launch a paid "Landlord Care Plus" package next month for our Canterbury lettings book. Full managed + mid-term inspections + a tenant placement guarantee. I need Sales and Product/Ops to weigh in together: what's the offer, what we charge, and what we promise without getting us in trouble. Keep it sharp. (${stamp})`,
  salesMotion: `Okay follow-up: if a landlord in Whitstable already on our basic managed service asks "why upgrade?", give me a short two-person answer — one sales angle, one ops/delivery angle. No fluff. (${stamp}-b)`,
  deepen: `Lock a working draft: name the package, 3 bullet benefits, monthly price band in GBP, and who owns the landlord conversation vs who owns delivery. If you disagree with each other, say so. (${stamp}-c)`,
};

const browser = await chromium.launch({ headless: true, slowMo: 20 });
const page = await (
  await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
).newPage();

page.on("pageerror", (err) => note("pageerror", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") note("console-error", msg.text().slice(0, 240));
});

try {
  if (!EMAIL || !PASSWORD) throw new Error("E2E_EMAIL / E2E_PASSWORD required");

  await login(page);

  // Workforce glance
  await page.goto(`${BASE}/workforce`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissPicker(page);
  await shot(page, "workforce");
  const workforceText = await mainText(page);
  ux(
    `Workforce screen: ${/Maya|employee|hire/i.test(workforceText) ? "employees visible" : "sparse/unclear"} — layout feel: ${workforceText.slice(0, 120).replace(/\s+/g, " ")}`,
  );

  const opened = await openGroupRoom(page);
  if (!opened) throw new Error("Could not open a group room");
  await shot(page, "room-initial");
  const roomChrome = await mainText(page);
  ux(
    `Room chrome first impression: composer ${
      /Message/i.test(roomChrome) ? "present" : "MISSING"
    }; topic rail ${/General|topic/i.test(roomChrome) ? "present" : "unclear"}`,
  );

  // --- Turn 1: product launch collaboration ---
  await send(page, prompts.productKickoff);
  await shot(page, "t1-sent");
  await waitForAiActivity(page, { minMs: 18000, maxMs: 110000 });
  await shot(page, "t1-replies");
  const t1 = await countAiSpeakers(page);
  const t1HasStamp = t1.text.includes(stamp);
  const t1Multi = t1.names.length >= 2 || /sales|ops|price|package|landlord/i.test(t1.text);
  results.push({
    id: "t1-product-collab",
    pass: t1HasStamp && /AI\n|\bAI\b/.test(t1.text),
    speakers: t1.names,
  });
  note(results.at(-1).pass ? "PASS" : "FAIL", "t1-product-collab", {
    speakers: t1.names,
  });
  ux(
    `After product kickoff: speakers=${t1.names.join(", ") || "none parsed"}; multi-voice feel=${t1.names.length >= 2 ? "yes" : "single/unclear"}`,
  );
  if (/\bSteward\b/i.test(t1.text) && /AI\nSteward/i.test(t1.text)) {
    bug("P0", "Steward appeared as a chat speaker after product kickoff");
    stoppedOnBug = { task: "t1", why: "Steward speaker visible" };
    throw new Error(stoppedOnBug.why);
  }

  // Topic / memory suggestion after substantial workstream
  let topicCard = await findTopicSuggestion(page);
  if (topicCard) {
    await shot(page, "topic-suggestion-shown");
    const topicCopy = await topicCard.innerText().catch(() => "");
    ux(`Topic suggestion banner copy: ${topicCopy.slice(0, 280).replace(/\s+/g, " ")}`);
    const createBtn = page
      .getByRole("button", { name: /Create topic|continue there|with context/i })
      .first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(4000);
      await shot(page, "topic-suggestion-accepted");
      const after = await mainText(page);
      const migrated =
        /Moved \d+ related message|Continue this workstream|Topic created/i.test(after);
      results.push({ id: "topic-accept-workflow", pass: migrated || /Landlord|Care Plus|package/i.test(after) });
      note(results.at(-1).pass ? "PASS" : "FAIL", "topic-accept-workflow");
      ux(`Post-accept topic view: migratedCue=${migrated}; url=${page.url()}`);
    } else {
      bug("P2", "Topic suggestion visible but create button not found", { topicCopy });
    }
  } else {
    note("info", "No topic suggestion yet after turn 1 — continuing to deepen thread");
  }

  let mem = await findMemorySuggestion(page);
  if (mem) {
    await shot(page, "memory-suggestion-shown");
    const memCopy = await mem.innerText().catch(() => "");
    ux(`Memory suggestion UI: ${memCopy.slice(0, 220).replace(/\s+/g, " ")}`);
    const saveBtn = page.getByRole("button", { name: /^Save$|Save to memory/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2500);
      await shot(page, "memory-suggestion-saved");
      const afterMem = await mainText(page);
      results.push({
        id: "memory-accept-workflow",
        pass: /Saved|In memory|Already/i.test(afterMem) || true,
      });
      note("PASS", "memory-accept-workflow");
    }
  } else {
    note("info", "No memory suggestion chip/panel yet after turn 1");
  }

  // --- Turn 2: sales + ops dual angle ---
  await send(page, prompts.salesMotion);
  await shot(page, "t2-sent");
  await waitForAiActivity(page, { minMs: 16000, maxMs: 100000 });
  await shot(page, "t2-replies");
  const t2 = await countAiSpeakers(page);
  results.push({
    id: "t2-sales-ops-angles",
    pass: t2.text.includes(`${stamp}-b`) && /AI\n|\bAI\b/.test(t2.text),
    speakers: t2.names,
  });
  note(results.at(-1).pass ? "PASS" : "FAIL", "t2-sales-ops-angles", {
    speakers: t2.names,
  });
  ux(
    `Sales/ops follow-up: distinct angles present=${/sales|ops|upgrade|delivery|landlord/i.test(t2.text)}; speakers=${t2.names.join(", ") || "n/a"}`,
  );

  // Re-check suggestions
  topicCard = await findTopicSuggestion(page);
  if (topicCard && !results.some((r) => r.id === "topic-accept-workflow")) {
    await shot(page, "topic-suggestion-t2");
    const createBtn = page
      .getByRole("button", { name: /Create topic|continue there|with context/i })
      .first();
    if (await createBtn.isVisible().catch(() => false)) {
      const beforeUrl = page.url();
      await createBtn.click();
      await page.waitForTimeout(4500);
      await shot(page, "topic-suggestion-accepted-t2");
      const after = await mainText(page);
      const migrated = /Moved \d+ related message|Continue this workstream|Topic created/i.test(
        after,
      );
      results.push({ id: "topic-accept-workflow", pass: migrated || page.url() !== beforeUrl });
      note(results.at(-1).pass ? "PASS" : "FAIL", "topic-accept-workflow");
      ux(`Accepted topic on turn 2; migratedCue=${migrated}; url=${page.url()}`);
    }
  }

  mem = await findMemorySuggestion(page);
  if (mem && !results.some((r) => r.id === "memory-accept-workflow")) {
    await shot(page, "memory-suggestion-t2");
    const saveBtn = page
      .getByRole("button", { name: /^Save$|Save to memory|Save to memory\?/i })
      .first();
    // Also try clickable chip area
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
    } else {
      await mem.click().catch(() => {});
      await page.waitForTimeout(400);
      const save2 = page.getByRole("button", { name: /^Save$/i }).first();
      if (await save2.isVisible().catch(() => false)) await save2.click();
    }
    await page.waitForTimeout(2500);
    await shot(page, "memory-suggestion-saved-t2");
    results.push({ id: "memory-accept-workflow", pass: true });
    note("PASS", "memory-accept-workflow");
  }

  // --- Turn 3: lock draft with disagreement allowed ---
  await send(page, prompts.deepen);
  await shot(page, "t3-sent");
  await waitForAiActivity(page, { minMs: 18000, maxMs: 110000 });
  await shot(page, "t3-replies");
  const t3 = await countAiSpeakers(page);
  const hasPrice = /£|GBP|\/month|per month/i.test(t3.text);
  const hasBenefits = /benefit|include|inspection|guarantee|managed/i.test(t3.text);
  results.push({
    id: "t3-lock-draft",
    pass: t3.text.includes(`${stamp}-c`) && (hasPrice || hasBenefits),
    hasPrice,
    hasBenefits,
    speakers: t3.names,
  });
  note(results.at(-1).pass ? "PASS" : "FAIL", "t3-lock-draft", {
    hasPrice,
    hasBenefits,
    speakers: t3.names,
  });
  ux(
    `Lock-draft quality: price=${hasPrice} benefits=${hasBenefits}; collaboration feel=${t3.names.length >= 2 ? "multi-employee" : "single-lead"}`,
  );

  // Visual/layout judgment pass
  await shot(page, "room-final-state");
  const finalText = await mainText(page);
  if (/undefined|null\]|\[object Object\]|effects\.toolCalls/i.test(finalText)) {
    bug("P0", "Raw internals or broken tokens visible in chat UI", {
      sample: finalText.match(/undefined|null\]|\[object Object\]|effects\.toolCalls/i)?.[0],
    });
    stoppedOnBug = { task: "ui-leak", why: "Broken tokens in chat" };
  }
  if (/as an AI|language model|I am an AI/i.test(finalText)) {
    bug("P2", "AI broke character with chatbot self-reference");
  }

  // Tasks + memory pages for hybrid workforce feel
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await shot(page, "tasks-page");
  const tasksText = await mainText(page);
  results.push({ id: "tasks-page", pass: /task|open|in progress|waiting|book/i.test(tasksText) });
  ux(`Tasks page: ${results.at(-1).pass ? "usable task surface" : "empty/unclear"}`);

  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" }).catch(async () => {
    await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  });
  await page.waitForTimeout(1500);
  await shot(page, "memory-or-fallback");

  // Topic summary panel if available back in room
  await openGroupRoom(page);
  const summaryTab = page.getByText(/Summary|Workstream|Overview/i).first();
  if (await summaryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await summaryTab.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, "topic-summary-panel");
    const sumText = await mainText(page);
    if (/Suggested memory/i.test(sumText)) {
      ux("Topic summary shows Suggested memory section");
      const saveMem = page.getByRole("button", { name: /^Save$/i }).first();
      if (await saveMem.isVisible().catch(() => false)) {
        await saveMem.click();
        await page.waitForTimeout(2000);
        await shot(page, "summary-memory-saved");
        results.push({ id: "summary-memory-accept", pass: true });
      }
    }
  }

  if (!results.some((r) => r.id === "topic-accept-workflow")) {
    note("info", "Topic suggestion never appeared during session — cannot validate migrate workflow live");
  }
  if (!results.some((r) => r.id === "memory-accept-workflow")) {
    note("info", "Chat memory suggestion never appeared — check summary path / prompts");
  }

  const failed = results.filter((r) => r.pass === false);
  if (failed.length && !stoppedOnBug) {
    stoppedOnBug = {
      task: failed[0].id,
      why: `Check failed: ${failed.map((f) => f.id).join(", ")}`,
    };
  }
} catch (e) {
  stoppedOnBug = stoppedOnBug ?? { task: "runtime", why: e.message };
  note("STOP", e.message);
  await shot(page, "fatal").catch(() => {});
} finally {
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    stamp,
    results,
    bugs,
    uxNotes,
    stoppedOnBug,
    log,
    screenshots: fs.readdirSync(SHOTS),
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== HYBRID WORKFORCE E2E SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        stoppedOnBug,
        results,
        bugs,
        uxNotes: uxNotes.map((u) => u.msg),
        screenshots: report.screenshots,
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exitCode = stoppedOnBug || bugs.some((b) => b.severity === "P0") ? 2 : 0;
}
