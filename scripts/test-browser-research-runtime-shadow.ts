/**
 * V20.0.1b — Browser research Runtime V2 shadow observation tests.
 *
 * Usage: npm run test:browser-research:shadow
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBrowserResearchRuntimeDispatch,
  observeBrowserResearchRuntimeShadowSafely,
  setBrowserResearchShadowTestHooks,
  shouldExecuteBrowserResearchViaRuntime,
  shouldShadowBrowserResearch,
} from "@/lib/ai/browser-research";
import { createAndRunBrowserResearch } from "@/lib/ai/browser-research/orchestrator";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";
import type { AIEmployee } from "@/lib/types";

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

function baseEmployee(): AIEmployee {
  return {
    id: "emp_research",
    name: "Riley",
    role: "Research",
    roleKey: "research",
    provider: "siliconflow",
    modelMode: "balanced",
    model: "deepseek-ai/DeepSeek-V3",
    status: "idle",
    instructions: "",
    seniority: "mid",
    communicationStyle: "Clear",
    successCriteria: "Useful research",
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
    intelligencePolicy: {
      defaultMode: "balanced",
      allowedModes: ["efficient", "balanced", "strong"],
      routingPreference: "auto",
      browserAccess: "research_only",
      workHourProfile: "moderate",
    },
  };
}

function createShadowMockClient(employee: AIEmployee) {
  const workUnits = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, Record<string, unknown>>();

  const client = {
    from(table: string) {
      if (table === "ai_employees") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: employee.id,
                      name: employee.name,
                      role: employee.role,
                      role_key: employee.roleKey,
                      provider: employee.provider,
                      model: employee.model,
                      model_mode: employee.modelMode,
                      seniority: employee.seniority,
                      status: employee.status,
                      instructions: employee.instructions,
                      communication_style: employee.communicationStyle,
                      success_criteria: employee.successCriteria,
                      permissions: employee.permissions,
                      intelligence_policy: employee.intelligencePolicy,
                      workspace_id: "ws_test",
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }

      if (table === "ai_work_units") {
        return {
          insert(payload: Record<string, unknown>) {
            workUnits.set(String(payload.id), { ...payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: workUnits.get(String(payload.id)), error: null }),
              }),
            };
          },
          update(patch: Record<string, unknown>) {
            const apply = (workspaceId: string, workUnitId: string) => {
              const row = workUnits.get(workUnitId);
              if (row && row.workspace_id === workspaceId) {
                workUnits.set(workUnitId, { ...row, ...patch });
              }
            };
            return {
              eq: (_col: string, workspaceId: string) => ({
                eq: (_col2: string, workUnitId: string) => {
                  apply(workspaceId, workUnitId);
                  return {
                    select: (_cols?: string) => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: workUnits.get(workUnitId), error: null }),
                      single: () =>
                        Promise.resolve({ data: workUnits.get(workUnitId), error: null }),
                    }),
                  };
                },
              }),
            };
          },
          select: () => ({
            eq: (_col: string, workspaceId: string) => ({
              eq: (_col2: string, workUnitId: string) => ({
                maybeSingle: () => {
                  const row = workUnits.get(workUnitId);
                  return Promise.resolve({
                    data: row?.workspace_id === workspaceId ? { metadata: row.metadata } : null,
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
      }

      if (table === "browser_research_runs") {
        return {
          insert(payload: Record<string, unknown>) {
            runs.set(String(payload.id), { ...payload });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: runs.get(String(payload.id)), error: null }),
              }),
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: (_col: string, workspaceId: string) => ({
                eq: (_col2: string, runId: string) => ({
                  select: () => ({
                    maybeSingle: () => {
                      const row = runs.get(runId);
                      if (!row || row.workspace_id !== workspaceId) {
                        return Promise.resolve({ data: null, error: null });
                      }
                      const next = { ...row, ...patch };
                      runs.set(runId, next);
                      return Promise.resolve({ data: next, error: null });
                    },
                  }),
                }),
              }),
            };
          },
          select: () => ({
            eq: (_col: string, workspaceId: string) => ({
              eq: (_col2: string, runId: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: runs.get(runId)?.workspace_id === workspaceId ? runs.get(runId) : null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }

      if (table === "ai_work_minutes_ledger") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
                eq: () => Promise.resolve({ data: [], error: null }),
              }),
              lte: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "ledger_test", work_minutes_charged: null },
                  error: null,
                }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;

  return { client, workUnits };
}

async function main() {
  console.log("AdeHQ Browser Research Runtime Shadow — V20.0.1b\n");
  process.env.AI_WORK_HOURS_SHADOW_ENABLED = "false";

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("off mode — shadow observation disabled", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, () => {
      assert(getBrowserResearchRuntimeDispatch() === "old", "expected old dispatch");
      assert(!shouldShadowBrowserResearch(), "shadow should be off");
      assert(!shouldExecuteBrowserResearchViaRuntime(), "runtime execution deferred");
    });
  });

  await run("shadow mode — dispatch is shadow", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, () => {
      assert(getBrowserResearchRuntimeDispatch() === "shadow", "expected shadow dispatch");
      assert(shouldShadowBrowserResearch(), "shadow should be enabled");
    });
  });

  await run("on mode — runtime execution requires live gates", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "on", BROWSER_RESEARCH_LIVE_ENABLED: "false" }, () => {
      assert(getBrowserResearchRuntimeDispatch() === "runtime-on", "expected runtime-on label");
      assert(!shouldExecuteBrowserResearchViaRuntime(), "live gates should block execution");
    });
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        BROWSER_RESEARCH_LIVE_ENABLED: "true",
        BROWSER_RESEARCH_PROVIDER: "browserbase",
        BROWSERBASE_API_KEY: "test-browserbase-key",
      },
      () => {
        assert(shouldExecuteBrowserResearchViaRuntime(), "all live gates should enable execution");
      },
    );
  });

  await run("routeCapability describes mock browser_research route", () => {
    const route = routeCapability({
      capability: "browser_research",
      researchProvider: "mock",
    });
    assert(route.providerRoute === "mock", "expected mock route");
    assert(route.providerName === "mock", "expected mock provider name");
    assert(route.estimatedWorkMinutes === 15, "expected 15 minutes for mock");
  });

  await run("routeCapability describes Tavily browser_research route", () => {
    const route = routeCapability({
      capability: "browser_research",
      researchProvider: "tavily",
    });
    assert(route.providerRoute === "mock", "runtime execution route stays mock for tavily search");
    assert(route.providerName === "tavily", "expected tavily provider name");
    assert(route.modelId === "tavily/search-api", "expected tavily model id");
    assert(route.estimatedWorkMinutes >= 1, "expected positive tavily work minutes");
    assert(route.estimatedCostUsd > 0, "expected tavily cost estimate");
  });

  await run("routeCapability describes Browserbase browser_research route", () => {
    const route = routeCapability({
      capability: "browser_research",
      researchProvider: "browserbase",
    });
    assert(route.providerName === "browserbase", "expected browserbase provider name");
    assert(route.estimatedWorkMinutes >= 1, "expected positive browserbase work minutes");
    assert(route.estimatedCostUsd > 0, "expected browserbase cost estimate");
    assert(route.fallbackCandidates.length >= 1, "expected fallback candidates");
  });

  await run("shadow observation patches work unit metadata", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const employee = baseEmployee();
      const { client, workUnits } = createShadowMockClient(employee);
      const { run: created } = await createAndRunBrowserResearch(client, {
        workspaceId: "ws_test",
        employeeId: employee.id,
        createdBy: "user_test",
        query: "Research competitors for AdeHQ",
        provider: "mock",
      });
      assert(Boolean(created.workUnitId), "expected work unit id");
      const workUnit = workUnits.get(created.workUnitId!);
      assert(Boolean(workUnit), "expected work unit");
      const metadata = (workUnit as Record<string, unknown>).metadata as Record<string, unknown>;
      assert(metadata.shadowObservation === true, "expected shadow observation flag");
      assert(metadata.shadowProviderRoute === "mock", "expected shadow route");
    });
  });

  await run("forced shadow failure does not break research run", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      setBrowserResearchShadowTestHooks({
        forceShadowFailure: new Error("test forced browser research shadow failure"),
      });
      try {
        const employee = baseEmployee();
        const { client } = createShadowMockClient(employee);
        const { run: created } = await createAndRunBrowserResearch(client, {
          workspaceId: "ws_test",
          employeeId: employee.id,
          createdBy: "user_test",
          query: "Shadow failure must not block",
          provider: "mock",
        });
        assert(created.status === "completed", "research must complete despite shadow failure");
      } finally {
        setBrowserResearchShadowTestHooks(null);
      }
    });
  });

  await run("off mode — observeBrowserResearchRuntimeShadowSafely is no-op", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, async () => {
      const employee = baseEmployee();
      const { client } = createShadowMockClient(employee);
      const result = await observeBrowserResearchRuntimeShadowSafely({
        client,
        workspaceId: "ws_test",
        employeeId: employee.id,
        query: "noop",
        researchProvider: "mock",
        workUnitId: "wu_test",
      });
      assert(result === null, "expected null when shadow disabled");
    });
  });

  await run("shadow mode — runtime log receives browser_research_shadow_plan", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const before = getAiRuntimeSnapshot().recent.length;
      const employee = baseEmployee();
      const { client } = createShadowMockClient(employee);
      const workUnitId = "wu_shadow_log_probe";
      await client.from("ai_work_units").insert({
        id: workUnitId,
        workspace_id: "ws_test",
        employee_id: employee.id,
        work_type: "browser_research",
        capability: "browser_research",
        status: "created",
        priority: "normal",
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await observeBrowserResearchRuntimeShadowSafely({
        client,
        workspaceId: "ws_test",
        employeeId: employee.id,
        query: "Runtime shadow log probe",
        researchProvider: "tavily",
        workUnitId,
      });
      const after = getAiRuntimeSnapshot().recent;
      assert(after.length > before, "expected runtime log entry");
      const entry = after[0];
      assert(
        entry?.fallbackReason === "browser_research_shadow_plan" ||
          after.some((row) => row.fallbackReason === "browser_research_shadow_plan"),
        "expected shadow plan fallback reason",
      );
      assert(
        after.some((row) => row.provider === "tavily" && row.model === "tavily/search-api"),
        "expected tavily shadow route in runtime log",
      );
    });
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
