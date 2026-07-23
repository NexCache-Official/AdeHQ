/**
 * Client-safe seed catalog helpers for demo / offline preview.
 * Avoids Node crypto (checksum) and Supabase auth.
 */
import {
  listPublishedSeedCatalog,
  resolveSeedDefinition,
  type PlaybookListItem,
} from "./api-helpers";
import { estimatePlaybookWh } from "./estimator";
import type { PlaybookDefinitionV1 } from "./contracts";

export type { PlaybookListItem };

export function loadDemoPlaybookCatalog(): PlaybookListItem[] {
  return listPublishedSeedCatalog();
}

export function loadDemoPlaybookDetail(playbookIdOrKey: string): {
  definition: PlaybookDefinitionV1;
  estimate: {
    estimatedWhMin: number;
    estimatedWhMax: number;
    hardWhLimit: number;
  };
  name: string;
} | null {
  const definition = resolveSeedDefinition(playbookIdOrKey);
  if (!definition) return null;
  const estimate = estimatePlaybookWh(definition);
  return {
    definition,
    estimate: {
      estimatedWhMin: estimate.estimatedWhMin,
      estimatedWhMax: estimate.estimatedWhMax,
      hardWhLimit: estimate.hardWhLimit,
    },
    name: definition.name,
  };
}

export type DemoPlaybookRun = {
  id: string;
  playbookId: string;
  playbookName: string;
  status: "running" | "completed" | "cancelled";
  estimatedWhMin: number;
  estimatedWhMax: number;
  actualWh: number;
  steps: Array<{
    step_key: string;
    name: string;
    status: "pending" | "running" | "completed" | "cancelled" | "skipped";
    estimated_wh: number | null;
    actual_wh: number;
    assigned_employee_name?: string;
  }>;
  createdAt: string;
};

const DEMO_RUN_PREFIX = "adehq.demo.playbook_run.";

export function createDemoPlaybookRun(input: {
  playbookId: string;
  definition: PlaybookDefinitionV1;
  estimate: { estimatedWhMin: number; estimatedWhMax: number };
}): DemoPlaybookRun {
  const id = `demo_run_${Date.now().toString(36)}`;
  const run: DemoPlaybookRun = {
    id,
    playbookId: input.playbookId,
    playbookName: input.definition.name,
    status: "running",
    estimatedWhMin: input.estimate.estimatedWhMin,
    estimatedWhMax: input.estimate.estimatedWhMax,
    actualWh: 0,
    steps: input.definition.steps.map((step, index) => ({
      step_key: step.stepKey,
      name: step.objective,
      status: index === 0 ? "running" : "pending",
      estimated_wh: step.estimatedWh ?? null,
      actual_wh: 0,
    })),
    createdAt: new Date().toISOString(),
  };
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(DEMO_RUN_PREFIX + id, JSON.stringify(run));
  }
  return run;
}

export function getDemoPlaybookRun(runId: string): DemoPlaybookRun | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(DEMO_RUN_PREFIX + runId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DemoPlaybookRun;
  } catch {
    return null;
  }
}

export function advanceDemoPlaybookRun(runId: string): DemoPlaybookRun | null {
  const run = getDemoPlaybookRun(runId);
  if (!run || run.status !== "running") return run;

  const next = structuredClone(run);
  const runningIdx = next.steps.findIndex((s) => s.status === "running");
  if (runningIdx >= 0) {
    next.steps[runningIdx].status = "completed";
    next.steps[runningIdx].actual_wh = next.steps[runningIdx].estimated_wh ?? 0.5;
    next.actualWh += next.steps[runningIdx].actual_wh;
  }
  const pendingIdx = next.steps.findIndex((s) => s.status === "pending");
  if (pendingIdx >= 0) {
    next.steps[pendingIdx].status = "running";
  } else {
    next.status = "completed";
  }

  sessionStorage.setItem(DEMO_RUN_PREFIX + runId, JSON.stringify(next));
  return next;
}

export function cancelDemoPlaybookRun(runId: string): DemoPlaybookRun | null {
  const run = getDemoPlaybookRun(runId);
  if (!run) return null;
  const next = structuredClone(run);
  next.status = "cancelled";
  for (const step of next.steps) {
    if (step.status === "pending" || step.status === "running") {
      step.status = "cancelled";
    }
  }
  sessionStorage.setItem(DEMO_RUN_PREFIX + runId, JSON.stringify(next));
  return next;
}
