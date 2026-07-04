/**
 * V19.9.0d-4 — Model router cleanup compatibility lock tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmployeePromptContext,
  buildEmployeePrompts,
  resolveDirectEmployeeModelMode,
} from "@/lib/ai/employee-response-contract";
import {
  dispatchEmployeeDirectResponse,
  getEmployeeDirectRuntimeDispatch,
  setEmployeeDirectRuntimeTestHooks,
  shouldAttemptEmployeeDirectRuntime,
} from "@/lib/ai/runtime/employee-direct-runtime";
import {
  dispatchEmployeeQueuedResponse,
  getEmployeeQueuedRuntimeDispatch,
  setEmployeeQueuedRuntimeTestHooks,
  shouldAttemptEmployeeQueuedRuntime,
} from "@/lib/ai/runtime/employee-queued-runtime";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { resolveRunModelMode } from "@/lib/ai/resolve-run-model-mode";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";
import { defaultModelModeForRole } from "@/lib/ai/model-catalog";
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
  instructions: "Always be helpful.",
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

const USER_MESSAGE = "Can you draft a comprehensive research report with many sources?";

const STUB_LEGACY: EmployeeResponse = {
  employeeId: "emp_alex",
  employeeName: "Alex",
  reply: "Legacy compat stub reply.",
  effect: { workLog: [], tasks: [], memory: [], approvals: [] },
};

function buildRouteInput(client: SupabaseClient) {
  const input = {
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
          content: USER_MESSAGE,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    topic: SAMPLE_TOPIC,
    message: USER_MESSAGE,
    allEmployees: [SAMPLE_EMPLOYEE],
    recentMemory: [
      {
        id: "mem_1",
        roomId: "room_test",
        topicId: "topic_test",
        title: "Prior decision",
        content: "Ship in Q3",
        type: "decision" as const,
        status: "approved" as const,
        createdByType: "human" as const,
        createdById: "user_test",
        createdAt: new Date().toISOString(),
      },
    ],
    topicTasks: [],
    topicApprovals: [],
    topicWorkLogs: [],
    workspaceName: "Test Workspace",
    openTasks: [{ id: "task_1", title: "Draft report", status: "open", priority: "high" }],
    humanParticipants: [{ id: "user_test", name: "User" }],
    fileContextPrompt: "File context block",
    artifactIntent: undefined,
  };

  const resolved = resolveRunModelMode({
    roleKey: SAMPLE_EMPLOYEE.roleKey,
    employeeModelMode: SAMPLE_EMPLOYEE.modelMode,
    isGreetingRun: false,
    conversationMode: "lead_collaborator",
    collaborationRole: "lead",
    userMessage: USER_MESSAGE,
  });

  return {
    input,
    options: {
      mode: "live" as const,
      provider: "siliconflow",
      modelMode: resolved,
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
      resolvedRunModelMode: resolved,
      oldProvider: "siliconflow",
      oldModel: "deepseek-ai/DeepSeek-V3",
      oldModelMode: "balanced" as const,
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
  await run("default env — direct and queued remain legacy", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: undefined,
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: undefined,
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: undefined,
      },
      () => {
        const flags = getRuntimeFlags();
        assert(flags.mode === "off", "default mode must be off");
        assert(!flags.employeeDirectExecution, "direct execution default false");
        assert(!flags.employeeQueuedExecution, "queued execution default false");
        assert(getEmployeeDirectRuntimeDispatch() === "old", "direct dispatch old");
        assert(getEmployeeQueuedRuntimeDispatch() === "old", "queued dispatch old");
        assert(!shouldAttemptEmployeeDirectRuntime(), "direct runtime not attempted");
        assert(!shouldAttemptEmployeeQueuedRuntime(), "queued runtime not attempted");
      },
    );
  });

  await run("legacy direct disabled when on but execution flag false", async () => {
    setEmployeeDirectRuntimeTestHooks({
      stubLegacyResult: {
        response: STUB_LEGACY,
        aiMode: "legacy-stub",
        usedRuntime: false,
        runtimeFallback: false,
      },
    });

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "false",
      },
      async () => {
        const { client } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, {
          ...options,
          modelMode: resolveDirectEmployeeModelMode(SAMPLE_EMPLOYEE.modelMode, SAMPLE_EMPLOYEE.roleKey),
        });
        assert(!result.usedRuntime, "direct must use legacy when flag false");
        assert(
          getAiRuntimeSnapshot().last?.fallbackReason === "employee_direct_runtime_execution_disabled",
          "direct guard logged",
        );
      },
    );

    setEmployeeDirectRuntimeTestHooks(null);
  });

  await run("legacy queued disabled when on but execution flag false", async () => {
    setEmployeeQueuedRuntimeTestHooks({
      stubLegacyResult: {
        response: STUB_LEGACY,
        aiMode: "legacy-stub",
        usedRuntime: false,
        runtimeFallback: false,
      },
    });

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "false",
      },
      async () => {
        const { client } = createMockWorkUnitClient();
        const { input, options, meta } = buildRouteInput(client);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);
        assert(!result.usedRuntime, "queued must use legacy when flag false");
        assert(
          getAiRuntimeSnapshot().last?.fallbackReason === "employee_queued_runtime_execution_disabled",
          "queued guard logged",
        );
      },
    );

    setEmployeeQueuedRuntimeTestHooks(null);
  });

  await run("direct runtime failure — legacy fallback once with stable shape", async () => {
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
          forceRuntimeFailure: new Error("compat direct runtime failure"),
          stubLegacyResult: {
            response: STUB_LEGACY,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: true,
          },
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client } = createMockWorkUnitClient();
        const { input, options } = buildRouteInput(client);
        const result = await dispatchEmployeeDirectResponse(input, options);

        assert(result.runtimeFallback, "must mark runtime fallback");
        assert(legacyCalls === 1, "legacy called once");
        assert(result.response.employeeId === STUB_LEGACY.employeeId, "employeeId stable");
        assert(result.response.employeeName === STUB_LEGACY.employeeName, "employeeName stable");
        assert(Array.isArray(result.response.effect.workLog), "effect.workLog array");
      },
    );

    setEmployeeDirectRuntimeTestHooks(null);
  });

  await run("queued runtime failure — legacy fallback once with stable shape", async () => {
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
          forceRuntimeFailure: new Error("compat queued runtime failure"),
          stubLegacyResult: {
            response: STUB_LEGACY,
            aiMode: "legacy-stub",
            usedRuntime: false,
            runtimeFallback: true,
          },
          onLegacyRoute: () => {
            legacyCalls += 1;
          },
        });

        const { client } = createMockWorkUnitClient();
        const { input, options, meta } = buildRouteInput(client);
        const result = await dispatchEmployeeQueuedResponse(input, options, meta);

        assert(result.runtimeFallback, "must mark runtime fallback");
        assert(legacyCalls === 1, "legacy called once");
        assert(result.response.reply === STUB_LEGACY.reply, "legacy reply shape preserved");
      },
    );

    setEmployeeQueuedRuntimeTestHooks(null);
  });

  await run("prompt contract stability — shared helpers include expected context", async () => {
    const { input } = buildRouteInput(createMockWorkUnitClient().client);
    const ctx = buildEmployeePromptContext(input);
    assert(ctx.employee.name === "Alex", "employee name in prompt context");
    assert(ctx.employee.role === "Marketing", "employee role in prompt context");
    assert(ctx.employee.instructions === "Always be helpful.", "instructions preserved");
    assert(ctx.recentMemory.length === 1, "memory included");
    assert(ctx.openTasks.length === 1, "open tasks included");
    assert(ctx.userMessage === USER_MESSAGE, "user message included");
    assert(ctx.fileContextPrompt === "File context block", "file context included");

    const { system, prompt } = buildEmployeePrompts(input, {
      conversationMode: "lead_collaborator",
      collaborationRole: "lead",
    });
    assert(system.includes("Alex") || prompt.includes("Alex"), "employee name appears in prompts");
    assert(prompt.length > 20, "user prompt non-empty");
    assert(system.length > 20, "system prompt non-empty");
  });

  await run("model mode stability — direct uses role default path", async () => {
    const withoutOverride = resolveDirectEmployeeModelMode(undefined, "marketing");
    assert(
      withoutOverride === defaultModelModeForRole("marketing"),
      "direct mode falls back to role default",
    );
    assert(
      resolveDirectEmployeeModelMode("strong", "marketing") === "strong",
      "direct mode respects employee override",
    );
  });

  await run("model mode stability — queued uses resolveRunModelMode", async () => {
    const expected = resolveRunModelMode({
      roleKey: SAMPLE_EMPLOYEE.roleKey,
      employeeModelMode: SAMPLE_EMPLOYEE.modelMode,
      isGreetingRun: false,
      conversationMode: "lead_collaborator",
      collaborationRole: "lead",
      userMessage: USER_MESSAGE,
    });
    assert(expected === "long_context", "fixture resolves to long_context");
    const { meta } = buildRouteInput(createMockWorkUnitClient().client);
    assert(meta.resolvedRunModelMode === expected, "queued meta uses resolvedRunModelMode");
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: ${process.exitCode ? "≥1" : 0}  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
