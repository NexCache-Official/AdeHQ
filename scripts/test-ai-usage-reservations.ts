/**
 * Reservation budgeting invariants for daily token caps (voice call path).
 */
import assert from "node:assert/strict";
import {
  accumulateTodayUsage,
  RESERVED_USAGE_MAX_AGE_MS,
} from "../src/lib/supabase/ai-runtime";

const nowMs = Date.parse("2026-07-23T18:00:00.000Z");

const freshReserved = accumulateTodayUsage(
  [
    {
      status: "reserved",
      created_at: "2026-07-23T17:50:00.000Z",
      estimated_input_tokens: 200,
      estimated_max_output_tokens: 280,
      estimated_cost_usd: 0.01,
    },
  ],
  { includeReserved: true, nowMs },
);
assert.equal(freshReserved.tokens, 480);
assert.equal(freshReserved.cost, 0.01);

const staleReserved = accumulateTodayUsage(
  [
    {
      status: "reserved",
      created_at: "2026-07-23T16:00:00.000Z",
      estimated_input_tokens: 200,
      estimated_max_output_tokens: 4096,
      estimated_cost_usd: 0.5,
    },
  ],
  { includeReserved: true, nowMs },
);
assert.equal(
  staleReserved.tokens,
  0,
  "stale reserved rows must not count toward the daily budget",
);
assert.equal(staleReserved.cost, 0);

const mixed = accumulateTodayUsage(
  [
    {
      status: "success",
      created_at: "2026-07-23T12:00:00.000Z",
      input_tokens: 1000,
      output_tokens: 200,
      actual_cost_usd: 0.02,
    },
    {
      status: "reserved",
      created_at: new Date(nowMs - RESERVED_USAGE_MAX_AGE_MS - 1).toISOString(),
      estimated_input_tokens: 500,
      estimated_max_output_tokens: 4096,
      estimated_cost_usd: 1,
    },
    {
      status: "reserved",
      created_at: new Date(nowMs - 60_000).toISOString(),
      estimated_input_tokens: 50,
      estimated_max_output_tokens: 280,
      estimated_cost_usd: 0.01,
    },
    {
      status: "blocked",
      created_at: "2026-07-23T12:00:00.000Z",
      input_tokens: 9999,
      output_tokens: 9999,
      actual_cost_usd: 9,
    },
  ],
  { includeReserved: true, nowMs },
);
assert.equal(mixed.tokens, 1000 + 200 + 50 + 280);
assert.equal(mixed.cost, 0.03);

const ignoreReserved = accumulateTodayUsage(
  [
    {
      status: "reserved",
      created_at: new Date(nowMs - 60_000).toISOString(),
      estimated_input_tokens: 50,
      estimated_max_output_tokens: 280,
      estimated_cost_usd: 0.01,
    },
  ],
  { includeReserved: false, nowMs },
);
assert.equal(ignoreReserved.tokens, 0);

console.log("PASS  ai usage reservation budgeting");
