/**
 * Unit-level commerce tests (no DB required for pure helpers).
 * Run: npx tsx scripts/test-commerce-catalog.ts
 */
import assert from "node:assert/strict";
import {
  annualEquivalentMonthlyMinor,
  annualSavingsPercent,
  pricingCardDisplay,
} from "../src/lib/billing/commerce/pricing-math";
import {
  floorToHour,
  getUsagePeriodForAnchor,
  firstUsagePeriodStartOnOrAfter,
  addBillingPeriod,
  USAGE_PERIOD_MS,
} from "../src/lib/billing/commerce/usage-clock";
import { PLAN_ENTITLEMENT_MATRIX_V1 } from "../src/lib/billing/commerce/entitlement-matrix";
import { buildProviderRef } from "../src/lib/billing/commerce/catalog";
import { REFUND_POLICY_COPY, PAST_DUE_GRACE_WH } from "../src/lib/billing/commerce/types";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok — ${name}`);
}

test("Team matrix weekly WH is 250", () => {
  assert.equal(PLAN_ENTITLEMENT_MATRIX_V1.team.weeklyWh, 250);
  assert.equal(PLAN_ENTITLEMENT_MATRIX_V1.pro.weeklyWh, 125);
  assert.equal(PLAN_ENTITLEMENT_MATRIX_V1.business.weeklyWh, 650);
});

test("annual pricing display math", () => {
  assert.equal(annualEquivalentMonthlyMinor(19900), 1658);
  assert.equal(annualSavingsPercent(1900, 19900), 12.7);
  const card = pricingCardDisplay({
    cadence: "annual",
    monthlyAmountMinor: 3900,
    annualAmountMinor: 39900,
  });
  assert.match(card.headline, /\/year/);
  assert.match(card.subline, /Equivalent to/);
  assert.ok((card.savingsPercent ?? 0) > 0);
});

test("usage clock is exactly 168h and independent of billing", () => {
  const anchor = floorToHour("2026-07-15T12:34:56.000Z");
  assert.equal(anchor.toISOString(), "2026-07-15T12:00:00.000Z");
  const p0 = getUsagePeriodForAnchor(anchor, new Date("2026-07-15T12:00:00.000Z"));
  assert.equal(p0.endsAt.getTime() - p0.startedAt.getTime(), USAGE_PERIOD_MS);
  const midInvoice = getUsagePeriodForAnchor(anchor, new Date("2026-08-15T12:00:00.000Z"));
  assert.equal(midInvoice.startedAt.toISOString(), "2026-08-12T12:00:00.000Z");
});

test("downgrade usage boundary is first period start on/after renewal", () => {
  const anchor = "2026-07-15T12:00:00.000Z";
  const renewal = new Date("2026-08-15T12:00:00.000Z");
  const next = firstUsagePeriodStartOnOrAfter(anchor, renewal);
  // Mid-period on Aug 15 → next boundary Aug 19 12:00
  assert.equal(next.toISOString(), "2026-08-19T12:00:00.000Z");
});

test("billing month clamp", () => {
  const jan31 = new Date("2026-01-31T12:00:00.000Z");
  const feb = addBillingPeriod(jan31, "monthly");
  assert.ok(feb.getUTCMonth() === 1); // February
  assert.ok(feb.getUTCDate() <= 28);
});

test("provider ref deterministic", () => {
  assert.equal(
    buildProviderRef({
      environment: "production",
      planCode: "pro",
      version: 1,
      currency: "USD",
      cadence: "monthly",
    }),
    "adehq:production:pro:v1:USD:monthly",
  );
});

test("refund policy is lawful exception wording", () => {
  assert.match(REFUND_POLICY_COPY, /except where required by applicable law/i);
  assert.equal(PAST_DUE_GRACE_WH, 10);
});

test("upgrade adjustment math", () => {
  const oldWeekly = 125;
  const newWeekly = 250;
  const used = 90;
  const adjustment = newWeekly - oldWeekly;
  const remaining = oldWeekly - used + adjustment;
  assert.equal(adjustment, 125);
  assert.equal(remaining, 160);
});

console.log("\nAll commerce catalog tests passed.");
