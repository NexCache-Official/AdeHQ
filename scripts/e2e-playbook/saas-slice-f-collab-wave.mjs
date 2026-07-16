/**
 * Slice F unique test: inbound awareness → multi-AI product pitch reply → calendar.
 *
 * Flow:
 * 1. Login → SaaS Company 1
 * 2. Inbox: find latest inbound / needs-input thread (skumar / recent)
 * 3. Casey DM: confirm she saw the email (wake or ask)
 * 4. Human-confirm brainstorm / collab: invent fake product, sell to customer
 * 5. Calendar reminder for the proposed call
 * 6. Screenshots + report.json under /tmp/adehq-slice-f-collab
 *
 * Run:
 *   E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-playbook/saas-slice-f-collab-wave.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/tmp/adehq-slice-f-collab";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const EMAIL = process.env.E2E_EMAIL || "kushu1824@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "Test1234";
const BASE = process.env.E2E_BASE || "https://app.adehq.com";
const WORKSPACE = process.env.E2E_WORKSPACE || "SaaS Company 1";
const SHELL_MS = 90_000;
const AI_WAIT_MS = 180_000;
const PRODUCT = `OrbitPulse ${Date.now().toString(36).slice(-5)}`;
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

const findings = [];
const bugs = [];
let i = 0;

const note = (c, m, extra = {}) => {
  findings.push({ t: new Date().toISOString(), category: c, message: m, ...extra });
  console.log(`[${c}] ${m}`);
};
const bug = (s, m, extra = {}) => {
  bugs.push({ t: new Date().toISOString(), severity: s, message: m, ...extra });
  note(s, m, extra);
};

async function shot(page, label) {
  i += 1;
  const name = `${String(i).padStart(2, "0")}-${label}`;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {});
  note("shot", name, { url: page.url() });
  return name;
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
    await page.waitForTimeout(1200);
  }
}

async function dismissBlocking(page) {
  for (const name of [/Got it/i, /Dismiss/i, /Not now/i, /Keep hiring/i, /Leave and clear session/i]) {
    const btn = page.getByRole("button", { name });
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function ensureWorkspace(page) {
  const rail = await page.locator("aside").innerText().catch(() => "");
  if (new RegExp(WORKSPACE, "i").test(rail) && !page.url().includes("/onboarding")) return;
  await page.locator("aside").locator("button").first().click().catch(() => {});
  await page.waitForTimeout(800);
  const rows = page.getByRole("button", { name: new RegExp(WORKSPACE, "i") });
  const n = await rows.count();
  for (let k = 0; k < n; k++) {
    await rows.nth(k).click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    await waitShell(page);
    if (!page.url().includes("/onboarding")) return;
  }
}

async function openDm(page, nameRe) {
  const link = page.locator("aside").getByText(nameRe).first();
  await link.waitFor({ state: "visible", timeout: SHELL_MS });
  await link.click();
  await page.waitForURL(/\/rooms\//, { timeout: SHELL_MS });
  await waitShell(page);
  await dismissBlocking(page);
}

async function composer(page) {
  const box = page
    .getByPlaceholder(/Message|Ask|Write|Type/i)
    .first()
    .or(page.locator("textarea").last());
  await box.waitFor({ state: "visible", timeout: SHELL_MS });
  return box;
}

async function sendAndWaitAi(page, text, label) {
  const box = await composer(page);
  const before = await page.locator("[data-message-id]").count().catch(() => 0);
  await box.fill(text);
  await page.keyboard.press("Enter");
  await shot(page, `${label}-sent`);
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  while (Date.now() - t0 < AI_WAIT_MS) {
    await page.waitForTimeout(3000);
    const busy = await page
      .locator(".typing-dot")
      .first()
      .isVisible()
      .catch(() => false);
    const working = await page
      .getByText(/is (thinking|working|typing)|Reading|Generating|Queued/i)
      .first()
      .isVisible()
      .catch(() => false);
    const after = await page.locator("[data-message-id]").count().catch(() => 0);
    if ((after > before + 1 || after > before) && !busy && !working) {
      await page.waitForTimeout(2500);
      const stillBusy = await page.locator(".typing-dot").first().isVisible().catch(() => false);
      if (!stillBusy) break;
    }
  }
  await shot(page, `${label}-after`);
  return page.locator("main").innerText().catch(() => "");
}

const browser = await chromium.launch({
  headless: process.env.E2E_HEADLESS === "1",
  channel: process.env.E2E_CHANNEL || "chrome",
  slowMo: Number(process.env.E2E_SLOWMO || 35),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const report = {
  product: PRODUCT,
  stamp,
  base: BASE,
  workspace: WORKSPACE,
  steps: {},
  bugs,
  findings,
};

try {
  // --- Login ---
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|inbox|home)/, { timeout: SHELL_MS });
  await waitShell(page);
  await dismissBlocking(page);
  await ensureWorkspace(page);
  await shot(page, "post-login");
  report.steps.login = "ok";

  // --- Inbox scan ---
  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await dismissBlocking(page);
  await shot(page, "inbox");

  // Prefer Needs your input, then Inbox
  for (const folder of [/Needs your input/i, /^Inbox$/i]) {
    const tab = page.getByRole("button", { name: folder }).or(page.getByText(folder).first());
    if (await tab.first().isVisible().catch(() => false)) {
      await tab.first().click().catch(() => {});
      await page.waitForTimeout(1200);
      await shot(page, `folder-${String(folder).slice(0, 20)}`);
    }
  }

  let threadSubject = null;
  const threadCandidates = [
    page.getByText(/skumar|nexcache|Tuesday|product|walkthrough|FlowDesk|Orbit/i).first(),
    page.locator("[data-thread-id]").first(),
    page.locator("button, a, div").filter({ hasText: /Re:|Invitation|walkthrough|product/i }).first(),
  ];
  for (const loc of threadCandidates) {
    if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
      await loc.click().catch(() => {});
      await page.waitForTimeout(2000);
      await waitShell(page);
      threadSubject = (await page.locator("main").innerText().catch(() => "")).slice(0, 240);
      break;
    }
  }
  await shot(page, "thread-open");
  report.steps.inboxThread = threadSubject ? "opened" : "none-found";
  if (!threadSubject) {
    note("ux", "No obvious inbound thread — will still probe Casey DM for wake/context");
  } else {
    note("flow", `Thread context: ${threadSubject.replace(/\s+/g, " ").slice(0, 160)}`);
  }

  // Try Email Work Panel brainstorm if visible
  const brainstormBtn = page.getByRole("button", { name: /Start AI brainstorm|Choose another action/i }).first();
  if (await brainstormBtn.isVisible().catch(() => false)) {
    const choose = page.getByRole("button", { name: /Choose another action/i });
    if (await choose.isVisible().catch(() => false)) await choose.click();
    const startBrain = page.getByRole("button", { name: /Start AI brainstorm/i });
    if (await startBrain.isVisible().catch(() => false)) {
      await startBrain.click();
      await page.waitForTimeout(600);
      await shot(page, "brainstorm-form");
      const confirm = page.getByRole("button", { name: /Confirm|Start|Run/i }).last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.waitForTimeout(4000);
        await shot(page, "brainstorm-started");
        report.steps.brainstormUi = "started";
      } else {
        report.steps.brainstormUi = "form-open-no-confirm";
      }
    }
  } else {
    report.steps.brainstormUi = "panel-action-not-visible";
  }

  // --- Casey DM: email awareness ---
  await openDm(page, /Casey Nguyen|Casey/i);
  await shot(page, "casey-dm");

  const caseyBody = await page.locator("main").innerText().catch(() => "");
  const caseySawEmail =
    /email|inbox|skumar|nexcache|reply|inbound|Tuesday|walkthrough|subject/i.test(caseyBody);
  report.steps.caseyHadPriorEmailContext = caseySawEmail;
  note("flow", `Casey DM already mentions email context: ${caseySawEmail}`);

  const caseyReply = await sendAndWaitAi(
    page,
    [
      `Casey — unique Slice F check (${stamp}).`,
      `Look at our latest inbound email thread (likely skumar@nexcache.com or the most recent customer reply).`,
      `Tell me in 3 bullets: (1) who emailed, (2) what they asked, (3) whether you already woke me about it.`,
      `Then invent a lightweight SaaS product called "${PRODUCT}" (fake is fine) that fits their ask,`,
      `propose a short sales reply that pitches ${PRODUCT}, and ask me before drafting/sending anything.`,
      `Also create a calendar reminder for a 20-min intro call next Tuesday 9:00 AM BST titled "${PRODUCT} intro".`,
    ].join(" "),
    "casey-brief",
  );

  const caseyMentionsProduct = new RegExp(PRODUCT, "i").test(caseyReply);
  const caseyMentionsCalendar = /calendar|Tuesday|9(:00)?|reminder|event|scheduled/i.test(caseyReply);
  const caseyMentionsEmail = /skumar|nexcache|inbound|email|reply|subject|Tuesday/i.test(caseyReply);
  const caseyRefused = /don'?t have|cannot|can'?t (see|access|send)|no inbox/i.test(caseyReply);
  report.steps.caseyProduct = caseyMentionsProduct;
  report.steps.caseyCalendar = caseyMentionsCalendar;
  report.steps.caseyEmailAware = caseyMentionsEmail;
  if (caseyRefused) bug("P1", "Casey refused inbox/email awareness");
  if (!caseyMentionsEmail) bug("P1", "Casey did not reference the inbound email contents/sender");
  if (!caseyMentionsProduct) bug("P2", `Casey did not engage with product ${PRODUCT}`);

  // Ask her to pull a peer if useful
  const caseyCollab = await sendAndWaitAi(
    page,
    [
      `Thanks. Before you draft, pull one relevant teammate into a short brainstorm on ${PRODUCT}`,
      `(or tell me who and wait for my confirm). I want a sharper pitch + call ask.`,
      `Do not send external email yet.`,
    ].join(" "),
    "casey-collab",
  );
  report.steps.caseyAskedConfirmBeforePeers = /confirm|ok if|shall i|want me to|before/i.test(
    caseyCollab,
  );

  // --- Peer DM (Lane or Jules) for second opinion ---
  const peerName = /Lane|Jules|Riley|Morgan/i;
  const peerVisible = await page.locator("aside").getByText(peerName).first().isVisible().catch(() => false);
  if (peerVisible) {
    const peerLabel = (await page.locator("aside").getByText(peerName).first().innerText()) || "peer";
    await openDm(page, peerName);
    await shot(page, "peer-dm");
    const peerReply = await sendAndWaitAi(
      page,
      [
        `Quick collab (${stamp}): Casey is pitching fake product "${PRODUCT}" to our latest inbound email prospect.`,
        `Give 3 punchy bullet points for the reply (benefits + soft CTA for Tuesday 9am BST).`,
        `No outbound email — ideas only.`,
      ].join(" "),
      "peer-ideas",
    );
    report.steps.peerName = peerLabel.slice(0, 40);
    report.steps.peerEngaged = peerReply.length > 80;
    if (!report.steps.peerEngaged) bug("P2", "Peer DM produced little/no content");
  } else {
    report.steps.peerEngaged = false;
    note("ux", "No secondary hired employee visible in sidebar for peer DM");
  }

  // --- Back to Casey: draft + calendar confirm ---
  await openDm(page, /Casey Nguyen|Casey/i);
  const draftReply = await sendAndWaitAi(
    page,
    [
      `Confirmed — go ahead and create an inbox draft reply pitching ${PRODUCT}`,
      `and keep the Tuesday 9am BST ask. Use email.createDraft / email.sendDraft so I approve send.`,
      `Confirm the calendar reminder exists (or create it now). Do not claim sent until I approve.`,
    ].join(" "),
    "casey-draft",
  );
  const sawDraftUi = await page
    .getByText(/Email draft|Needs approval|Approval:\s*Send|Awaiting approval|drafted/i)
    .first()
    .isVisible()
    .catch(() => false);
  const approveVisible = await page
    .getByRole("button", { name: /Approve|Approve & send|Confirm send/i })
    .first()
    .isVisible()
    .catch(() => false);
  report.steps.draftUi = sawDraftUi || approveVisible;
  report.steps.draftNarrative = /draft|approval|inbox/i.test(draftReply);
  if (!report.steps.draftUi && !report.steps.draftNarrative) {
    bug("P1", "No draft card/approval after Casey was asked to create inbox draft");
  }

  // Approve if present (real send to prior thread recipient — user asked full path)
  if (approveVisible) {
    await page.getByRole("button", { name: /Approve|Approve & send|Confirm send/i }).first().click();
    await page.waitForTimeout(4000);
    await shot(page, "approved-send");
    report.steps.approvedSend = true;
  } else {
    // Try Approvals page
    await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
    await waitShell(page);
    await shot(page, "approvals");
    const appr = page.getByRole("button", { name: /^Approve$/i }).first();
    if (await appr.isVisible().catch(() => false)) {
      await appr.click();
      await page.waitForTimeout(3000);
      report.steps.approvedSend = true;
      await shot(page, "approvals-approved");
    } else {
      report.steps.approvedSend = false;
      note("ux", "No pending Approve button — draft may still be pending request");
    }
  }

  // --- Calendar page check ---
  await page.goto(`${BASE}/calendar`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  await page.waitForTimeout(2000);
  await shot(page, "calendar");
  const calText = await page.locator("main").innerText().catch(() => "");
  const calHasProduct = new RegExp(PRODUCT, "i").test(calText);
  const calHasCall = /intro|call|Tuesday|9/i.test(calText);
  report.steps.calendarShowsReminder = calHasProduct || calHasCall;
  if (!report.steps.calendarShowsReminder) {
    bug("P1", `Calendar page does not show ${PRODUCT} / call reminder`);
  }

  // --- Inbox mission folder sanity ---
  await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: SHELL_MS });
  await waitShell(page);
  const needsInput = page.getByText(/Needs your input/i).first();
  report.steps.needsInputFolder = await needsInput.isVisible().catch(() => false);
  await shot(page, "inbox-final");

  report.ok =
    report.steps.login === "ok" &&
    (report.steps.caseyEmailAware || report.steps.caseyHadPriorEmailContext) &&
    (report.steps.caseyProduct || report.steps.draftUi) &&
    bugs.filter((b) => b.severity === "P0").length === 0;

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  note("done", `ok=${report.ok} product=${PRODUCT} bugs=${bugs.length}`);
  console.log(JSON.stringify({ ok: report.ok, product: PRODUCT, bugs, steps: report.steps }, null, 2));
} catch (e) {
  bug("P0", e instanceof Error ? e.message : String(e));
  await shot(page, "fatal").catch(() => {});
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
