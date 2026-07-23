import type { SupabaseClient } from "@supabase/supabase-js";
import {
  advanceReadySteps,
  allStepsTerminal,
  enforceHardWhCap,
  getDefinitionStep,
  type PlaybookRunEnvelopeStep,
} from "@/lib/playbooks/executor";
import type {
  PlaybookDefinitionV1,
  PlaybookRunStatus,
  PlaybookStepStatus,
} from "@/lib/playbooks/contracts";
import { resolveStepInputs } from "@/lib/playbooks/inputs";
import { dispatchStepKind, type StepExecutorContext } from "@/lib/playbooks/step-executor";
import {
  getPlaybookRun,
  updatePlaybookRunStatus,
  type PlaybookRunRow,
  type PlaybookRunStepRow,
} from "@/lib/playbooks/repository";
import { isTerminalPlaybookRunStatus, isTerminalPlaybookStepStatus } from "@/lib/playbooks/state-machine";
import { executeProcedure } from "@/lib/procedures";
import { validateDocument, validatePresentation, validateWorkbook } from "@/lib/artifacts/schemas/validate";
import {
  createBrainRun,
  insertDecisionAttempt,
  newCapabilityStepId,
} from "@/lib/brain/decisions/persist";
import { enqueueBrainStep } from "@/lib/brain/reliability/lifecycle";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { composePlaybookArtifact } from "./compose-artifact";

export const PLAYBOOK_RUNTIME_LEASE_OWNER = "playbook-runtime";
export const PLAYBOOK_RUNTIME_LEASE_MS = 60_000;

export type ProcessPlaybookRunWaveOpts = {
  runId: string;
  /** Optional override; defaults to createSupabaseSecretClient for brain/artifact writes. */
  serviceClient?: SupabaseClient;
  maxParallelOverride?: number;
  now?: Date;
};

export type ProcessPlaybookRunWaveResult = {
  ok: boolean;
  runId: string;
  processedStepKeys: string[];
  status: PlaybookRunStatus;
  artifactsCreated: string[];
  error?: string;
};

export type StepResultPatch = {
  status: PlaybookStepStatus;
  outputPayload?: Record<string, unknown> | null;
  outputArtifactId?: string | null;
  actualWh?: number;
  errorCode?: string | null;
  safeErrorMessage?: string | null;
  completedAt?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
};

/** Pure: pick up to maxParallel ready step keys (stable order). */
export function selectReadyStepKeys(
  steps: Array<{ stepKey: string; status: PlaybookStepStatus }>,
  maxParallel: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxParallel) || 1);
  return steps
    .filter((s) => s.status === "ready")
    .map((s) => s.stepKey)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

export function resolveMaxParallel(
  definition: PlaybookDefinitionV1,
  override?: number,
): number {
  if (typeof override === "number" && override > 0) return Math.floor(override);
  const level = definition.policies?.collaborationMaxLevel;
  if (typeof level === "number" && level > 0) return Math.min(3, Math.max(1, level));
  return 2;
}

export function canReclaimStepLease(
  step: {
    status: PlaybookStepStatus;
    leaseOwner?: string | null;
    leaseExpiresAt?: string | null;
  },
  owner: string,
  now: Date,
): boolean {
  if (step.status === "completed" || step.status === "skipped" || step.status === "cancelled") {
    return false;
  }
  if (step.status !== "leased" && step.status !== "running") return false;
  const expires = step.leaseExpiresAt ? Date.parse(step.leaseExpiresAt) : NaN;
  if (!Number.isFinite(expires)) return step.leaseOwner === owner;
  if (expires > now.getTime()) {
    // Still leased — only same owner may continue (idempotent resume).
    return step.leaseOwner === owner;
  }
  // Expired — reclaimable by runtime owner.
  return true;
}

