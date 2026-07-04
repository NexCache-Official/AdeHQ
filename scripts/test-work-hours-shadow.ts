/**
 * V19.9.1a — Work Hours shadow metering tests.
 *
 * Usage: npm run test:work-hours:shadow
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildShadowWorkMinutesInsertPayload,
  recordShadowWorkMinutes,
  summarizeWorkspaceWorkMinutes,
} from "@/lib/ai/work-hours/ledger";
import {
  estimateWorkMinutesFromCost,
  resolveShadowCostUsd,
} from "@/lib/ai/work-hours/estimate";
import { getBillingMonthStart, getBillingWeekStart } from "@/lib/ai/work-hours/periods";
import { getWorkMinuteUsdRate } from "@/lib/ai/work-hours/constants";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

function createMockLedgerClient(initialRows: Array<Record<string, unknown>> = []) {
  const rows = [...initialRows];

  const client = {
    from(table: string) {
      if (table !== "ai_work_minutes_ledger") {
        throw new Error(`Unexpected table: ${table}`);
      }

      const filters: Record<string, unknown> = {};
      let pendingInsert: Record<string, unknown> | null = null;

      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        lte(column: string, value: unknown) {
          filters[`${column}__lte`] = value;
          return api;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(filters).every(([key, val]) => row[key] === val),
          );
          return { data: match ?? null, error: null };
        },
        insert(payload: Record<string, unknown>) {
          pendingInsert = payload;
          return api;
        },
        single: async () => {
          if (!pendingInsert) throw new Error("No insert payload");
          const row = { id: `ledger_${rows.length + 1}`, ...pendingInsert };
          rows.push(row);
          pendingInsert = null;
          return { data: row, error: null };
        },
        then(onFulfilled: (value: { data: unknown[]; error: null }) => unknown) {
          const filtered = rows.filter((row) =>
            Object.entries(filters).every(([key, val]) => {
              if (key.endsWith("__lte")) return true;
              return row[key] === val;
            }),
          );
          return Promise.resolve(onFulfilled({ data: filtered, error: null }));
        },
      };

      return api;
    },
  };

  return { client: client as unknown as SupabaseClient, rows };
}

async function main() {
  console.log("AdeHQ Work Hours Shadow Metering — V19.9.1a\n");

  let passed = 0;
  let skipped = 0;

  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  const skip = (name: string, reason: string) => {
    console.log(`SKIP  ${name}`);
    console.log(`      ${reason}`);
    skipped += 1;
  };

  await run("cost-to-minutes estimate: $0.01 => 1 minute at rate 0.01", async () => {
    await withEnv({ AI_WORK_MINUTE_USD: "0.01" }, () => {
      assert(getWorkMinuteUsdRate() === 0.01, "expected rate 0.01");
      assert(estimateWorkMinutesFromCost(0.01) === 1, "expected 1 minute");
      assert(estimateWorkMinutesFromCost(0.6) === 60, "expected 60 minutes");
    });
  });

  await run("weekly period maps to Monday UTC week start", () => {
    assert(
      getBillingWeekStart(new Date("2026-07-04T15:00:00.000Z")) === "2026-06-29",
      "expected Monday 2026-06-29",
    );
    assert(
      getBillingWeekStart(new Date("2026-07-06T01:00:00.000Z")) === "2026-07-06",
      "expected Monday 2026-07-06",
    );
  });

  await run("monthly period maps to first day of month UTC", () => {
    assert(getBillingMonthStart(new Date("2026-07-15T12:00:00.000Z")) === "2026-07-01", "July start");
    assert(getBillingMonthStart(new Date("2026-12-31T23:59:59.000Z")) === "2026-12-01", "Dec start");
  });

  await run("shadow ledger row shape from buildShadowWorkMinutesInsertPayload", async () => {
    await withEnv({ AI_WORK_MINUTE_USD: "0.01", AI_WORK_HOURS_SHADOW_ENABLED: "true" }, () => {
      const payload = buildShadowWorkMinutesInsertPayload({
        workspaceId: "00000000-0000-4000-8000-000000000001",
        employeeId: "emp_alex",
        sourceType: "topic_summary",
        workUnitId: "wu_test_1",
        capability: "summarization",
        workType: "topic_summary",
        providerRoute: "siliconflow_direct",
        providerName: "siliconflow",
        modelId: "deepseek-ai/DeepSeek-V4-Flash",
        actualCostUsd: 0.02,
        observedAt: new Date("2026-07-04T12:00:00.000Z"),
      });

      assert(Boolean(payload), "expected payload");
      assert(payload!.mode === "shadow", "expected shadow mode");
      assert(payload!.work_minutes_charged === null, "must not charge");
      assert(Number(payload!.work_minutes_estimated) === 2, "expected 2 minutes");
      assert(payload!.billing_week_start === "2026-06-29", "week start mismatch");
      assert(payload!.billing_month_start === "2026-07-01", "month start mismatch");
    });
  });

  await run("idempotency: same workUnitId + sourceType returns existing row", async () => {
    await withEnv({ AI_WORK_MINUTE_USD: "0.01", AI_WORK_HOURS_SHADOW_ENABLED: "true" }, async () => {
      const { client } = createMockLedgerClient([
        {
          id: "ledger_existing",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          work_unit_id: "wu_dup",
          source_type: "topic_summary",
          work_minutes_estimated: 3,
          work_minutes_charged: null,
          mode: "shadow",
        },
      ]);

      const row = await recordShadowWorkMinutes(client, {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        sourceType: "topic_summary",
        workUnitId: "wu_dup",
        actualCostUsd: 0.03,
      });

      assert(row?.id === "ledger_existing", "expected existing row");
    });
  });

  await run("no charge: work_minutes_charged remains null on insert", async () => {
    await withEnv({ AI_WORK_MINUTE_USD: "0.01", AI_WORK_HOURS_SHADOW_ENABLED: "true" }, async () => {
      const { client } = createMockLedgerClient();
      const row = await recordShadowWorkMinutes(client, {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        sourceType: "file_embedding",
        workUnitId: "wu_embed_1",
        actualCostUsd: 0.01,
      });
      assert(row?.workMinutesCharged === null, "expected null charged minutes");
    });
  });

  await run("missing cost does not create noisy zero rows", async () => {
    await withEnv({ AI_WORK_HOURS_SHADOW_ENABLED: "true" }, async () => {
      const payload = buildShadowWorkMinutesInsertPayload({
        workspaceId: "00000000-0000-4000-8000-000000000001",
        sourceType: "topic_summary",
      });
      assert(payload === null, "expected null payload without cost");

      const cost = resolveShadowCostUsd({});
      assert(cost === null, "expected null resolved cost");
    });
  });

  await run("summarize aggregates by employee/capability/workType", async () => {
    const { client } = createMockLedgerClient([
      {
        id: "1",
        workspace_id: "ws_1",
        employee_id: "emp_a",
        source_type: "topic_summary",
        capability: "summarization",
        work_type: "topic_summary",
        work_minutes_estimated: 2,
        billing_week_start: "2026-06-29",
        mode: "shadow",
      },
      {
        id: "2",
        workspace_id: "ws_1",
        employee_id: "emp_b",
        source_type: "file_embedding",
        capability: "embedding",
        work_type: "file_embedding",
        work_minutes_estimated: 1.5,
        billing_week_start: "2026-06-29",
        mode: "shadow",
      },
      {
        id: "3",
        workspace_id: "ws_1",
        employee_id: "emp_a",
        source_type: "hiring_recruiter",
        capability: "structured_chat",
        work_type: "hiring_recruiter",
        work_minutes_estimated: 3,
        billing_week_start: "2026-06-29",
        mode: "shadow",
      },
    ]);

    const summary = await summarizeWorkspaceWorkMinutes(client, "ws_1", {
      weekStart: "2026-06-29",
    });

    assert(summary.totalEstimatedMinutes === 6.5, `expected 6.5, got ${summary.totalEstimatedMinutes}`);
    assert(summary.byEmployee.length === 2, "expected 2 employees");
    assert(summary.byCapability.length === 3, "expected 3 capabilities");
    assert(summary.byWorkType.length === 3, "expected 3 work types");
    assert(summary.mode === "shadow", "expected shadow mode");
  });

  const hasSupabase =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  if (!hasSupabase) {
    skip("live Supabase ledger insert", "Supabase service role env missing");
  } else {
    skip("live Supabase ledger insert", "mock coverage sufficient — apply migration before live writes");
  }

  console.log(`\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  FAIL: 0  TOTAL: ${passed + skipped}`);
}

main().catch(() => {
  process.exitCode = 1;
});
