/**
 * SaaS Company 1 — 60+ minute CEO marathon (Playwright Chromium/Chrome).
 *
 * Waves: switch completed workspace → hire gaps → room collab → AI email tools →
 * inbox compose to skumar@nexcache.com → tasks/CRM/approvals → DMs → rinse.
 *
 * Shell waits never exceed 60s. Screenshots every ~10s while waiting.
 *
 *   E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-playbook/saas-company1-marathon.mjs
 *   E2E_HEADLESS=1 E2E_CHANNEL=chromium …   # optional
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = process.env.E2E_OUT || "/tmp/adehq-saas-marathon";
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || process.env.E2E_BASE_URL || "https://app.adehq.com";
const WORKSPACE = process.env.E2E_WORKSPACE || "SaaS Company 1";
const MAIL_TO = "skumar@nexcache.com";
const SHELL_MS = 60_000;
const DURATION_MS = Number(process.env.E2E_DURATION_MS || 70 * 60 * 1000); // ~70m
const SHOT_EVERY_MS = 10_000;

const findings = [];
const bugs = [];
let shotIdx = fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).length : 0;
let lastAutoShot = 0;
let pageRef = null;
let wave = 0;

const note = (cat, msg, extra = {}) => {
  const row = { t: new Date().toISOString(), cat, msg, ...extra };
  findings.push(row);
  console.log(`[${cat}] ${msg}${extra.ms != null ? ` (${extra.ms}ms)` : ""}`);
};
const bug = (sev, msg, extra = {}) => {
  bugs.push({ t: new Date().toISOString(), sev, msg, ...extra });
  note(sev, msg, extra);
};

async function shot(page, label) {
  shotIdx += 1;
  const name = `${String(shotIdx).padStart(3, "0")}-${label}`.slice(0, 70);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {});
  lastAutoShot = Date.now();
  note("shot", name, { url: page.url() });
  return name;
}

async function autoShot(page, reason = "tick") {
  if (Date.now() - lastAutoShot >= SHOT_EVERY_MS) await shot(page, `auto-${reason}`);
}

async function pace(ms, label = "pace") {
  const page = pageRef;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const slice = Math.min(2000, end - Date.now());
    await new Promise((r) => setTimeout(r, slice));
    if (page) await autoShot(page, label);
  }
}

async function waitShell(page, label = "shell") {
  const t0 = Date.now();
  while (Date.now() - t0 < SHELL_MS) {
    await autoShot(page, label);
    const loading = await page
      .getByText(/Loading…|Loading\.\.\.|Loading workspace|Redirecting/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!loading) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  note("shell", `${label}`, { ms: Date.now() - t0 });
}

async function dismissBlocking(page) {
  for (const name of [
    /Leave and clear session/i,
    /Clear session and go back/i,
    /Keep hiring/i,
    /Got it/i,
    /Dismiss/i,
    /Not now/i,
    /Close/i,
  ]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.isVisible().catch(() => false)) {
      note("ux", `Dismissed: ${name}`);
      await btn.click().catch(() => {});
      await pace(250);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
}

function stamp() {
  return new Date().toISOString().slice(11, 19).replace(/:/g, "");
}

async function login(page) {
  note("flow", "Signing in as SaaS Company 1 CEO");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page, "login");
  await shot(page, "login");
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox|onboarding|hire)/, { timeout: SHELL_MS });
  await waitShell(page, "post-login");
  await shot(page, "post-login");
}

async function isProductShell(page) {
  if (page.url().includes("/onboarding")) return false;
  if (await page.getByRole("button", { name: /Begin setup/i }).isVisible().catch(() => false)) return false;
  const rail = await page.locator("aside").innerText().catch(() => "");
  return new RegExp(WORKSPACE, "i").test(rail) && /Inbox/i.test(rail) && /Home|Rooms|Workforce/i.test(rail);
}

async function switchToSaas(page) {
  note("flow", `Switch to completed ${WORKSPACE}`);
  await page.locator("aside").locator("button").first().click();
  await pace(900);
  if (!(await page.getByRole("button", { name: /Create workspace/i }).isVisible({ timeout: 2500 }).catch(() => false))) {
    await page.locator("aside").locator("button").first().click().catch(() => {});
    await pace(800);
  }
  await shot(page, "switcher");

  let saasRows = page.locator("div.absolute.z-40, [class*='shadow-lift']").last().locator("button").filter({ hasText: new RegExp(WORKSPACE, "i") });
  let count = await saasRows.count().catch(() => 0);
  if (count === 0) {
    saasRows = page.getByRole("button", { name: new RegExp(WORKSPACE, "i") });
    count = await saasRows.count();
  }
  if (count === 0) {
    bug("P0", `${WORKSPACE} missing from switcher`);
    return false;
  }
  if (count > 1) bug("P2", `Duplicate ${WORKSPACE} entries: ${count}`);

  for (let i = 0; i < count; i++) {
    if (i > 0) {
      await page.locator("aside").locator("button").first().click();
      await pace(900);
      saasRows = page.locator("div.absolute.z-40, [class*='shadow-lift']").last().locator("button").filter({ hasText: new RegExp(WORKSPACE, "i") });
      if ((await saasRows.count()) === 0) saasRows = page.getByRole("button", { name: new RegExp(WORKSPACE, "i") });
    }
    note("flow", `Trying switcher row ${i + 1}/${count}`);
    await saasRows.nth(i).click({ force: true });
    await pace(2000);
    await waitShell(page, `switched-${i}`);
    await pace(1500);
    await shot(page, `after-switch-${i}`);

    if (page.url().includes("/onboarding") || (await page.getByRole("button", { name: /Begin setup/i }).isVisible().catch(() => false))) {
      note("ux", `Row ${i + 1} incomplete onboarding — skip`);
      const back = page.getByRole("button", { name: /Back to /i }).first();
      if (await back.isVisible().catch(() => false)) {
        await back.click();
        await waitShell(page, "back");
      } else {
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
        await waitShell(page, "home-escape");
      }
      continue;
    }
    if (await isProductShell(page)) {
      note("flow", `On completed ${WORKSPACE}`);
      await shot(page, "confirmed-saas");
      return true;
    }
  }
  bug("P1", `No completed ${WORKSPACE} product shell`);
  return false;
}

function messageBox(page) {
  return page
    .getByPlaceholder(/Message|Write|Ask|Type/i)
    .first()
    .or(page.locator("textarea:not([disabled])").last());
}

async function waitAi(page, label, minMs = 8000) {
  const t0 = Date.now();
  await pace(Math.min(minMs, SHELL_MS), label);
  while (Date.now() - t0 < SHELL_MS) {
    await autoShot(page, label);
    const busy = await page
      .getByText(/is (thinking|working|typing|researching)|Generating|drafting|Reading/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (!busy && Date.now() - t0 > minMs) break;
    await page.waitForTimeout(2000);
  }
  await shot(page, `${label}-done`);
  note("timing", `AI wait ${label}`, { ms: Date.now() - t0 });
}

async function roomSend(page, text) {
  await dismissBlocking(page);
  const box = messageBox(page);
  await box.waitFor({ state: "visible", timeout: SHELL_MS });
  await box.click();
  await box.fill(text);
  await pace(400);
  await page.keyboard.press("Enter");
  note("send", text.slice(0, 140));
}

async function openAnyRoom(page) {
  await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page, "rooms");
  await shot(page, "rooms");
  for (const re of [/Engineering/i, /Sales|Outreach|Launch/i, /Product/i, /Support/i]) {
    const side = page.locator("aside").getByText(re).first();
    const link = page.locator("a[href*='/rooms/']").filter({ hasText: re }).first();
    if (await side.isVisible({ timeout: 1500 }).catch(() => false)) {
      await side.click();
      break;
    }
    if (await link.isVisible({ timeout: 1500 }).catch(() => false)) {
      await link.click();
      break;
    }
  }
  if (!/\/rooms\//.test(page.url())) {
    const any = page.locator("a[href*='/rooms/']").first();
    if (await any.isVisible({ timeout: 4000 }).catch(() => false)) await any.click();
  }
  await page.waitForURL(/\/rooms\/[^/?]+/, { timeout: SHELL_MS }).catch(() => {});
  await waitShell(page, "room");
  await pace(1000);
  if (!(await messageBox(page).isVisible({ timeout: 4000 }).catch(() => false))) {
    await page.getByText(/General Chat|General|Direct Chat/i).first().click().catch(() => {});
    await pace(1000);
  }
  await shot(page, "room-open");
  return Boolean(await messageBox(page).isVisible({ timeout: 5000 }).catch(() => false));
}

async function openDmEmployee(page, nameRe) {
  await page.goto(`${BASE}/dm`, { waitUntil: "domcontentloaded", timeout: SHELL_MS }).catch(() => {});
  await waitShell(page, "dm-index");
  const link = page.getByRole("link", { name: nameRe }).first()
    .or(page.locator("a, button").filter({ hasText: nameRe }).first());
  if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
    await link.click();
    await waitShell(page, "dm");
    await shot(page, "dm-open");
    return true;
  }
  // Workforce → open DM
  await page.goto(`${BASE}/workforce`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page, "wf-dm");
  await shot(page, "workforce");
  const card = page.locator("a, button").filter({ hasText: nameRe }).first();
  if (await card.isVisible({ timeout: 4000 }).catch(() => false)) {
    await card.click();
    await pace(1500);
    const dm = page.getByRole("button", { name: /Message|Open DM|Chat/i }).first();
    if (await dm.isVisible().catch(() => false)) await dm.click();
    await waitShell(page, "dm2");
    await shot(page, "dm-from-wf");
    return Boolean(await messageBox(page).isVisible({ timeout: 5000 }).catch(() => false));
  }
  return false;
}

async function ensureInboxReady(page) {
  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page, "inbox");
  await shot(page, "inbox");
  if (await page.getByRole("button", { name: /Claim address/i }).isVisible({ timeout: 2500 }).catch(() => false)) {
    note("flow", "Claiming mailbox");
    const local = page.getByPlaceholder(/hello|you|team|support/i).first()
      .or(page.locator('input[type="text"]').first());
    if (await local.isVisible().catch(() => false)) {
      await local.fill(`saas1${Date.now().toString(36).slice(-4)}`);
    }
    await pace(600);
    const claim = page.getByRole("button", { name: /Claim address/i });
    if (!(await claim.isDisabled().catch(() => true))) await claim.click();
    await waitShell(page, "claimed");
    await pace(1500);
    await shot(page, "claimed");
  }
}

async function sendInboxEmail(page, subject, body, label) {
  note("flow", `Inbox compose: ${label}`);
  await ensureInboxReady(page);
  const compose = page.getByRole("button", { name: /Compose/i }).first();
  if (!(await compose.isVisible({ timeout: 8000 }).catch(() => false))) {
    bug("P1", `Compose missing (${label})`);
    await shot(page, `no-compose-${label}`);
    return false;
  }
  await compose.click();
  await pace(1000);
  await shot(page, `compose-${label}`);

  const to = page.getByPlaceholder("name@example.com").first();
  await to.waitFor({ state: "visible", timeout: 8000 });
  await to.fill(MAIL_TO);
  await to.press("Tab").catch(() => {});
  await pace(300);

  // Prefer accessible Subject (new) then fallbacks for current production
  let subjectEl = page.getByPlaceholder("Subject").first();
  if (!(await subjectEl.isVisible({ timeout: 800 }).catch(() => false))) {
    subjectEl = page.getByLabel(/^Subject$/i).first();
  }
  if (!(await subjectEl.isVisible({ timeout: 800 }).catch(() => false))) {
    subjectEl = page.locator("div").filter({ hasText: /^Subject$/i }).locator("input").first();
  }
  if (await subjectEl.isVisible({ timeout: 1500 }).catch(() => false)) {
    await subjectEl.fill(subject);
  } else {
    const inputs = page.locator("input");
    const count = await inputs.count();
    let filled = false;
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      const ph = (await el.getAttribute("placeholder")) || "";
      const val = await el.inputValue().catch(() => "");
      if (/name@example|@/.test(ph) || val.includes("@")) continue;
      if (await el.isVisible().catch(() => false)) {
        await el.fill(subject);
        filled = true;
        note("flow", `Subject via input #${i}`);
        break;
      }
    }
    if (!filled) bug("P1", `Could not fill subject (${label})`);
  }

  const editor = page.locator('[contenteditable="true"]').last();
  if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await editor.click();
    await page.keyboard.insertText(body);
  } else {
    await page.locator("textarea").last().fill(body).catch(() => bug("P1", "No body editor"));
  }
  await shot(page, `filled-${label}`);

  await page.getByRole("button", { name: /^Send$/i }).last().click();
  await pace(8000, "send-wait");
  await shot(page, `after-send-${label}`);
  const after = await page.locator("body").innerText();
  if (/Sending|Sent|Undo/i.test(after)) note("flow", `Send toast for ${label}`);
  else bug("P1", `No Sent toast (${label})`);
  return true;
}

async function waitMayaIdle(page) {
  await pace(600);
  const thinking = page.getByText(/Maya is (thinking|updating|refining)|Understanding role/i);
  if (await thinking.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await thinking.first().waitFor({ state: "hidden", timeout: SHELL_MS }).catch(() => note("ux", "Maya slow 60s"));
  }
  const deadline = Date.now() + SHELL_MS;
  while (Date.now() < deadline) {
    const send = page.getByRole("button", { name: "Send" });
    const review = page.getByRole("button", { name: /Review job brief/i });
    if (await review.isVisible().catch(() => false)) return;
    if ((await send.isVisible().catch(() => false)) && !(await send.isDisabled().catch(() => true))) return;
    await page.waitForTimeout(300);
  }
}

async function hireOne(page, cfg) {
  note("flow", `Hire wave: ${cfg.label}`);
  await page.goto(`${BASE}/hire?entry=top_nav&fresh=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: SHELL_MS,
  });
  await waitShell(page, `hire-${cfg.label}`);
  await dismissBlocking(page);
  await shot(page, `hire-open-${cfg.label}`);

  let usedCard = false;
  if (cfg.cardMatch) {
    const card = page.getByRole("button", { name: cfg.cardMatch }).first();
    if (await card.isVisible({ timeout: 2500 }).catch(() => false)) {
      await card.click();
      usedCard = true;
    }
  }
  if (!usedCard) {
    const roleInput = page.getByPlaceholder(/help me test|What job|role/i).first();
    if (await roleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await roleInput.fill(cfg.need);
    } else {
      bug("P1", `No hire entry for ${cfg.label}`);
      return false;
    }
  }
  const cont = page.getByRole("button", { name: /Continue with Maya|Continue/i }).first();
  if (await cont.isVisible().catch(() => false)) await cont.click();

  await page.getByPlaceholder(/Type your answer/i).waitFor({ state: "visible", timeout: SHELL_MS }).catch(() => {});
  await waitMayaIdle(page);
  await shot(page, `maya-${cfg.label}`);

  for (const answer of cfg.answers) {
    if (await page.getByRole("button", { name: /Review job brief/i }).isVisible().catch(() => false)) break;
    const input = page.getByPlaceholder(/Type your answer/i).first();
    if (!(await input.isVisible().catch(() => false))) break;
    await input.fill(answer);
    await page.getByRole("button", { name: /^Send$/i }).last().click().catch(async () => input.press("Enter"));
    await waitMayaIdle(page);
  }
  if (!(await page.getByRole("button", { name: /Review job brief/i }).isVisible().catch(() => false))) {
    const input = page.getByPlaceholder(/Type your answer/i).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill("That covers it — please review the brief.");
      await page.getByRole("button", { name: /^Send$/i }).last().click().catch(async () => input.press("Enter"));
      await waitMayaIdle(page);
    }
  }
  if (await page.getByRole("button", { name: /Review job brief/i }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Review job brief/i }).click();
  }
  await pace(700);
  await shot(page, `brief-${cfg.label}`);

  if (await page.getByRole("button", { name: /Generate applicants/i }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Generate applicants/i }).click();
  } else if (await page.getByRole("button", { name: /Generate anyway/i }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Generate anyway/i }).click();
  } else {
    bug("P1", `No generate for ${cfg.label}`);
    return false;
  }
  await page.getByText(/candidates are ready|Pick someone|Hire /i).first()
    .waitFor({ state: "visible", timeout: SHELL_MS })
    .catch(() => bug("P1", `Applicants slow ${cfg.label}`));
  await shot(page, `shortlist-${cfg.label}`);

  if (await page.getByRole("button", { name: /Hire recommended candidate/i }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Hire recommended candidate/i }).click();
  } else {
    await page.getByRole("button", { name: /^Hire / }).first().click().catch(() => {});
  }
  await pace(400);
  await page.getByRole("button", { name: /Confirm hire/i }).click().catch(() => {});
  await page.getByText(/is on your team|employees hired|Open DM/i).first()
    .waitFor({ state: "visible", timeout: SHELL_MS })
    .catch(() => bug("P1", `Confirm hire incomplete ${cfg.label}`));
  await shot(page, `hired-${cfg.label}`);
  return true;
}

async function waveCollab(page, s) {
  note("flow", `Wave ${wave}: room collab ${s}`);
  if (!(await openAnyRoom(page))) {
    bug("P1", "No room composer");
    return;
  }
  await roomSend(
    page,
    `Quick sync — FlowDesk mid-market push. I need a crisp one-liner for the Approvals Inbox module, who we should demo first next week, and what we should refuse to promise. Keep it honest. (${s}-collab)`,
  );
  await shot(page, `collab-sent-${s}`);
  await waitAi(page, `collab-${s}`, 12000);

  await roomSend(
    page,
    `Casey (or whoever owns outbound) — please draft and send a short friendly email to ${MAIL_TO} asking if they're open to a 20-min FlowDesk walkthrough next week. Use the workspace inbox tools, show me the draft card, and ask before you actually fire it. Conversational tone, no buzzword soup. (${s}-mail)`,
  );
  await shot(page, `ai-mail-ask-${s}`);
  await waitAi(page, `ai-mail-${s}`, 20000);

  // If approval card appears, approve send
  const approve = page.getByRole("button", { name: /Approve|Confirm send|Send email|Yes, send/i }).first();
  if (await approve.isVisible({ timeout: 4000 }).catch(() => false)) {
    note("flow", "Approving AI email send");
    await shot(page, `approve-mail-${s}`);
    await approve.click();
    await pace(3000);
    await waitAi(page, `after-approve-${s}`, 8000);
  } else {
    // Try again / send it follow-ups that route to tools
    await roomSend(page, "Did you send it? If the draft is ready, go ahead and send it now please.");
    await waitAi(page, `send-nudge-${s}`, 15000);
    const approve2 = page.getByRole("button", { name: /Approve|Confirm send|Send email|Yes, send/i }).first();
    if (await approve2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approve2.click();
      await pace(3000);
    }
  }
  await shot(page, `mail-wave-end-${s}`);
}

async function waveInbox(page, s) {
  note("flow", `Wave ${wave}: CEO inbox sends ${s}`);
  await sendInboxEmail(
    page,
    `FlowDesk walkthrough — SaaS Company 1 (${s})`,
    `Hi,\n\nI'm the founder at SaaS Company 1. We're building FlowDesk for mid-market ops teams and running AdeHQ with our AI employees end to end.\n\nWould you be open to a short 20-minute product walkthrough next week? Happy to work around your calendar.\n\nIf you reply, we'll only act on it in AdeHQ after I explicitly approve — just testing the loop.\n\nThanks,\nShubham\nCEO, SaaS Company 1`,
    `walkthrough-${s}`,
  );
  await pace(1500);
  await sendInboxEmail(
    page,
    `SaaS Company 1 weekly note (${s})`,
    `Quick weekly note from SaaS Company 1:\n\n• Product, sales, and success AI employees are collaborating in Engineering\n• Packaging Approvals Inbox for mid-market ops leaders\n• Deliverability + reply-handling test to ${MAIL_TO}\n\nReply anytime.\n\n— Shubham`,
    `weekly-${s}`,
  );
}

async function waveDmTask(page, s) {
  note("flow", `Wave ${wave}: DM task ${s}`);
  const opened = await openDmEmployee(page, /Lane|Casey|Jules|SDR|Product|Success/i);
  if (!opened) {
    note("ux", "No DM target — skipping DM wave");
    return;
  }
  await roomSend(
    page,
    `Hey — can you drop a short PRD-style outline for Approvals Inbox into this chat (bullet points is fine), and create a task for me to review it by Friday? Keep it practical. (${s}-dm)`,
  );
  await waitAi(page, `dm-task-${s}`, 18000);
  await shot(page, `dm-done-${s}`);
}

async function waveNavSmoke(page, s) {
  note("flow", `Wave ${wave}: nav smoke ${s}`);
  for (const [pathSeg, label] of [
    ["/tasks", "tasks"],
    ["/crm", "crm"],
    ["/approvals", "approvals"],
    ["/memory", "memory"],
    ["/work-log", "work-log"],
    ["/settings/inbox", "settings-inbox"],
  ]) {
    await page.goto(`${BASE}${pathSeg}`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
    await waitShell(page, label);
    await pace(800);
    await shot(page, `${label}-${s}`);
    const body = await page.locator("body").innerText().catch(() => "");
    if (/Something went wrong|Application error|Unhandled/i.test(body)) {
      bug("P0", `Crash on ${pathSeg}`);
    }
  }
}

async function waveHireIfThin(page) {
  await page.goto(`${BASE}/workforce`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page, "wf-count");
  await shot(page, "workforce-check");
  const text = await page.locator("body").innerText();
  // Count rough employee cards — if fewer than 3 non-Maya names, hire
  const hasPm = /Product Manager|Lane/i.test(text);
  const hasSdr = /Sales|SDR|Casey/i.test(text);
  const hasCsm = /Success|Support|Jules|CSM/i.test(text);
  if (hasPm && hasSdr && hasCsm) {
    note("flow", "Workforce already staffed — skip hire");
    return;
  }
  const hires = [];
  if (!hasPm) {
    hires.push({
      label: "pm",
      cardMatch: /Product Manager|Product/i,
      need: "Product Manager for our B2B SaaS — roadmap, PRDs, discovery with mid-market ops customers",
      answers: [
        "Focus on discovery interviews and a crisp PRD for Approvals Inbox.",
        "Selling to mid-market ops leaders; keep docs practical.",
      ],
    });
  }
  if (!hasSdr) {
    hires.push({
      label: "sdr",
      cardMatch: /Sales Development|SDR|Sales/i,
      need: "Sales Development Rep for outbound to mid-market ops teams evaluating workflow SaaS",
      answers: [
        "Cold outbound + light qualification. ICP is Head of Ops / COO at 100-800 person companies.",
        "Tone should sound like a thoughtful founder intro, not sequence spam.",
      ],
    });
  }
  if (!hasCsm) {
    hires.push({
      label: "csm",
      cardMatch: /Customer Success|Support|Success/i,
      need: "Customer Success Manager to onboard new SaaS customers and keep churn low",
      answers: [
        "First 30-day onboarding playbook and weekly health checks.",
        "Early-stage — keep playbooks lightweight and founder-friendly.",
      ],
    });
  }
  for (const cfg of hires) {
    try {
      await hireOne(page, cfg);
    } catch (err) {
      bug("P1", `Hire failed ${cfg.label}: ${err instanceof Error ? err.message : err}`);
      await shot(page, `hire-fail-${cfg.label}`);
    }
  }
}

function writeReport(started, page) {
  const report = {
    totalMs: Date.now() - started,
    waves: wave,
    workspace: WORKSPACE,
    mailTo: MAIL_TO,
    url: page?.url?.() ?? null,
    bugs,
    findings: findings.slice(-500),
    screenshots: fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).sort() : [],
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "findings-tail.json"), JSON.stringify(findings.slice(-80), null, 2));
  console.log("\n=== MARATHON CHECKPOINT ===");
  console.log(JSON.stringify({
    totalMs: report.totalMs,
    waves: wave,
    bugs: bugs.length,
    shots: report.screenshots.length,
    lastUrl: report.url,
  }, null, 2));
}

const browser = await chromium.launch({
  headless: process.env.E2E_HEADLESS === "1",
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: Number(process.env.E2E_SLOWMO || 40),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
pageRef = page;
page.on("pageerror", (e) => note("pageerror", e.message.slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") note("console", m.text().slice(0, 200));
});
const wd = setInterval(() => {
  if (pageRef) void autoShot(pageRef, "wd");
}, SHOT_EVERY_MS);

const started = Date.now();
const deadline = started + DURATION_MS;

try {
  await login(page);
  if (!(await switchToSaas(page))) throw new Error(`Could not land on ${WORKSPACE}`);

  await waveHireIfThin(page);
  writeReport(started, page);

  while (Date.now() < deadline) {
    wave += 1;
    const s = `${stamp()}-w${wave}`;
    note("flow", `======== WAVE ${wave} ${s} ========`);
    try {
      await waveCollab(page, s);
      writeReport(started, page);
      if (Date.now() >= deadline) break;

      await waveInbox(page, s);
      writeReport(started, page);
      if (Date.now() >= deadline) break;

      await waveDmTask(page, s);
      writeReport(started, page);
      if (Date.now() >= deadline) break;

      if (wave % 2 === 0) {
        await waveNavSmoke(page, s);
        writeReport(started, page);
      }

      // Permission reminder for inbound replies
      if (await openAnyRoom(page)) {
        await roomSend(
          page,
          `Heads up team — if ${MAIL_TO} replies to any of those emails, do not act until I explicitly say go. Draft a response only after I approve. (${s}-perm)`,
        );
        await waitAi(page, `perm-${s}`, 8000);
      }
    } catch (err) {
      bug("P1", `Wave ${wave} error: ${err instanceof Error ? err.message : err}`);
      await shot(page, `wave-fail-${wave}`).catch(() => {});
      // Recover to SaaS shell
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: SHELL_MS }).catch(() => {});
      await switchToSaas(page).catch(() => {});
    }
    writeReport(started, page);
    note("flow", `Wave ${wave} complete — remaining ms ${Math.max(0, deadline - Date.now())}`);
  }
  note("flow", "MARATHON COMPLETE");
} catch (err) {
  bug("P0", err instanceof Error ? err.message : String(err));
  await shot(page, "fatal").catch(() => {});
} finally {
  clearInterval(wd);
  writeReport(started, page);
  await browser.close().catch(() => {});
}
