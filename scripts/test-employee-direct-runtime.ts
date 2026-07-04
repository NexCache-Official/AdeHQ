/**
 * V19.9.0d-2 — Direct employee respond Runtime V2 execution tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchEmployeeDirectResponse,
  getEmployeeDirectRuntimeDispatch,
  setEmployeeDirectRuntimeTestHooks,
  shouldAttemptEmployeeDirectRuntime,
} from "@/lib/ai/runtime/employee-direct-runtime";
import {
  getEmployeeHotPathRuntimeDispatch,
  planEmployeeReplyShadowRun,
  shouldShadowEmployeeHotPath,
} from "@/lib/ai/runtime/hot-path-shadow";
import { ModelResponseSchema } from "@/lib/ai/schemas";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";
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

  return { client, events };
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
  reply: "Legacy fallback reply.",
  effect: { workLog: [], tasks: [], memory: [], approvals: [] },
};

function buildRouteInput(client: SupabaseClient) {
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
            content: "Can you draft a short landing page outline?",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      topic: SAMPLE_TOPIC,
      message: "Can you draft a short landing page outline?",
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
      modelMode: "balanced" as const,
      maxOutputTokens: 1200,
      timeoutMs: 30_000,
      context: {
        workspaceId: "ws_test",
        roomId: "room_test",
        topicId: "topic_test",
        agentRunId: "run_test",
        client,
      },
    },
  };
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
  await run("off mode — legacy dispatch only", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "off", AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: undefined },
      () => {
        assert(getEmployeeDirectRuntimeDispatch() === "old", "expected old dispatch");
        assert(!shouldAttemptEmployeeDirectRuntime(), "runtime must not be attempted");
        assert(!shouldShadowEmployeeHotPath("employee_direct_response_shadow"), "no shadow when off");
      },
    );
  });

  await run("shadow mode — legacy dispatch with shadow planning", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      assert(getEmployeeDirectRuntimeDispatch() === "shadow", "expected shadow dispatch");
      assert(!shouldAttemptEmployeeDirectRuntime(), "runtime must not execute in shadow");
      assert(shouldShadowEmployeeHotPath("employee_direct_response_shadow"), "shadow planning enabled");

      const { client, events } = createMockWorkUnitClient();
      await planEmployeeReplyShadowRun({
        client,
        workspaceId: "ws_test",
        employeeId: "emp_alex",
        employeeName: "Alex",
        roleKey: "marketing",
        roomId: "room_test",
        topicId: "topic_test",
        userMessage: "Hello!",
        oldProvider: "siliconflow",
        oldModel: "deepseek-ai/DeepSeek-V3",
        oldModelMode: "balanced",
        source: "employee_direct_response_shadow",
      });
      assert(
        events.some((e) => e.startsWith("insert:planned:employee_direct_response_shadow")),
        "shadow work unit should be planned",
      );
    });
  });

  await run("on mode with direct execution disabled — legacy guarded", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "false",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        assert(getEmployeeDirectRuntimeDispatch() === "legacy-guarded", "expected legacy-guarded");
        assert(!shouldAttemptEmployeeDirectRuntime(), "runtime must not execute when flag false");

        setEmployeeDirectRuntimeTestHooks({
          stubLegacyResult: {
            response: STUB_LEGACY_RESPONSE,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: false,
          },
        });

        const { client } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, options);
        assert(!result.usedRuntime, "must use legacy path");
        assert(result.response.reply === STUB_LEGACY_RESPONSE.reply, "legacy stub reply");

        const last = getAiRuntimeSnapshot().last;
        assert(
          last?.fallbackReason === "employee_direct_runtime_execution_disabled",
          "guard reason must be recorded",
        );

        setEmployeeDirectRuntimeTestHooks(null);
      },
    );
  });

  await run("on mode + direct execution enabled + mock — runtime executes", async () => {
    setEmployeeDirectRuntimeTestHooks(null);
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        assert(getEmployeeDirectRuntimeDispatch() === "runtime-on", "expected runtime-on");
        assert(shouldAttemptEmployeeDirectRuntime(), "runtime should be attempted");
        assert(
          !shouldShadowEmployeeHotPath("employee_direct_response_shadow"),
          "shadow skipped when runtime executes",
        );

        const { client, events } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, options);

        assert(result.usedRuntime, "must use runtime path");
        assert(!result.runtimeFallback, "must not fallback on success");
        assert(result.aiMode === "runtime-v2", "runtime aiMode");
        assert(ModelResponseSchema.safeParse({
          reply: result.response.reply,
          effects: result.response.effect,
        }).success || Boolean(result.response.reply), "response must be schema-valid or non-empty");

        assert(
          events.some((e) => e.startsWith("insert:created:employee_direct_response")),
          "runtime work unit must be created",
        );
        assert(events.some((e) => e.startsWith("update:completed")), "runtime work unit must complete");
      },
    );
  });

  await run("forced runtime failure — fallback to legacy stub", async () => {
    setEmployeeDirectRuntimeTestHooks(null);
    let fallbackCalled = false;
    let legacyCalls = 0;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setEmployeeDirectRuntimeTestHooks({
          forceRuntimeFailure: new Error("test forced employee direct runtime failure"),
          stubLegacyResult: {
            response: STUB_LEGACY_RESPONSE,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: true,
          },
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(
              info.error.includes("test forced employee direct runtime failure"),
              "fallback hook must receive error",
            );
          },
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client, events } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, options);

        assert(fallbackCalled, "onRuntimeFallback must fire");
        assert(result.runtimeFallback, "result must mark runtime fallback");
        assert(result.response.reply === STUB_LEGACY_RESPONSE.reply, "legacy stub must be returned");
        assert(legacyCalls === 1, "legacy route must be called exactly once");
        assert(events.some((e) => e.startsWith("update:failed")), "failed work unit must be recorded");

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "employee_direct_runtime_failed", "fallback log reason");
      },
    );

    setEmployeeDirectRuntimeTestHooks(null);
  });

  await run("no double accounting — runtime success does not call legacy route", async () => {
    setEmployeeDirectRuntimeTestHooks(null);
    let legacyCalls = 0;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "true",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setEmployeeDirectRuntimeTestHooks({
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, options);

        assert(result.usedRuntime, "runtime path must succeed");
        assert(legacyCalls === 0, "legacy route must not run on runtime success");
      },
    );

    setEmployeeDirectRuntimeTestHooks(null);
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: ${process.exitCode ? "≥1" : 0}  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
