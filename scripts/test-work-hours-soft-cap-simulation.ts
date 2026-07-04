/**
 * V19.9.1c-final — Work Hours soft-cap simulation tests.
 *
 * Usage: npm run test:work-hours:soft-caps
 */

import {
  assertNoForbiddenSoftCapSimulationCopy,
  estimatePreRunWorkMinutes,
  evaluateEmployeeSoftCapSimulation,
  evaluateSoftCapSimulation,
  evaluateWorkspaceSoftCapSimulation,
  getSoftCapSimulationConfig,
  maybeRunSoftCapSimulationForWorkUnit,
  SOFT_CAP_SIMULATION_UI_COPY,
  type SoftCapSimulationAction,
  type SoftCapSimulationResult,
} from "@/lib/ai/work-hours/soft-cap-simulation";

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

const ENFORCEMENT_ACTIONS = ["block", "blocked", "deny", "reject"];

function assertSimulationResultShape(result: SoftCapSimulationResult) {
  assert(result.shadowOnly === true, "shadowOnly must be true");
  assert(typeof result.enabled === "boolean", "enabled must be boolean");
  assert(typeof result.workspaceId === "string", "workspaceId required");
  assert(typeof result.message === "string", "message required");
  assert(!ENFORCEMENT_ACTIONS.includes(result.action), "simulation must not enforce");
}

async function main() {
  console.log("AdeHQ Work Hours Soft-Cap Simulation — V19.9.1c-final\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  const config = getSoftCapSimulationConfig();

  await run("pre-run estimate returns default minutes for known work type", () => {
    assert(
      estimatePreRunWorkMinutes({ workType: "topic_summary" }, config) === 2,
      "expected 2 minutes for topic_summary",
    );
    assert(
      estimatePreRunWorkMinutes({ workType: "file_embedding" }, config) === 5,
      "expected 5 minutes for file_embedding",
    );
    assert(
      estimatePreRunWorkMinutes(
        { workType: "employee_direct_response", estimatedCostUsd: 0.02 },
        config,
      ) === 2,
      "expected cost-derived minutes when cost is available",
    );
  });

  await run("workspace soft-cap simulation below cap: action = allow", () => {
    const result = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 100,
      estimatedNextRunMinutes: 1,
      config: { ...config, defaultWeeklySoftCapMinutes: 600 },
    });
    assertSimulationResultShape(result);
    assert(result.action === "allow", `expected allow, got ${result.action}`);
  });

  await run("workspace soft-cap simulation near cap: action = warn_only", () => {
    const workspace = evaluateWorkspaceSoftCapSimulation({
      usedMinutes: 509,
      estimatedNextRunMinutes: 2,
      softCapMinutes: 600,
      warnThresholdRatio: 0.85,
    });
    assert(workspace.action === "warn_only", `expected warn_only, got ${workspace.action}`);
    assert(workspace.percentOfSoftCap >= 85, "expected >= 85% simulated cap progress");
  });

  await run("workspace soft-cap simulation over cap: action = would_have_capped, shadowOnly=true", () => {
    const result = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 598,
      estimatedNextRunMinutes: 5,
      config: { ...config, defaultWeeklySoftCapMinutes: 600 },
    });
    assertSimulationResultShape(result);
    assert(result.action === "would_have_capped", `expected would_have_capped, got ${result.action}`);
    assert(
      result.message.includes("simulation") || result.message.includes("not enforced"),
      "message should clarify simulation-only behavior",
    );
  });

  await run("employee soft-cap simulation works independently of workspace cap", () => {
    const employee = evaluateEmployeeSoftCapSimulation({
      employeeId: "emp_a",
      usedMinutes: 238,
      estimatedNextRunMinutes: 5,
      softCapMinutes: 240,
    });
    assert(employee.wouldExceedSoftCap, "employee cap should be exceeded");
    assert(employee.action === "would_have_capped", "expected employee would_have_capped");

    const combined = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 100,
      estimatedNextRunMinutes: 5,
      employeeId: "emp_a",
      employeeUsedMinutes: 238,
      config,
    });
    assert(combined.action === "would_have_capped", "employee exceed should drive combined action");
    assert(combined.employeeSimulation?.wouldExceedSoftCap === true, "employee simulation should be set");
  });

  await run("simulation never returns enforcement/blocking action", () => {
    const actions: SoftCapSimulationAction[] = ["allow", "warn_only", "would_have_capped"];
    const scenarios = [
      { usedMinutes: 0, estimatedNextRunMinutes: 1 },
      { usedMinutes: 520, estimatedNextRunMinutes: 2 },
      { usedMinutes: 650, estimatedNextRunMinutes: 10 },
    ];
    for (const scenario of scenarios) {
      const result = evaluateSoftCapSimulation({
        workspaceId: "ws_test",
        weekStart: "2026-07-06",
        ...scenario,
        config,
      });
      assert(actions.includes(result.action), `unexpected action ${result.action}`);
      assert(!ENFORCEMENT_ACTIONS.includes(result.action), "must not enforce");
    }
  });

  await run("forbidden copy guard passes", () => {
    const copy = SOFT_CAP_SIMULATION_UI_COPY.join("\n");
    assert(assertNoForbiddenSoftCapSimulationCopy(copy), `forbidden copy in UI helpers:\n${copy}`);

    const result = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 650,
      estimatedNextRunMinutes: 10,
      config,
    });
    assert(
      assertNoForbiddenSoftCapSimulationCopy(result.message),
      `forbidden copy in simulation message: ${result.message}`,
    );
  });

  await run("endpoint/helper shape includes shadowOnly=true", () => {
    const result = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 200,
      estimatedNextRunMinutes: 2,
      config,
    });
    assertSimulationResultShape(result);
    assert(result.current.usedMinutes === 200, "current.usedMinutes mismatch");
    assert(result.workspaceSimulation.softCapMinutes === config.defaultWeeklySoftCapMinutes, "cap mismatch");
  });

  await run("missing workspaceId does not crash", async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    } as never;

    const result = await maybeRunSoftCapSimulationForWorkUnit(mockClient, {
      id: "wu_test",
      workspaceId: "",
      workType: "topic_summary",
      capability: "summarization",
      status: "created",
      priority: "normal",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert(result === null, "expected null when workspaceId missing");
  });

  await run("disabled env returns enabled=false and no event", () => {
    const previousSim = process.env.AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED;
    const previousPre = process.env.AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED;
    process.env.AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED = "false";
    process.env.AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED = "false";
    try {
      const disabledConfig = getSoftCapSimulationConfig();
      assert(!disabledConfig.simulationEnabled, "simulation should be disabled");
      const result = evaluateSoftCapSimulation({
        workspaceId: "ws_test",
        weekStart: "2026-07-06",
        usedMinutes: 650,
        estimatedNextRunMinutes: 10,
        config: disabledConfig,
      });
      assert(!result.enabled, "result.enabled should be false");
      assert(result.action === "allow", "disabled simulation should not escalate action");
    } finally {
      if (previousSim === undefined) delete process.env.AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED;
      else process.env.AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED = previousSim;
      if (previousPre === undefined) delete process.env.AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED;
      else process.env.AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED = previousPre;
    }
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