export function applyStepResult(
  step: PlaybookRunEnvelopeStep,
  result: { ok: boolean; output?: Record<string, unknown>; errorCode?: string; safeErrorMessage?: string; actualWh?: number },
): StepResultPatch {
  if (result.ok) {
    return {
      status: "completed",
      outputPayload: result.output ?? {},
      actualWh: result.actualWh ?? step.estimatedWh,
      errorCode: null,
      safeErrorMessage: null,
      completedAt: new Date().toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
    };
  }
  return {
    status: "failed",
    outputPayload: result.output ?? {},
    actualWh: 0,
    errorCode: result.errorCode ?? "step_failed",
    safeErrorMessage: result.safeErrorMessage ?? "Step failed",
    completedAt: new Date().toISOString(),
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}

export function dbStepsToEnvelopeSteps(steps: PlaybookRunStepRow[]): PlaybookRunEnvelopeStep[] {
  return steps.map((s) => ({
    stepKey: s.step_key,
    status: s.status,
    roleKey: "",
    employeeId: s.assigned_employee_id,
    dependsOn: s.depends_on ?? [],
    estimatedWh: Number(s.estimated_wh ?? 0),
    actualWh: Number(s.actual_wh ?? 0),
    brainCapabilityStepId: s.brain_step_id,
    brainRunId: null,
    outputPayload: s.output_payload,
    errorCode: s.error_code,
  }));
}

export function summarizeRunTerminalStatus(
  steps: Array<{ status: PlaybookStepStatus }>,
  cancelledAt: string | null | undefined,
): PlaybookRunStatus {
  if (cancelledAt) return "cancelled";
  if (!allStepsTerminal(steps as PlaybookRunEnvelopeStep[])) return "running";
  const anyFailed = steps.some((s) => s.status === "failed");
  return anyFailed ? "failed" : "completed";
}

/**
 * Simulate one in-memory wave (no DB) — used by unit tests.
 * Completes selected ready steps via a stub result factory.
 */
export function simulateProcessWave(opts: {
  definition: PlaybookDefinitionV1;
  steps: PlaybookRunEnvelopeStep[];
  actualWh: number;
  hardWhLimit: number;
  maxParallel?: number;
  resultForStep?: (stepKey: string) => { ok: boolean; output?: Record<string, unknown>; actualWh?: number };
}): {
  steps: PlaybookRunEnvelopeStep[];
  processedStepKeys: string[];
  actualWh: number;
  status: PlaybookRunStatus;
} {
  let steps = advanceReadySteps(opts.steps, opts.definition);
  const maxParallel = resolveMaxParallel(opts.definition, opts.maxParallel);
  const readyKeys = selectReadyStepKeys(steps, maxParallel);
  const processed: string[] = [];
  let actualWh = opts.actualWh;

  for (const stepKey of readyKeys) {
    const step = steps.find((s) => s.stepKey === stepKey);
    if (!step || step.status !== "ready") continue;
    const defStep = getDefinitionStep(opts.definition, stepKey);
    const nextWh = step.estimatedWh;
    const cap = enforceHardWhCap(actualWh, nextWh, opts.hardWhLimit);
    if (!cap.allowed) {
      steps = steps.map((s) =>
        s.stepKey === stepKey
          ? {
              ...s,
              status: "failed" as const,
              errorCode: "hard_wh_cap",
            }
          : s,
      );
      processed.push(stepKey);
      continue;
    }
    const result = opts.resultForStep?.(stepKey) ?? {
      ok: true,
      output: { structured: true, stepKey, kind: defStep?.kind },
      actualWh: cap.nextMax,
    };
    const patch = applyStepResult(step, result);
    actualWh += Number(patch.actualWh ?? 0);
    steps = steps.map((s) =>
      s.stepKey === stepKey
        ? {
            ...s,
            status: patch.status,
            actualWh: Number(patch.actualWh ?? 0),
            outputPayload: patch.outputPayload,
            errorCode: patch.errorCode,
          }
        : s,
    );
    processed.push(stepKey);
  }

  steps = advanceReadySteps(steps, opts.definition);
  const status = summarizeRunTerminalStatus(steps, null);
  return { steps, processedStepKeys: processed, actualWh, status };
}

function stepOutputsMap(steps: PlaybookRunStepRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of steps) {
    if (s.output_payload && (s.status === "completed" || s.status === "skipped")) {
      out[s.step_key] = s.output_payload;
    }
  }
  return out;
}

