/**
 * V20.0.0 — Browser Research Skeleton mock tests.
 *
 * Usage: npm run test:browser-research:mock
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertBrowserResearchAllowed,
  BROWSER_RESEARCH_DEFAULT_WORK_MINUTES,
  BROWSER_RESEARCH_FORBIDDEN_COPY,
  BROWSER_RESEARCH_QUERY_MAX_LENGTH,
  BROWSER_RESEARCH_UI_COPY,
  canEmployeeUseBrowserResearch,
  runMockBrowserResearchProvider,
} from "@/lib/ai/browser-research";
import {
  createAndRunBrowserResearchMock,
  createBrowserResearchRun,
  runBrowserResearchMock,
} from "@/lib/ai/browser-research/orchestrator";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import type { AIEmployee } from "@/lib/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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

function baseEmployee(browserAccess: "none" | "research_only" | "full_later"): AIEmployee {
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
      browserAccess,
      workHourProfile: "moderate",
    },
  };
}

function createBrowserResearchMockClient(employee: AIEmployee) {
  const workUnits = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, Record<string, unknown>>();
  let liveWebCalls = 0;

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
            return {
              eq: (_col: string, workspaceId: string) => ({
                eq: (_col2: string, workUnitId: string) => ({
                  select: () => ({
                    maybeSingle: () => {
                      const row = workUnits.get(workUnitId);
                      if (!row || row.workspace_id !== workspaceId) {
                        return Promise.resolve({ data: null, error: null });
                      }
                      const next = { ...row, ...patch };
                      workUnits.set(workUnitId, next);
                      return Promise.resolve({ data: next, error: null });
                    },
                  }),
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
    // Hook to detect accidental live web usage in future providers
    __liveWebCall: () => {
      liveWebCalls += 1;
    },
  } as unknown as SupabaseClient & { __liveWebCall: () => void };

  return {
    client,
    workUnits,
    runs,
    getLiveWebCalls: () => liveWebCalls,
  };
}

function assertNoForbiddenCopy(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of BROWSER_RESEARCH_FORBIDDEN_COPY) {
    assert(!lower.includes(phrase), `forbidden copy found: "${phrase}" in "${text}"`);
  }
}

function validateCreatePayload(body: { query?: string; workspaceId?: string; employeeId?: string }) {
  if (!body.workspaceId?.trim()) return "workspaceId is required.";
  if (!body.employeeId?.trim()) return "employeeId is required.";
  if (!body.query?.trim()) return "query is required.";
  if (body.query.length > BROWSER_RESEARCH_QUERY_MAX_LENGTH) {
    return `Research query must be at most ${BROWSER_RESEARCH_QUERY_MAX_LENGTH} characters.`;
  }
  return null;
}

async function main() {
  console.log("AdeHQ Browser Research Skeleton — V20.0.0\n");
  process.env.AI_WORK_HOURS_SHADOW_ENABLED = "false";

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("permission helper denies browserAccess none", () => {
    const employee = baseEmployee("none");
    assert(!canEmployeeUseBrowserResearch(employee), "expected denial for none");
    let threw = false;
    try {
      assertBrowserResearchAllowed(employee);
    } catch {
      threw = true;
    }
    assert(threw, "expected assertBrowserResearchAllowed to throw");
  });

  await run("permission helper allows research_only", () => {
    const employee = baseEmployee("research_only");
    assert(canEmployeeUseBrowserResearch(employee), "expected allow for research_only");
    assertBrowserResearchAllowed(employee);
  });

  await run("mock provider returns planned steps/sources/findings", () => {
    const mock = runMockBrowserResearchProvider("Research competitors for AdeHQ");
    assert(mock.plannedSteps.length === 3, "expected 3 planned steps");
    assert(mock.mockSources.length === 3, "expected 3 mock sources");
    assert(mock.findings.length === 3, "expected 3 findings");
    assert(mock.estimatedWorkMinutes === 15, "expected 15 work minutes");
    for (const source of mock.mockSources) {
      assert(source.title.includes("[Mock]"), "mock sources must be labelled");
      assert(source.note.toLowerCase().includes("mock") || source.note.toLowerCase().includes("simulated"), "mock note required");
      assertNoForbiddenCopy(`${source.title} ${source.note}`);
    }
    for (const finding of mock.findings) {
      assert(finding.title.toLowerCase().includes("mock"), "findings must be labelled mock");
      assertNoForbiddenCopy(`${finding.title} ${finding.summary}`);
    }
  });

  await run("orchestrator creates browser_research work unit", async () => {
    const employee = baseEmployee("research_only");
    const { client, workUnits } = createBrowserResearchMockClient(employee);
    const runRow = await createBrowserResearchRun(client, {
      workspaceId: "ws_test",
      employeeId: employee.id,
      createdBy: "user_test",
      query: "Research competitors for AdeHQ",
    });
    assert(Boolean(runRow.workUnitId), "expected work unit id on run");
    const workUnit = workUnits.get(runRow.workUnitId!);
    assert(workUnit?.work_type === "browser_research", "expected browser_research work type");
    assert(workUnit?.capability === "browser_research", "expected browser_research capability");
  });

  await run("orchestrator completes mock run", async () => {
    const employee = baseEmployee("research_only");
    const { client } = createBrowserResearchMockClient(employee);
    const completed = await createAndRunBrowserResearchMock(client, {
      workspaceId: "ws_test",
      employeeId: employee.id,
      createdBy: "user_test",
      query: "Research market positioning for AdeHQ",
    });
    assert(completed.status === "completed", `expected completed, got ${completed.status}`);
    assert(completed.plannedSteps.length === 3, "expected planned steps on completed run");
    assert(completed.mockSources.length === 3, "expected mock sources on completed run");
    assert(completed.findings.length === 3, "expected findings on completed run");
  });

  await run("work unit has estimatedWorkMinutes = 15 by default", async () => {
    const employee = baseEmployee("research_only");
    const { client, workUnits } = createBrowserResearchMockClient(employee);
    const runRow = await createBrowserResearchRun(client, {
      workspaceId: "ws_test",
      employeeId: employee.id,
      createdBy: "user_test",
      query: "Estimate work minutes",
    });
    const workUnit = workUnits.get(runRow.workUnitId!);
    assert(Number(workUnit?.estimated_work_minutes) === BROWSER_RESEARCH_DEFAULT_WORK_MINUTES, "expected 15 estimated minutes");
  });

  await run("no live web provider is called", async () => {
    const employee = baseEmployee("research_only");
    const { client, getLiveWebCalls } = createBrowserResearchMockClient(employee);
    await createAndRunBrowserResearchMock(client, {
      workspaceId: "ws_test",
      employeeId: employee.id,
      createdBy: "user_test",
      query: "No live browsing",
    });
    assert(getLiveWebCalls() === 0, "expected zero live web calls");

    const route = routeCapability({ capability: "browser_research", researchProvider: "mock" }, "auto");
    assert(route.providerRoute === "mock", "browser_research must route to mock until V20.0.2 live browser");
    assert(route.estimatedWorkMinutes === 15, "expected 15 minute route estimate for mock");
  });

  await run("API payload validation rejects missing query", () => {
    assert(validateCreatePayload({ workspaceId: "ws", employeeId: "emp" }) === "query is required.", "missing query");
    assert(validateCreatePayload({ query: "ok", employeeId: "emp" }) === "workspaceId is required.", "missing workspace");
    assert(validateCreatePayload({ query: "ok", workspaceId: "ws" }) === "employeeId is required.", "missing employee");
    assert(validateCreatePayload({ query: "ok", workspaceId: "ws", employeeId: "emp" }) === null, "valid payload");
  });

  await run("forbidden copy guard — UI and mock strings", () => {
    const uiCopy = Object.values(BROWSER_RESEARCH_UI_COPY).join(" ");
    assertNoForbiddenCopy(uiCopy);
    const mock = runMockBrowserResearchProvider("test");
    assertNoForbiddenCopy(JSON.stringify(mock));
  });

  const hasSupabase =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) &&
    Boolean(process.env.SUPABASE_SECRET_KEY?.trim());

  if (!hasSupabase) {
    console.log("SKIP  live Supabase browser research integration");
    console.log("      Supabase secret key env missing");
  } else {
    await run("live Supabase integration — create + complete mock run", async () => {
      const { createSupabaseSecretClient } = await import("@/lib/supabase/server");
      const { loadWorkspaceEmployee } = await import("@/lib/ai/browser-research/orchestrator");
      const client = createSupabaseSecretClient();
      const { data: employees } = await client
        .from("ai_employees")
        .select("id, workspace_id")
        .limit(20);
      if (!employees?.length) {
        console.log("      no ai_employees row — skipping live insert");
        return;
      }
      let target: { id: string; workspace_id: string } | null = null;
      for (const row of employees as Array<{ id: string; workspace_id: string }>) {
        const loaded = await loadWorkspaceEmployee(client, row.workspace_id, row.id);
        if (loaded && canEmployeeUseBrowserResearch(loaded)) {
          target = row;
          break;
        }
      }
      if (!target) {
        console.log("      no research-enabled employee — skipping live insert");
        return;
      }
      const created = await createBrowserResearchRun(client, {
        workspaceId: target.workspace_id,
        employeeId: target.id,
        createdBy: "00000000-0000-0000-0000-000000000001",
        query: "Live skeleton smoke test",
      });
      const completed = await runBrowserResearchMock(client, target.workspace_id, created.id);
      assert(completed.status === "completed", "live run should complete");
    });
  }

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
