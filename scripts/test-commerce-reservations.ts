/**
 * Reservation concurrency projection tests (pure logic).
 * Run: npx tsx scripts/test-commerce-reservations.ts
 */
import assert from "node:assert/strict";

function projectAvailable(opts: {
  periodRemaining: number;
  lots: number;
  reserved: number;
}): number {
  return Math.max(0, opts.periodRemaining + opts.lots - opts.reserved);
}

function canReserve(available: number, estimated: number): boolean {
  return estimated <= available + 1e-9;
}

{
  const available = projectAvailable({ periodRemaining: 40, lots: 0, reserved: 0 });
  assert.equal(canReserve(available, 29), true);
  // After first reservation
  const afterA = projectAvailable({ periodRemaining: 40, lots: 0, reserved: 29 });
  assert.equal(canReserve(afterA, 29), false);
  console.log("ok — concurrent 29+29 against 40 is rejected for second");
}

{
  const available = projectAvailable({ periodRemaining: 10, lots: 100, reserved: 5 });
  assert.equal(available, 105);
  assert.equal(canReserve(available, 50), true);
  console.log("ok — credit lots expand available WH");
}

console.log("\nAll reservation projection tests passed.");
