/**
 * Same-session topic suggestion accept (no navigation away).
 * Unique product name to avoid 24h title cooldown.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE = "https://app.adehq.com";
const OUT = "/tmp/adehq-topic-session";
const SHOTS = path.join(OUT, "screenshots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
let i = 0;
const report = { bugs: [], results: [], ux: [], stoppedOnBug: null, log: [] };
const note = (c, m, e = {}) => {
  report.log.push({ c, m, ...e });
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

const uniq = `Harborline Guarantor Shield ${Date.now().toString(36).slice(-4)}`;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /Enter workspace/i }).click();
  await page.waitForURL(/\/($|rooms|workforce|home)/, { timeout: 60000 });
  await dismissPicker(page);
  await page.getByText(/Sales Outreach/i).first().click();
  await page.waitForTimeout(1500);
  const general = page.getByText(/General Chat/i).first();
  if (await general.isVisible().catch(() => false)) await general.click();
  await page.waitForTimeout(800);
  await shot(page, "room");

  // Seed a short multi-turn workstream with a UNIQUE product name
  const turns = [
    `New product idea for next quarter: "${uniq}" — a paid add-on for Canterbury landlords where we underwrite first-month rent if a tenant defaults in months 1–3. I need Sales + Ops to shape the offer before I talk to our insurer. Don't invent legal claims.`,
    `Follow-up on ${uniq}: what's a credible monthly price for a 6-unit Whitstable landlord already on managed service, and what must Ops refuse to promise? Keep it blunt.`,
    `Lock a draft name + 3 benefits + price band for ${uniq}. If Sales and Ops disagree, say so out loud. This should live as its own workstream.`,
  ];

  for (let t = 0; t < turns.length; t++) {
    const box = page.getByPlaceholder(/Message/i).first();
    await box.fill(turns[t]);
    await page.keyboard.press("Enter");
    note("send", `turn ${t + 1}`);
    // Stay on page; poll for suggestion while waiting for replies
    const deadline = Date.now() + (t === turns.length - 1 ? 90000 : 45000);
    while (Date.now() < deadline) {
      const sug = page.getByText(/Suggested topic:/i).first();
      if (await sug.isVisible().catch(() => false)) {
        await shot(page, `suggestion-on-turn-${t + 1}`);
        const cardText = await page
          .locator("div")
          .filter({ has: page.getByText(/Suggested topic:/i) })
          .last()
          .innerText();
        report.ux.push(cardText.slice(0, 450).replace(/\s+/g, " "));
        note("ux", report.ux.at(-1));

        if (/Harborline|Guarantor|Shield/i.test(cardText) === false && cardText.length > 40) {
          report.bugs.push({
            severity: "P2",
            msg: "Topic suggestion title/description may not match the unique product discussed",
            sample: cardText.match(/Suggested topic:[^\n]+/)?.[0],
          });
        }
        if (/\(\s*$|\(\d+\s*$|mid-\s*$/i.test(cardText) || /landlord \(6/i.test(cardText)) {
          report.bugs.push({ severity: "P1", msg: "Suggested topic title truncated mid-phrase in UI" });
        }

        const btn = page.getByRole("button", { name: /Create topic & continue there/i }).first();
        await btn.click();
        note("ok", "accepted topic suggestion");
        await page.waitForTimeout(7000);
        await shot(page, "after-accept");
        const body = await page.locator("main").innerText();
        const movedCue = /Moved \d+ message/i.test(body);
        const hasProductChat = new RegExp(uniq.split(" ").slice(0, 2).join("|"), "i").test(body);
        const importedCard = /Imported context/i.test(body);
        const aiActive = !/0 employees active/i.test(body);
        report.results.push({
          id: "accept-migrate",
          pass: (movedCue || hasProductChat) && !importedCard,
          movedCue,
          hasProductChat,
          importedCard,
          aiActive,
          url: page.url(),
        });
        note(report.results.at(-1).pass ? "PASS" : "FAIL", "accept-migrate", report.results.at(-1));
        if (importedCard) {
          report.bugs.push({
            severity: "P1",
            msg: "Imported context card still shown after chat migration — should show moved messages only",
          });
        }
        if (!hasProductChat) {
          report.bugs.push({
            severity: "P1",
            msg: "New topic missing the original product chat messages after accept",
          });
        }
        if (!aiActive) {
          report.bugs.push({
            severity: "P1",
            msg: "New topic shows 0 employees active after migrate accept",
          });
        }

        // Continue in new topic
        const box2 = page.getByPlaceholder(/Message/i).first();
        if (await box2.isVisible({ timeout: 4000 }).catch(() => false)) {
          await box2.fill(
            `@Wren Hart @Adrian Edwards we're in the ${uniq} topic now — confirm price band and one compliance risk in 5 lines.`,
          );
          await page.keyboard.press("Enter");
          await page.waitForTimeout(35000);
          await shot(page, "continued");
          const cont = await page.locator("main").innerText();
          const falseMemory = /saved (that |this )?as durable context|I've saved that/i.test(cont) &&
            /0 saved memor/i.test(cont);
          report.results.push({
            id: "continue",
            pass: /risk|£|GBP|compliance|Wren|Adrian/i.test(cont),
          });
          note(report.results.at(-1).pass ? "PASS" : "FAIL", "continue");
          if (falseMemory) {
            report.bugs.push({
              severity: "P1",
              msg: "AI claimed durable context saved while panel still shows 0 saved memories",
            });
          }
        }

        // Memory chip hunt
        if (await page.getByText(/Save to memory/i).first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await shot(page, "mem");
          const save = page.getByRole("button", { name: /^Save$/i }).first();
          if (await save.isVisible().catch(() => false)) {
            await save.click();
            await page.waitForTimeout(2000);
            await shot(page, "mem-saved");
            report.results.push({ id: "memory-save", pass: true });
          }
        } else {
          report.ux.push("No memory suggestion chip after topic migrate");
        }

        // Stale summary check
        const side = await page.locator("aside, [class*='summary']").allInnerTexts().catch(() => []);
        const sideBlob = side.join("\n");
        if (/Zone 2|rental valuation offer|lead list of 5/i.test(sideBlob) && /Guarantor|Harborline/i.test(body)) {
          report.bugs.push({
            severity: "P1",
            msg: "Right-rail brief summary still stuck on older Zone 2 deck/lead-list work while chat moved on",
          });
        }

        throw new Error("__DONE__");
      }
      await page.waitForTimeout(2500);
    }
    await shot(page, `after-turn-${t + 1}`);
  }

  report.bugs.push({
    severity: "P1",
    msg: "No Suggested topic banner appeared in same session after 3 substantial product turns",
  });
  report.stoppedOnBug = { why: "no suggestion in-session" };
} catch (e) {
  if (e.message !== "__DONE__") {
    report.stoppedOnBug = { why: e.message };
    note("STOP", e.message);
    await shot(page, "fatal").catch(() => {});
  }
} finally {
  if (report.results.some((r) => r.pass === false) && !report.stoppedOnBug) {
    report.stoppedOnBug = { why: "failed checks" };
  }
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ ...report, screenshots: fs.readdirSync(SHOTS) }, null, 2),
  );
  console.log("\n=== SAME-SESSION TOPIC ===");
  console.log(JSON.stringify({ bugs: report.bugs, results: report.results, ux: report.ux, stoppedOnBug: report.stoppedOnBug }, null, 2));
  await browser.close();
  process.exitCode = report.stoppedOnBug || report.bugs.some((b) => b.severity === "P0") ? 2 : 0;
}