async function ensureBrainRunId(
  service: SupabaseClient,
  run: PlaybookRunRow,
): Promise<string> {
  if (run.brain_run_id) return run.brain_run_id;
  const brainRunId = await createBrainRun(service, {
    workspaceId: run.workspace_id,
    employeeId: run.selected_employee_ids?.[0] ?? null,
    roomId: run.room_id,
    topicId: run.topic_id,
    intensity: "standard",
    metadata: {
      playbookRunId: run.id,
      playbookId: run.playbook_id,
      source: "playbook_runtime",
    },
  });
  await service.from("playbook_runs").update({ brain_run_id: brainRunId }).eq("id", run.id);
  return brainRunId;
}

async function ensureDecisionAttemptId(
  service: SupabaseClient,
  brainRunId: string,
  capability: string,
): Promise<string> {
  const { data: existing } = await service
    .from("brain_decision_attempts")
    .select("id")
    .eq("brain_run_id", brainRunId)
    .in("status", ["running", "accepted"])
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  return insertDecisionAttempt(service, {
    brainRunId,
    attemptNumber: 1,
    reason: "playbook_runtime_wave",
    capability,
    intensity: "standard",
    routeId: "playbook_runtime_v1",
    scoreFactors: { playbook: 1 },
  });
}

async function ensureBrainCapabilityStep(
  service: SupabaseClient,
  opts: {
    brainRunId: string;
    workspaceId: string;
    stepKey: string;
    capability: string;
    assignedEmployeeId: string | null;
    estimatedWh: number;
    existingBrainStepId: string | null;
  },
): Promise<string> {
  if (opts.existingBrainStepId) return opts.existingBrainStepId;

  const decisionAttemptId = await ensureDecisionAttemptId(
    service,
    opts.brainRunId,
    opts.capability,
  );

  try {
    const enqueued = await enqueueBrainStep(service, {
      brainRunId: opts.brainRunId,
      decisionAttemptId,
      capability: opts.capability,
      routeId: `playbook_${opts.capability}`,
      assignedEmployeeId: opts.assignedEmployeeId,
      logicalStepKey: opts.stepKey,
      workspaceId: opts.workspaceId,
      estimatedWh: opts.estimatedWh,
      outputContract: {
        kind: "playbook_step",
        stepKey: opts.stepKey,
      },
      maxCostUsd: Math.max(0.01, opts.estimatedWh * 0.02),
    });
    return enqueued.stepId;
  } catch {
    // Minimal insert fallback matching enqueueBrainStep columns.
    const id = newCapabilityStepId();
    const { error } = await service.from("brain_capability_steps").insert({
      id,
      brain_run_id: opts.brainRunId,
      decision_attempt_id: decisionAttemptId,
      capability: opts.capability,
      route_id: `playbook_${opts.capability}`,
      dependencies: [],
      input_artifact_ids: [],
      output_contract: { kind: "playbook_step", stepKey: opts.stepKey },
      estimated_min_cost_usd: 0,
      estimated_likely_cost_usd: 0,
      estimated_max_cost_usd: Math.max(0.01, opts.estimatedWh * 0.02),
      max_cost_usd: Math.max(0.01, opts.estimatedWh * 0.02),
      approval_required: false,
      route_stickiness: "task",
      status: "queued",
      assigned_employee_id: opts.assignedEmployeeId,
      estimated_wh: opts.estimatedWh,
      actual_wh: 0,
    });
    if (error) throw error;
    return id;
  }
}

