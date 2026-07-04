/**
 * V19.9.0d-3 — Queued employee Runtime V2 execution tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchEmployeeQueuedResponse,
  getEmployeeQueuedRuntimeDispatch,
  setEmployeeQueuedRuntimeTestHooks,
  shouldAttemptEmployeeQueuedRuntime,
} from "@/lib/ai/runtime/employee-queued-runtime";
import {
  planEmployeeReplyShadowRun,
  shouldShadowEmployeeHotPath,
} from "@/lib/ai/runtime/hot-path-shadow";
import { resolveRunModelMode } from "@/lib/ai/resolve-run-model-mode";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";
import type { ModelMode } from "@/lib/ai/model-catalog";
import type { AIEmployee, EmployeeResponse, ProjectRoom, RoomTopic } from "@/lib/types";

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

const SAMPLE_EMPLOYEE: AIEmployee = {
  id: "emp_alex",
  name: "Alex",
  role: "Marketing",
  roleKey: "marketing",
  provider: "siliconflow",
  modelMode: "balanced",
  model: "deepseek-ai/DeepSeek-V3",
  status: "idle",
  instructions: "",
  seniority: "mid",
  communicationStyle: "Clear",
  successCriteria: "Helpful replies",
  memoryCount: 0,
  tasksCompleted: 0,
  messagesSent: 0,
  approvalsRequested: 0,
  avgResponseTime: "2s",
  trustScore: 0.9,
  accent: "#6366f1",
  lastActiveAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  permissions: {
    readMemory: true,
    writeDraftMemory: true,
    pinMemory: false,
    createTasks: true,
    assignTasks: true,
    messageEmployees: true,
    startCalls: false,
    requestApproval: true,
    approvalBeforeExternal: true,
    approvalBeforeEmails: true,
    approvalBeforeCode: true,
    approvalBeforeBilling: true,
  },
  tools: [],
};

const SAMPLE_TOPIC: RoomTopic = {
  id: "topic_test",
  workspaceId: "ws_test",
  roomId: "room_test",
  title: "Launch planning",
  description: "Q3 launch",
  status: "active",
  priority: "normal",
  createdByType: "human",
  lastActivityAt: new Date().toISOString(),
  messageCount: 1,
  taskCount: 0,
  openTaskCount: 0,
  memoryCount: 0,
  approvalCount: 0,
  agentRunCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SAMPLE_ROOM: ProjectRoom = {
  id: "room_test",
  name: "Launch",
  kind: "room",
  description: "Launch room",
  brief: "",
  humans: ["user_test"],
  aiEmployees: ["emp_alex"],
  messages: [],
  tasks: [],
  memory: [],
  unread: 0,
  accent: "#6366f1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const STUB_LEGACY_RESPONSE: EmployeeResponse = {
  employeeId: "emp_alex",
  employeeName: "Alex",
  reply: "Legacy queued fallback reply.",
  effect: { workLog: [], tasks: [], memory: [], approvals: [] },
};

const QUEUED_USER_MESSAGE =
  "Can you draft a comprehensive research report with many sources attached?";

function buildQueuedDispatch(client: SupabaseClient, resolvedRunModelMode: ReturnType<typeof resolveRunModelMode>) {
  return {
    input: {
      employee: SAMPLE_EMPLOYEE,
      room: {
        ...SAMPLE_ROOM,
        messages: [
          {
            id: "msg_test",
            roomId: "room_test",
            topicId: "topic_test",
            senderType: "human" as const,
            senderId: "user_test",
            senderName: "User",
            content: QUEUED_USER_MESSAGE,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      topic: SAMPLE_TOPIC,
      message: QUEUED_USER_MESSAGE,
      allEmployees: [SAMPLE_EMPLOYEE],
      recentMemory: [],
      topicTasks: [],
      topicApprovals: [],
      topicWorkLogs: [],
      workspaceName: "Test Workspace",
      openTasks: [],
      humanParticipants: [{ id: "user_test", name: "User" }],
    },
    options: {
      mode: "live" as const,
      provider: "siliconflow",
      modelMode: resolvedRunModelMode,
      maxOutputTokens: 1200,
      timeoutMs: 30_000,
      isGreetingRun: false,
      collaborationRole: "lead",
      conversationMode: "lead_collaborator",
      context: {
        workspaceId: "ws_test",
        roomId: "room_test",
        topicId: "topic_test",
        agentRunId: "run_test_1",
        client,
      },
    },
    meta: {
      runId: "run_test_1",
      usageId: "usage_test_1",
      messageId: "msg_test",
      conversationMode: "lead_collaborator",
      collaborationId: "collab_test_1",
      collaborationRole: "lead",
      resolvedRunModelMode,
      oldProvider: "siliconflow",
      oldModel: "deepseek-ai/DeepSeek-V3",
      oldModelMode: "balanced" as ModelMode,
    },
  };
}

function expectedQueuedModelMode() {
  return resolveRunModelMode({
    roleKey: SAMPLE_EMPLOYEE.roleKey,
    employeeModelMode: SAMPLE_EMPLOYEE.modelMode,
    isGreetingRun: false,
    conversationMode: "lead_collaborator",
    collaborationRole: "lead",
    userMessage: QUEUED_USER_MESSAGE,
  });
}

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
  await run("off mode — legacy queued dispatch only", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, () => {
      assert(getEmployeeQueuedRuntimeDispatch() === "old", "expected old dispatch");
      assert(!shouldAttemptEmployeeQueuedRuntime(), "runtime must not be attempted");
    });
  });

  await run("shadow mode — legacy queued path with shadow planning", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      assert(getEmployeeQueuedRuntimeDispatch() === "shadow", "expected shadow dispatch");
      assert(!shouldAttemptEmployeeQueuedRuntime(), "runtime must not execute in shadow");
      assert(shouldShadowEmployeeHotPath("employee_queued_response_shadow"), "queued shadow enabled");

      const { client, events } = createMockWorkUnitClient();
      await planEmployeeReplyShadowRun({
        client,
        workspaceId: "ws_test",
        employeeId: "emp_alex",
        employeeName: "Alex",
        roleKey: "marketing",
        roomId: "room_test",
        topicId: "topic_test",
        userMessage: QUEUED_USER_MESSAGE,
        oldProvider: "siliconflow",
        oldModel: "deepseek-ai/DeepSeek-V3",
        oldModelMode: "balanced",
        runId: "run_test_1",
        usageId: "usage_test_1",
        source: "employee_queued_response_shadow",
      });
      assert(
        events.some((e) => e.startsWith("insert:planned:employee_queued_response_shadow")),
        "queued shadow work unit should be planned",
      );
    });
  });

  await run("on mode with queued execution disabled — legacy guarded", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "false",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        assert(getEmployeeQueuedRuntimeDispatch() === "legacy-guarded", "expected legacy-guarded");
        assert(!shouldAttemptEmployeeQueuedRuntime(), "runtime must not execute when flag false");

        setEmployeeQueuedRuntimeTestHooks({
          stubLegacyResult: {
            response: STUB_LEGACY_RESPONSE,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: false,
          },
        });

        const { client } = createMockWorkUnitClient();
        const resolved = expectedQueuedModelMode();
        const { input, options, meta } = buildQueuedDispatch(client, resolved);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);
        assert(!result.usedRuntime, "must use legacy path");
        assert(result.response.reply === STUB_LEGACY_RESPONSE.reply, "legacy stub reply");

        const last = getAiRuntimeSnapshot().last;
        assert(
          last?.fallbackReason === "employee_queued_runtime_execution_disabled",
          "guard reason must be recorded",
        );

        setEmployeeQueuedRuntimeTestHooks(null);
      },
    );
  });

  await run("on mode + queued execution enabled + mock — runtime executes", async () => {
    setEmployeeQueuedRuntimeTestHooks(null);
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        assert(getEmployeeQueuedRuntimeDispatch() === "runtime-on", "expected runtime-on");
        assert(shouldAttemptEmployeeQueuedRuntime(), "runtime should be attempted");
        assert(
          !shouldShadowEmployeeHotPath("employee_queued_response_shadow"),
          "queued shadow skipped when runtime executes",
        );

        const { client, events } = createMockWorkUnitClient();
        const resolved = expectedQueuedModelMode();
        const { input, options, meta } = buildQueuedDispatch(client, resolved);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);

        assert(result.usedRuntime, "must use runtime path");
        assert(!result.runtimeFallback, "must not fallback on success");
        assert(result.aiMode === "runtime-v2", "runtime aiMode");
        assert(Boolean(result.response.reply), "response must have reply");
        assert(
          events.some((e) => e.startsWith("insert:created:employee_queued_response")),
          "queued runtime work unit must be created",
        );
        assert(events.some((e) => e.startsWith("update:completed")), "queued work unit must complete");
      },
    );
  });

  await run("forced runtime failure — fallback to legacy stub", async () => {
    setEmployeeQueuedRuntimeTestHooks(null);
    let fallbackCalled = false;
    let legacyCalls = 0;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setEmployeeQueuedRuntimeTestHooks({
          forceRuntimeFailure: new Error("test forced employee queued runtime failure"),
          stubLegacyResult: {
            response: STUB_LEGACY_RESPONSE,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: true,
          },
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(
              info.error.includes("test forced employee queued runtime failure"),
              "fallback hook must receive error",
            );
          },
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client, events } = createMockWorkUnitClient();
        const resolved = expectedQueuedModelMode();
        const { input, options, meta } = buildQueuedDispatch(client, resolved);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);

        assert(fallbackCalled, "onRuntimeFallback must fire");
        assert(result.runtimeFallback, "result must mark runtime fallback");
        assert(result.response.reply === STUB_LEGACY_RESPONSE.reply, "legacy stub must be returned");
        assert(legacyCalls === 1, "legacy route must be called exactly once");
        assert(events.some((e) => e.startsWith("update:failed")), "failed work unit must be recorded");

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "employee_queued_runtime_failed", "fallback log reason");
      },
    );

    setEmployeeQueuedRuntimeTestHooks(null);
  });

  await run("no double accounting — runtime success does not call legacy route", async () => {
    setEmployeeQueuedRuntimeTestHooks(null);
    let legacyCalls = 0;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setEmployeeQueuedRuntimeTestHooks({
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client } = createMockWorkUnitClient();
        const resolved = expectedQueuedModelMode();
        const { input, options, meta } = buildQueuedDispatch(client, resolved);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);

        assert(result.usedRuntime, "runtime path must succeed");
        assert(legacyCalls === 0, "legacy route must not run on runtime success");
      },
    );

    setEmployeeQueuedRuntimeTestHooks(null);
  });

  await run("resolveRunModelMode preservation — runtime uses resolved mode", async () => {
    setEmployeeQueuedRuntimeTestHooks(null);
    let capturedModelMode: string | undefined;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        const expected = expectedQueuedModelMode();
        assert(expected === "long_context", "fixture message should resolve to long_context");

        setEmployeeQueuedRuntimeTestHooks({
          onRuntimeSuccess: (info) => {
            capturedModelMode = info.modelMode;
          },
        });

        const { client } = createMockWorkUnitClient();
        const { input, options, meta } = buildQueuedDispatch(client, expected);
        await dispatchEmployeeQueuedResponse(input, options, meta);

        assert(capturedModelMode === expected, "runtime must use resolvedRunModelMode from queued path");
      },
    );

    setEmployeeQueuedRuntimeTestHooks(null);
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: ${process.exitCode ? "≥1" : 0}  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
