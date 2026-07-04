/**
 * V19.9.0d-1 — Employee hot path shadow instrumentation tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEmployeeHotPathRuntimeDispatch,
  planEmployeeReplyShadowRun,
  recordEmployeeReplyShadowResult,
  setHotPathShadowTestHooks,
  shouldExecuteRuntimeForEmployeeDirectPath,
  shouldExecuteRuntimeForEmployeeQueuedPath,
  shouldShadowEmployeeHotPath,
} from "@/lib/ai/runtime/hot-path-shadow";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";

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

function createMockWorkUnitClient() {
  const events: string[] = [];
  let lastRow: Record<string, unknown> = {};

  const client = {
    from(_table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          lastRow = { ...payload };
          events.push(`insert:${payload.status}:${payload.work_type}`);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: lastRow, error: null }),
            }),
          };
        },
        update(patch: Record<string, unknown>) {
          lastRow = { ...lastRow, ...patch };
          events.push(`update:${patch.status}`);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: lastRow, error: null }),
                }),
              }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, events, getLastRow: () => lastRow };
}

const BASE_DIRECT_PARAMS = {
  workspaceId: "ws_test",
  employeeId: "emp_alex",
  employeeName: "Alex",
  roleKey: "marketing",
  roomId: "room_test",
  topicId: "topic_test",
  messageId: "msg_test",
  userMessage: "Can you draft a short landing page outline by Friday?",
  oldProvider: "siliconflow",
  oldModel: "deepseek-ai/DeepSeek-V3",
  oldModelMode: "balanced" as const,
  resolvedRunModelMode: "balanced" as const,
  source: "employee_direct_response_shadow" as const,
};

const BASE_QUEUED_PARAMS = {
  ...BASE_DIRECT_PARAMS,
  runId: "run_test_1",
  usageId: "usage_test_1",
  collaborationId: "collab_test_1",
  collaborationRole: "lead",
  conversationMode: "lead_collaborator",
  source: "employee_queued_response_shadow" as const,
};

let passed = 0;

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function main() {
  await run("off mode — no shadow planning", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, async () => {
      assert(getEmployeeHotPathRuntimeDispatch() === "old", "dispatch must be old");
      assert(!shouldShadowEmployeeHotPath(), "shadow must be disabled");
      const { client, events } = createMockWorkUnitClient();
      const result = await planEmployeeReplyShadowRun({
        ...BASE_DIRECT_PARAMS,
        client,
      });
      assert(result === null, "off mode must skip shadow plan");
      assert(events.length === 0, "off mode must not create work units");
    });
  });

  await run("shadow mode — direct path plans work unit", async () => {
    setHotPathShadowTestHooks(null);
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
        assert(getEmployeeHotPathRuntimeDispatch() === "shadow", "dispatch must be shadow");
        assert(shouldShadowEmployeeHotPath("employee_direct_response_shadow"), "shadow must be enabled");
        assert(!shouldExecuteRuntimeForEmployeeQueuedPath(), "queued runtime execution blocked when flag false");
        assert(!shouldExecuteRuntimeForEmployeeDirectPath(), "direct runtime not enabled in shadow mode");

      const { client, events } = createMockWorkUnitClient();
      const result = await planEmployeeReplyShadowRun({
        ...BASE_DIRECT_PARAMS,
        client,
      });

      assert(result !== null, "shadow plan must return routing");
      assert(result!.shadowCapability === "structured_chat", "expected structured_chat capability");
      assert(
        events.some((e) => e.startsWith("insert:planned:employee_direct_response_shadow")),
        "direct shadow work unit must be planned",
      );

      const last = getAiRuntimeSnapshot().last;
      assert(
        last?.fallbackReason === "employee_direct_response_shadow_plan",
        "direct shadow runtime log reason",
      );
    });
  });

  await run("shadow mode — queued path plans work unit with run metadata", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const { client, events, getLastRow } = createMockWorkUnitClient();
      const result = await planEmployeeReplyShadowRun({
        ...BASE_QUEUED_PARAMS,
        client,
      });

      assert(result !== null, "queued shadow plan must return routing");
      assert(
        events.some((e) => e.startsWith("insert:planned:employee_queued_response_shadow")),
        "queued shadow work unit must be planned",
      );

      const metadata = getLastRow().metadata as Record<string, unknown>;
      assert(metadata.runId === "run_test_1", "queued metadata must include runId");
      assert(metadata.usageId === "usage_test_1", "queued metadata must include usageId");
      assert(metadata.collaborationId === "collab_test_1", "queued metadata must include collaborationId");
    });
  });

  await run("shadow mode — quick_reply capability for greeting", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const result = await planEmployeeReplyShadowRun({
        ...BASE_DIRECT_PARAMS,
        userMessage: "Hey!",
        isGreetingRun: true,
      });
      assert(result?.shadowCapability === "quick_reply", "greeting must map to quick_reply");
    });
  });

  await run("shadow mode — record result completes work unit observation", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const { client, events } = createMockWorkUnitClient();
      const plan = await planEmployeeReplyShadowRun({
        ...BASE_DIRECT_PARAMS,
        client,
      });
      assert(Boolean(plan?.workUnitId), "plan must create work unit id");

      await recordEmployeeReplyShadowResult({
        ...BASE_DIRECT_PARAMS,
        client,
        workUnitId: plan!.workUnitId,
        routing: plan!.routing,
        actualProvider: "siliconflow",
        actualModel: "deepseek-ai/DeepSeek-V3",
        actualModelMode: "balanced",
        actualCostUsd: 0.002,
        inputTokens: 120,
        outputTokens: 80,
        durationMs: 900,
        aiMode: "siliconflow",
      });

      assert(events.some((e) => e.startsWith("update:completed")), "shadow observation must complete work unit");
    });
  });

  await run("on mode — hot path blocked when direct execution disabled", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "false",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        assert(
          getEmployeeHotPathRuntimeDispatch("employee_direct_response_shadow") === "on-blocked",
          "dispatch must be on-blocked when execution disabled",
        );
        assert(shouldShadowEmployeeHotPath("employee_direct_response_shadow"), "shadow still runs when on but execution disabled");
        assert(!shouldExecuteRuntimeForEmployeeQueuedPath(), "queued runtime execution must remain blocked");
        assert(!shouldExecuteRuntimeForEmployeeDirectPath(), "direct execution must be blocked");

        const { client, events } = createMockWorkUnitClient();
        await planEmployeeReplyShadowRun({
          ...BASE_DIRECT_PARAMS,
          client,
        });

        assert(
          events.some((e) => e.startsWith("insert:planned:employee_direct_response_shadow")),
          "on-blocked must still create planned shadow work unit",
        );

        const last = getAiRuntimeSnapshot().last;
        assert(
          last?.fallbackReason === "employee_direct_runtime_execution_disabled",
          "on mode must record direct execution disabled guard",
        );
      },
    );
  });

  await run("on mode + direct execution enabled — direct shadow planning skipped", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "true",
      },
      async () => {
        assert(
          getEmployeeHotPathRuntimeDispatch("employee_direct_response_shadow") === "runtime-on",
          "direct dispatch must be runtime-on when execution enabled",
        );
        assert(
          !shouldShadowEmployeeHotPath("employee_direct_response_shadow"),
          "direct shadow must be skipped when runtime executes",
        );

        const { client, events } = createMockWorkUnitClient();
        const result = await planEmployeeReplyShadowRun({
          ...BASE_DIRECT_PARAMS,
          client,
        });
        assert(result === null, "shadow plan must be skipped");
        assert(events.length === 0, "no shadow work unit when runtime executes");
      },
    );
  });

  await run("on mode + queued execution enabled — queued shadow planning skipped", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "true",
      },
      async () => {
        assert(
          getEmployeeHotPathRuntimeDispatch("employee_queued_response_shadow") === "runtime-on",
          "queued dispatch must be runtime-on when execution enabled",
        );
        assert(
          !shouldShadowEmployeeHotPath("employee_queued_response_shadow"),
          "queued shadow must be skipped when runtime executes",
        );

        const { client, events } = createMockWorkUnitClient();
        const result = await planEmployeeReplyShadowRun({
          ...BASE_QUEUED_PARAMS,
          client,
        });
        assert(result === null, "queued shadow plan must be skipped");
        assert(events.length === 0, "no queued shadow work unit when runtime executes");
      },
    );
  });

  await run("on mode — queued shadow guard when queued execution disabled", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "false",
      },
      async () => {
        const { client, events } = createMockWorkUnitClient();
        await planEmployeeReplyShadowRun({
          ...BASE_QUEUED_PARAMS,
          client,
        });
        assert(
          events.some((e) => e.startsWith("insert:planned:employee_queued_response_shadow")),
          "queued shadow work unit when execution disabled",
        );
        const last = getAiRuntimeSnapshot().last;
        assert(
          last?.fallbackReason === "employee_queued_runtime_execution_disabled",
          "queued guard reason when execution disabled",
        );
      },
    );
  });

  await run("shadow plan failure is swallowed", async () => {
    setHotPathShadowTestHooks(null);
    let failureRecorded = false;

    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      setHotPathShadowTestHooks({
        forcePlanFailure: new Error("test forced shadow plan failure"),
        onFailure: () => {
          failureRecorded = true;
        },
      });

      const result = await planEmployeeReplyShadowRun({
        ...BASE_DIRECT_PARAMS,
        client: createMockWorkUnitClient().client,
      });

      assert(result === null, "failed shadow plan must return null");
      assert(failureRecorded, "failure hook must fire");
    });

    setHotPathShadowTestHooks(null);
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: ${process.exitCode ? "≥1" : 0}  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