async function markBrainStep(
  service: SupabaseClient,
  brainStepId: string | null,
  status: "completed" | "failed",
  actualWh: number,
): Promise<void> {
  if (!brainStepId) return;
  try {
    await service
      .from("brain_capability_steps")
      .update({
        status,
        actual_wh: actualWh,
        completed_at: new Date().toISOString(),
      })
      .eq("id", brainStepId);
  } catch (err) {
    console.warn("[AdeHQ playbook runtime] brain step status update failed", err);
  }
}

async function loadDefinition(
  client: SupabaseClient,
  playbookVersionId: string,
): Promise<PlaybookDefinitionV1> {
  const { data, error } = await client
    .from("playbook_versions")
    .select("definition")
    .eq("id", playbookVersionId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.definition) throw new Error("Playbook version definition missing");
  return data.definition as PlaybookDefinitionV1;
}

/**
 * Process one wave of a live playbook run: advance deps, lease ready steps,
 * dispatch handlers, persist outputs, and finalize when all steps are terminal.
 */
export async function processPlaybookRunWave(
  client: SupabaseClient,
  opts: ProcessPlaybookRunWaveOpts,
): Promise<ProcessPlaybookRunWaveResult> {
  const now = opts.now ?? new Date();
  const processedStepKeys: string[] = [];
  const artifactsCreated: string[] = [];

  let service: SupabaseClient;
  try {
    service = opts.serviceClient ?? createSupabaseSecretClient();
  } catch (err) {
    return {
      ok: false,
      runId: opts.runId,
      processedStepKeys,
      status: "failed",
      artifactsCreated,
      error: err instanceof Error ? err.message : "Service client unavailable",
    };
  }

  const loaded = await getPlaybookRun(client, opts.runId);
  if (!loaded) {
    return {
      ok: false,
      runId: opts.runId,
      processedStepKeys,
      status: "failed",
      artifactsCreated,
      error: "Run not found",
    };
  }

  let { run, steps } = loaded;

  if (isTerminalPlaybookRunStatus(run.status) || run.cancelled_at) {
    return {
      ok: true,
      runId: run.id,
      processedStepKeys,
      status: run.cancelled_at ? "cancelled" : run.status,
      artifactsCreated,
    };
  }

  // awaiting_approval before start: do not advance until approved → queued.
  if (run.status === "awaiting_approval") {
    return {
      ok: true,
      runId: run.id,
      processedStepKeys,
      status: run.status,
      artifactsCreated,
    };
  }

  if (run.status === "queued" || run.status === "blocked") {
    run = await updatePlaybookRunStatus(client, run.id, "running", {
      started_at: run.started_at ?? now.toISOString(),
    });
  } else if (run.status !== "running" && run.status !== "reviewing" && run.status !== "rendering") {
    // Only process active-ish statuses.
    return {
      ok: true,
      runId: run.id,
      processedStepKeys,
      status: run.status,
      artifactsCreated,
    };
  }

  const definition = await loadDefinition(client, run.playbook_version_id);
  const maxParallel = resolveMaxParallel(definition, opts.maxParallelOverride);

  // Advance pending → ready from DB rows.
  {
    let envelopeSteps = dbStepsToEnvelopeSteps(steps);
    envelopeSteps = advanceReadySteps(envelopeSteps, definition);
    for (const es of envelopeSteps) {
      const row = steps.find((s) => s.step_key === es.stepKey);
      if (row && row.status === "pending" && es.status === "ready") {
        await client
          .from("playbook_run_steps")
          .update({ status: "ready", updated_at: now.toISOString() })
          .eq("id", row.id)
          .eq("status", "pending");
      }
    }
    const refreshed = await getPlaybookRun(client, run.id);
    if (refreshed) {
      run = refreshed.run;
      steps = refreshed.steps;
    }
  }

  // Reclaim expired leases for this owner (or any expired lease).
  for (const step of steps) {
    if (
      (step.status === "leased" || step.status === "running") &&
      canReclaimStepLease(
        {
          status: step.status,
          leaseOwner: step.lease_owner,
          leaseExpiresAt: step.lease_expires_at,
        },
        PLAYBOOK_RUNTIME_LEASE_OWNER,
        now,
      ) &&
      step.lease_expires_at &&
      Date.parse(step.lease_expires_at) <= now.getTime()
    ) {
      await client
        .from("playbook_run_steps")
        .update({
          status: "ready",
          lease_owner: null,
          lease_expires_at: null,
          updated_at: now.toISOString(),
        })
        .eq("id", step.id);
    }
  }

  {
    const refreshed = await getPlaybookRun(client, run.id);
    if (refreshed) {
      run = refreshed.run;
      steps = refreshed.steps;
    }
  }

  const readyKeys = selectReadyStepKeys(
    steps.map((s) => ({ stepKey: s.step_key, status: s.status })),
    maxParallel,
  );

  let actualWh = Number(run.actual_wh ?? 0);
  const hardLimit = Number(run.hard_wh_limit ?? definition.policies.hardWhLimit ?? 50);
  const outputs = stepOutputsMap(steps);

  for (const stepKey of readyKeys) {
    // Respect mid-wave cancel.
    {
      const latest = await getPlaybookRun(client, run.id);
      if (latest?.run.cancelled_at || latest?.run.status === "cancelled") {
        return {
          ok: true,
          runId: run.id,
          processedStepKeys,
          status: "cancelled",
          artifactsCreated,
        };
      }
      if (latest) {
        run = latest.run;
        steps = latest.steps;
        actualWh = Number(run.actual_wh ?? actualWh);
      }
    }

    const row = steps.find((s) => s.step_key === stepKey);
    if (!row) continue;
    if (row.status === "completed" || row.status === "skipped") continue;
    if (row.status !== "ready") {
      // Same-owner active lease: allow resume; otherwise skip.
      if (
        !canReclaimStepLease(
          {
            status: row.status,
            leaseOwner: row.lease_owner,
            leaseExpiresAt: row.lease_expires_at,
          },
          PLAYBOOK_RUNTIME_LEASE_OWNER,
          now,
        )
      ) {
        continue;
      }
    }

    const defStep = getDefinitionStep(definition, stepKey);
    if (!defStep) {
      await client
        .from("playbook_run_steps")
        .update({
          status: "failed",
          error_code: "step_definition_missing",
          safe_error_message: "Step definition not found",
          completed_at: now.toISOString(),
        })
        .eq("id", row.id);
      processedStepKeys.push(stepKey);
      await updatePlaybookRunStatus(client, run.id, "failed", {
        error_code: "step_definition_missing",
        safe_error_message: `Missing definition for step ${stepKey}`,
        completed_at: now.toISOString(),
      });
      return {
        ok: false,
        runId: run.id,
        processedStepKeys,
        status: "failed",
        artifactsCreated,
        error: `Missing definition for step ${stepKey}`,
      };
    }

    const estimated = Number(row.estimated_wh ?? defStep.estimatedWh ?? 0);
    const cap = enforceHardWhCap(actualWh, estimated, hardLimit);
    if (!cap.allowed) {
      await client
        .from("playbook_run_steps")
        .update({
          status: "failed",
          error_code: "hard_wh_cap",
          safe_error_message: "Hard Work Hours limit reached",
          completed_at: now.toISOString(),
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq("id", row.id);
      processedStepKeys.push(stepKey);
      await updatePlaybookRunStatus(client, run.id, "failed", {
        error_code: "hard_wh_cap",
        safe_error_message: "Hard Work Hours limit reached",
        actual_wh: actualWh,
        completed_at: now.toISOString(),
      });
      return {
        ok: false,
        runId: run.id,
        processedStepKeys,
        status: "failed",
        artifactsCreated,
        error: "Hard Work Hours limit reached",
      };
    }

    const leaseExpires = new Date(now.getTime() + PLAYBOOK_RUNTIME_LEASE_MS).toISOString();
    const attemptCount = Number(row.attempt_count ?? 0) + 1;

    // Lease → running
    await client
      .from("playbook_run_steps")
      .update({
        status: "leased",
        lease_owner: PLAYBOOK_RUNTIME_LEASE_OWNER,
        lease_expires_at: leaseExpires,
        attempt_count: attemptCount,
        started_at: row.started_at ?? now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    await client
      .from("playbook_run_steps")
      .update({
        status: "running",
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    let brainRunId: string;
    try {
      brainRunId = await ensureBrainRunId(service, { ...run, brain_run_id: run.brain_run_id });
      if (!run.brain_run_id) run = { ...run, brain_run_id: brainRunId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "createBrainRun failed";
      await client
        .from("playbook_run_steps")
        .update({
          status: "failed",
          error_code: "brain_run_failed",
          safe_error_message: msg,
          completed_at: now.toISOString(),
        })
        .eq("id", row.id);
      await updatePlaybookRunStatus(client, run.id, "failed", {
        error_code: "brain_run_failed",
        safe_error_message: msg,
        completed_at: now.toISOString(),
      });
      return {
        ok: false,
        runId: run.id,
        processedStepKeys: [...processedStepKeys, stepKey],
        status: "failed",
        artifactsCreated,
        error: msg,
      };
    }

    let brainStepId: string | null = row.brain_step_id;
    try {
      brainStepId = await ensureBrainCapabilityStep(service, {
        brainRunId,
        workspaceId: run.workspace_id,
        stepKey,
        capability: defStep.capability,
        assignedEmployeeId: row.assigned_employee_id,
        estimatedWh: estimated,
        existingBrainStepId: row.brain_step_id,
      });
      if (brainStepId !== row.brain_step_id) {
        await client
          .from("playbook_run_steps")
          .update({ brain_step_id: brainStepId })
          .eq("id", row.id);
      }
      await service
        .from("brain_capability_steps")
        .update({ status: "running" })
        .eq("id", brainStepId);
    } catch (err) {
      console.warn("[AdeHQ playbook runtime] brain capability step link failed", err);
    }

    const stepInputs = resolveStepInputs(defStep.inputBindings, {
      runInput: (run.input_payload ?? {}) as Record<string, unknown>,
      stepOutputs: outputs,
    });

    await client
      .from("playbook_run_steps")
      .update({ input_snapshot: stepInputs })
      .eq("id", row.id);

    const ctx: StepExecutorContext = {
      step: defStep,
      runInput: (run.input_payload ?? {}) as Record<string, unknown>,
      stepInputs,
      stepOutputs: outputs,
      roleEmployeeId: row.assigned_employee_id,
      brainRunId,
      brainCapabilityStepId: brainStepId,
    };

    let outputArtifactId: string | null = null;
    let stepActualWh = cap.nextMax;

    const result = await dispatchStepKind(defStep.kind, ctx, {
      procedure: async (c) => {
        const key = c.step.procedureKey;
        if (!key) {
          return {
            ok: false,
            kind: "procedure",
            output: {},
            errorCode: "procedure_key_missing",
            safeErrorMessage: "Procedure key missing on step",
          };
        }
        const executed = await executeProcedure(key, {
          ...c.runInput,
          ...c.stepInputs,
          ...c.stepOutputs,
        }, {
          backpack: {
            workspaceId: run.workspace_id,
            brainRunId: c.brainRunId ?? undefined,
            playbookRunStepId: row.id,
          },
        });
        return {
          ok: executed.ok,
          kind: "procedure",
          output: {
            structured: true,
            procedureKey: key,
            ...(executed.output ?? {}),
          },
          errorCode: executed.errorCode,
          safeErrorMessage: executed.safeErrorMessage,
        };
      },
      artifact_compose: async (c) => {
        const composed = await composePlaybookArtifact(service, {
          workspaceId: run.workspace_id,
          playbookRunId: run.id,
          brainRunId: c.brainRunId,
          roomId: run.room_id,
          topicId: run.topic_id,
          employeeId: c.roleEmployeeId,
          step: c.step,
          runInput: c.runInput,
          stepInputs: c.stepInputs,
          stepOutputs: c.stepOutputs,
        });
        outputArtifactId = composed.artifactId;
        artifactsCreated.push(composed.artifactId);
        return {
          ok: true,
          kind: "artifact_compose",
          output: {
            structured: true,
            artifactId: composed.artifactId,
            versionId: composed.versionId,
            kind: composed.kind,
            title: composed.title,
            content: composed.canonical,
            contentMarkdown: composed.contentMarkdown,
          },
        };
      },
      review: async (c) => {
        // Prefer artifact from prior compose step outputs.
        let canonical: unknown = null;
        let artifactId: string | null = null;
        for (const prior of steps) {
          if (prior.output_artifact_id && prior.status === "completed") {
            artifactId = prior.output_artifact_id;
          }
          const content = (prior.output_payload as { content?: unknown } | null)?.content;
          if (content && typeof content === "object") canonical = content;
        }
        for (const value of Object.values(c.stepOutputs)) {
          if (value && typeof value === "object" && "content" in (value as object)) {
            canonical = (value as { content: unknown }).content;
          }
          if (value && typeof value === "object" && "artifactId" in (value as object)) {
            artifactId = String((value as { artifactId: string }).artifactId);
          }
        }

        if (artifactId && !canonical) {
          const { data: ver } = await service
            .from("artifact_versions")
            .select("canonical_content, content_json")
            .eq("artifact_id", artifactId)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          canonical = ver?.canonical_content ?? ver?.content_json ?? null;
        }

        if (!canonical || typeof canonical !== "object") {
          return {
            ok: true,
            kind: "review",
            output: {
              structured: true,
              passed: true,
              warnings: ["No artifact present for review — passed with warnings"],
            },
          };
        }

        const schemaKey = String((canonical as { schemaKey?: string }).schemaKey ?? "");
        let validation = { ok: true, errors: [] as string[] };
        if (schemaKey === "adehq.document.v1") validation = validateDocument(canonical);
        else if (schemaKey === "adehq.presentation.v1") validation = validatePresentation(canonical);
        else if (schemaKey === "adehq.workbook.v1") validation = validateWorkbook(canonical);
        else {
          return {
            ok: true,
            kind: "review",
            output: {
              structured: true,
              passed: true,
              warnings: [`Unknown schemaKey ${schemaKey || "(missing)"} — passed with warnings`],
              artifactId,
            },
          };
        }

        return {
          ok: validation.ok,
          kind: "review",
          output: {
            structured: true,
            passed: validation.ok,
            errors: validation.errors,
            artifactId,
            content: canonical,
          },
          errorCode: validation.ok ? undefined : "quality_gate_failed",
          safeErrorMessage: validation.ok
            ? undefined
            : validation.errors.slice(0, 3).join("; ") || "Quality gate failed",
        };
      },
    });

    const patch = applyStepResult(
      {
        stepKey,
        status: "running",
        roleKey: defStep.roleKey,
        employeeId: row.assigned_employee_id,
        dependsOn: row.depends_on ?? [],
        estimatedWh: estimated,
        actualWh: 0,
        brainCapabilityStepId: brainStepId,
        brainRunId,
      },
      {
        ok: result.ok,
        output: result.output,
        errorCode: result.errorCode,
        safeErrorMessage: result.safeErrorMessage,
        actualWh: result.ok ? stepActualWh : 0,
      },
    );

    if (outputArtifactId) patch.outputArtifactId = outputArtifactId;

    await client
      .from("playbook_run_steps")
      .update({
        status: patch.status,
        output_payload: patch.outputPayload ?? {},
        output_artifact_id: patch.outputArtifactId ?? outputArtifactId,
        actual_wh: patch.actualWh ?? 0,
        error_code: patch.errorCode ?? null,
        safe_error_message: patch.safeErrorMessage ?? null,
        completed_at: patch.completedAt ?? now.toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    await markBrainStep(
      service,
      brainStepId,
      result.ok ? "completed" : "failed",
      Number(patch.actualWh ?? 0),
    );

    if (result.ok) {
      actualWh += Number(patch.actualWh ?? 0);
      await client
        .from("playbook_runs")
        .update({ actual_wh: actualWh, updated_at: now.toISOString() })
        .eq("id", run.id);
      outputs[stepKey] = patch.outputPayload ?? {};
    } else {
      // Non-optional failure fails the run (V1: all steps required).
      processedStepKeys.push(stepKey);
      await updatePlaybookRunStatus(client, run.id, "failed", {
        error_code: patch.errorCode ?? "step_failed",
        safe_error_message: patch.safeErrorMessage ?? "Step failed",
        actual_wh: actualWh,
        completed_at: now.toISOString(),
      });
      return {
        ok: false,
        runId: run.id,
        processedStepKeys,
        status: "failed",
        artifactsCreated,
        error: patch.safeErrorMessage ?? "Step failed",
      };
    }

    processedStepKeys.push(stepKey);
  }

  // Post-wave: advance again + maybe complete.
  {
    const refreshed = await getPlaybookRun(client, run.id);
    if (!refreshed) {
      return {
        ok: true,
        runId: opts.runId,
        processedStepKeys,
        status: "running",
        artifactsCreated,
      };
    }
    run = refreshed.run;
    steps = refreshed.steps;

    if (run.cancelled_at || run.status === "cancelled") {
      return {
        ok: true,
        runId: run.id,
        processedStepKeys,
        status: "cancelled",
        artifactsCreated,
      };
    }

    let envelopeSteps = dbStepsToEnvelopeSteps(steps);
    envelopeSteps = advanceReadySteps(envelopeSteps, definition);
    for (const es of envelopeSteps) {
      const row = steps.find((s) => s.step_key === es.stepKey);
      if (row && row.status === "pending" && es.status === "ready") {
        await client
          .from("playbook_run_steps")
          .update({ status: "ready", updated_at: now.toISOString() })
          .eq("id", row.id)
          .eq("status", "pending");
      }
    }

    const after = await getPlaybookRun(client, run.id);
    if (after) {
      run = after.run;
      steps = after.steps;
    }

    if (steps.every((s) => isTerminalPlaybookStepStatus(s.status))) {
      const terminal = summarizeRunTerminalStatus(
        steps.map((s) => ({ status: s.status })),
        run.cancelled_at,
      );
      run = await updatePlaybookRunStatus(client, run.id, terminal, {
        actual_wh: Number(run.actual_wh ?? actualWh),
        completed_at: now.toISOString(),
        output_summary: {
          processedStepKeys,
          artifactsCreated,
        },
      });
      return {
        ok: terminal !== "failed",
        runId: run.id,
        processedStepKeys,
        status: terminal,
        artifactsCreated,
      };
    }
  }

  return {
    ok: true,
    runId: run.id,
    processedStepKeys,
    status: run.status,
    artifactsCreated,
  };
}

/** Worker mode: inline (default) processes in-request; queue relies on worker endpoint. */
export function getPlaybookWorkerMode(): "inline" | "queue" {
  const raw = process.env.ADEHQ_PLAYBOOK_WORKER_MODE?.trim().toLowerCase();
  if (raw === "queue") return "queue";
  return "inline";
}
