import type { SupabaseClient } from "@supabase/supabase-js";
import { insertDecisionAttempt } from "@/lib/brain/decisions/persist";
import {
  beginUnifiedBrainRun,
  enqueueBrainStep,
  finishBrainRun,
} from "@/lib/brain/reliability/lifecycle";
import { revalidatePermissionEnvelope } from "@/lib/brain/reliability/permission-envelope";
import type { AIEmployee } from "@/lib/types";
import type { ResponderDecision } from "@/lib/server/conversation-orchestrator";
import { buildCollaborationPlan, type BuildCollaborationPlanInput } from "./build-plan";
import { validateCollaborationPlan } from "./validate-plan";
import { claimStepLease, releaseLease } from "./leases";
import {
  formatFindingsBoard,
  listFindingsForRun,
  publishSharedFinding,
} from "./findings";
import { buildInitialProgress, updateStepProgress } from "./progress";
import { buildCollaborationReceipt, formatStewardFailureMessage } from "./receipts";
import type { CollaborationPlan, CollaborationPlanStep } from "./types";
import type {
  StewardExecutionStartResult,
  StewardProgressSnapshot,
} from "./types-execution";

function mapCapabilityForDb(
  capability: CollaborationPlanStep["capability"],
): string {
  if (capability === "review") return "synthesis";
  return capability;
}

function readySteps(
  plan: CollaborationPlan,
  completedStepIds: Set<string>,
  failedOrCancelled: Set<string>,
): CollaborationPlanStep[] {
  return plan.steps.filter((step) => {
    if (completedStepIds.has(step.stepId)) return false;
    if (failedOrCancelled.has(step.stepId)) return false;
    return step.dependsOn.every((d) => completedStepIds.has(d));
  });
}

async function loadProgress(
  client: SupabaseClient,
  brainRunId: string,
): Promise<StewardProgressSnapshot | null> {
  const { data } = await client
    .from("brain_runs")
    .select("steward_progress")
    .eq("id", brainRunId)
    .maybeSingle();
  if (!data?.steward_progress || typeof data.steward_progress !== "object") return null;
  return data.steward_progress as StewardProgressSnapshot;
}

async function saveProgress(
  client: SupabaseClient,
  brainRunId: string,
  progress: StewardProgressSnapshot,
): Promise<void> {
  await client
    .from("brain_runs")
    .update({ steward_progress: progress })
    .eq("id", brainRunId);
}

/**
 * Start Steward execution: brain run + steps + leases for the first ready wave.
 * Does not call the model — returns responders for queueAgentRuns.
 */
export async function startStewardExecution(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    initiatedByUserId: string;
    roomId: string;
    topicId: string;
    triggerMessageId: string;
    employees: AIEmployee[];
    planInput: BuildCollaborationPlanInput;
    /** When true, do not queue until approved (still persists plan). */
    requireApproval?: boolean;
  },
): Promise<StewardExecutionStartResult | null> {
  const { plan, trigger, policy } = buildCollaborationPlan(input.planInput);
  if (!plan) return null;

  const validation = validateCollaborationPlan(plan, {
    accessibleEmployeeIds: input.planInput.accessibleEmployeeIds,
    roomEmployeeIds: input.planInput.roomEmployeeIds,
    isPrivateDm: input.planInput.isPrivateDm,
    policy,
  });
  if (!validation.ok) {
    console.warn("[AdeHQ steward] plan invalid", validation.errors);
    return null;
  }

  // Single-employee plans fall through to legacy path
  if (!trigger.collaborate || plan.mode === "single_employee" || plan.steps.length <= 1) {
    return null;
  }

  const nameById = new Map(input.employees.map((e) => [e.id, e.name]));
  const approvalRequired = Boolean(input.requireApproval ?? plan.approvalRequired);

  const { brainRunId, permissionEnvelope } = await beginUnifiedBrainRun(client, {
    workspaceId: input.workspaceId,
    initiatedByUserId: input.initiatedByUserId,
    leadEmployeeId: plan.leadEmployeeId,
    roomId: input.roomId,
    topicId: input.topicId,
    triggerMessageId: input.triggerMessageId,
    intensity: "standard",
    budget: {
      estimatedWhMin: plan.estimatedWhMin,
      estimatedWhMax: plan.estimatedWhMax,
      hardWhLimit: plan.hardWhLimit,
      approvedWhLimit: plan.hardWhLimit,
      actualWh: 0,
    },
  });

  await client
    .from("brain_runs")
    .update({
      steward_plan: plan,
      lifecycle_status: approvalRequired ? "waiting_for_approval" : "running",
      status: approvalRequired ? "waiting_for_approval" : "running",
    })
    .eq("id", brainRunId);

  const attemptId = await insertDecisionAttempt(client, {
    brainRunId,
    attemptNumber: 1,
    reason: "steward_collaboration_v1",
    capability: "synthesis",
    intensity: "standard",
    routeId: "steward_collaboration_v1",
    scoreFactors: { steward: 1, estimatedWhMax: plan.estimatedWhMax },
  });

  const stepIdMap: Record<string, string> = {};
  for (const step of plan.steps) {
    const enqueued = await enqueueBrainStep(client, {
      brainRunId,
      decisionAttemptId: attemptId,
      capability: mapCapabilityForDb(step.capability),
      routeId: `steward_${step.capability}`,
      assignedEmployeeId: step.employeeId,
      logicalStepKey: step.stepId,
      workspaceId: input.workspaceId,
      estimatedWh: step.estimatedWh,
      outputContract: {
        kind: "steward_step",
        stepId: step.stepId,
        expectedOutput: step.expectedOutput,
      },
      maxCostUsd: step.estimatedWh * 0.01 * 1.5,
    });
    stepIdMap[step.stepId] = enqueued.stepId;
  }

  await client
    .from("brain_runs")
    .update({
      steward_plan: { ...plan, stepIdMap },
      metadata: { reliability: "pr17_5", steward: "v1", stepIdMap },
    })
    .eq("id", brainRunId);

  let progress = buildInitialProgress(brainRunId, plan, nameById);
  if (approvalRequired) {
    progress = { ...progress, status: "waiting_for_approval" };
    await saveProgress(client, brainRunId, progress);
    return {
      brainRunId,
      plan,
      progress,
      queuedStepIds: [],
      readySteps: [],
      blockedReason: "approval_required",
    };
  }

  // Cost cap: never start if estimate exceeds hard limit
  if (plan.estimatedWhMin > plan.hardWhLimit) {
    progress = {
      ...progress,
      status: "failed",
      failureMessage: "Estimated cost exceeds the approved Work Hours limit.",
    };
    await saveProgress(client, brainRunId, progress);
    await finishBrainRun(client, brainRunId, "failed", 0);
    return {
      brainRunId,
      plan,
      progress,
      queuedStepIds: [],
      readySteps: [],
      blockedReason: "budget_exceeded",
    };
  }

  void permissionEnvelope;
  const wave = readySteps(plan, new Set(), new Set());
  await saveProgress(client, brainRunId, progress);

  return {
    brainRunId,
    plan: { ...plan, stepIdMap } as CollaborationPlan & { stepIdMap: Record<string, string> },
    progress,
    queuedStepIds: wave.map((s) => s.stepId),
    readySteps: wave,
  };
}

function resolveDbStepId(
  plan: CollaborationPlan & { stepIdMap?: Record<string, string> },
  logicalStepId: string,
): string {
  return plan.stepIdMap?.[logicalStepId] ?? logicalStepId;
}

/**
 * Convert ready Steward steps into queueAgentRuns responders.
 */
export function buildStewardResponders(input: {
  plan: CollaborationPlan;
  readySteps: CollaborationPlanStep[];
  employees: AIEmployee[];
  brainRunId: string;
  collaborationId: string;
  rootTriggerMessageId: string;
  findingsBoard?: string;
}): ResponderDecision[] {
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  const leadName =
    byId.get(input.plan.leadEmployeeId)?.name ?? "lead";

  return input.readySteps.flatMap((step) => {
    const employee = byId.get(step.employeeId);
    if (!employee) return [];
    const isTerminal =
      step.capability === "synthesis" ||
      step.capability === "image" ||
      step.capability === "video";
    const isInternal = !isTerminal;
    const artifactIntent =
      input.plan.artifactIntent?.type === step.capability
        ? input.plan.artifactIntent
        : undefined;

    const objectivePrompt = [
      `You are contributing to a coordinated workforce task led by ${leadName}.`,
      `Your step objective: ${step.objective}`,
      `Expected output: ${step.expectedOutput}`,
      isInternal
        ? "Produce a concise structured finding for the lead. Do not give a final user-facing answer — the lead will synthesize."
        : artifactIntent
          ? `Complete exactly one ${artifactIntent.type} artifact for the user using the shared findings. Do not only describe or promise the artifact—use the available artifact tool.`
          : "Synthesize one coherent final answer for the user using the shared findings. Include concise collaborator attribution.",
      input.findingsBoard ? `\n${input.findingsBoard}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return [
      {
        employee,
        reason: isTerminal ? ("collaboration_lead" as const) : ("collaboration_collaborator" as const),
        runMetadata: {
          collaborationId: input.collaborationId,
          conversationMode: "lead_collaborator",
          collaborationRole: isTerminal ? "lead" : "collaborator",
          collaborationStatus: "active",
          rootTriggerMessageId: input.rootTriggerMessageId,
          stewardBrainRunId: input.brainRunId,
          stewardStepId: step.stepId,
          stewardCapability: step.capability,
          stewardInternalStep: isInternal,
          stewardObjectivePrompt: objectivePrompt,
          artifactIntent,
          leadEmployeeId: input.plan.leadEmployeeId,
          leadEmployeeName: leadName,
          participants: input.plan.steps.map((s) => ({
            employeeId: s.employeeId,
            employeeName: byId.get(s.employeeId)?.name ?? s.employeeId,
            role: s.employeeId === input.plan.leadEmployeeId ? "lead" : "collaborator",
          })),
        },
      },
    ];
  });
}

/**
 * After a steward step agent run finishes: publish finding, update progress, queue next wave.
 */
export async function advanceStewardAfterStep(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    stepId: string;
    employeeId: string;
    employeeName: string;
    reply: string;
    failed?: boolean;
    actualWh?: number;
    leaseId?: string | null;
    employees: AIEmployee[];
    roomId: string;
    topicId: string;
    rootTriggerMessageId: string;
  },
): Promise<{
  nextResponders: ResponderDecision[];
  progress: StewardProgressSnapshot;
  receipt: ReturnType<typeof buildCollaborationReceipt> | null;
  finished: boolean;
}> {
  const { data: runRow } = await client
    .from("brain_runs")
    .select("steward_plan, steward_progress, permission_envelope, hard_wh_limit, actual_wh")
    .eq("id", input.brainRunId)
    .maybeSingle();

  const plan = runRow?.steward_plan as
    | (CollaborationPlan & { stepIdMap?: Record<string, string> })
    | null;
  if (!plan) {
    return {
      nextResponders: [],
      progress: {
        brainRunId: input.brainRunId,
        leadEmployeeId: input.employeeId,
        mode: "single_employee",
        status: "failed",
        steps: [],
        collaboratorNames: [],
        estimatedWhMin: 0,
        estimatedWhMax: 0,
        actualWh: 0,
        approvalRequired: false,
      },
      receipt: null,
      finished: true,
    };
  }

  // Revalidate access before sensitive follow-on work
  const envelope = runRow?.permission_envelope as
    | import("@/lib/brain/reliability/types").PermissionEnvelope
    | null;
  if (envelope) {
    const reval = await revalidatePermissionEnvelope(client, envelope);
    if (!reval.ok) {
      await finishBrainRun(client, input.brainRunId, "cancelled", Number(runRow?.actual_wh ?? 0));
      let progress = (runRow?.steward_progress as StewardProgressSnapshot) ??
        buildInitialProgress(input.brainRunId, plan, new Map());
      progress = {
        ...progress,
        status: "cancelled",
        failureMessage: "Access changed during collaboration; work was stopped.",
      };
      await saveProgress(client, input.brainRunId, progress);
      return { nextResponders: [], progress, receipt: null, finished: true };
    }
  }

  if (input.leaseId) {
    try {
      await releaseLease(client, input.leaseId);
    } catch {
      /* ignore */
    }
  }

  const nameById = new Map(input.employees.map((e) => [e.id, e.name]));
  let progress =
    (runRow?.steward_progress as StewardProgressSnapshot) ??
    buildInitialProgress(input.brainRunId, plan, nameById);

  const stepMeta = plan.steps.find((s) => s.stepId === input.stepId);
  const isTerminal =
    stepMeta?.capability === "synthesis" ||
    stepMeta?.capability === "image" ||
    stepMeta?.capability === "video";

  if (input.failed) {
  await client
    .from("brain_capability_steps")
    .update({
      status: "failed",
      failure_class: "transient_provider",
      actual_wh: 0,
      completed_at: new Date().toISOString(),
    })
    .eq("id", resolveDbStepId(plan, input.stepId));

    progress = updateStepProgress(progress, input.stepId, "failed", 0);
    progress = {
      ...progress,
      failureMessage: formatStewardFailureMessage(
        input.employeeName,
        nameById.get(plan.leadEmployeeId),
      ),
    };
    await saveProgress(client, input.brainRunId, progress);

    // Continue with remaining ready steps that don't depend on the failed one
    const completed = new Set(
      progress.steps.filter((s) => s.status === "completed").map((s) => s.stepId),
    );
    const failed = new Set(
      progress.steps.filter((s) => s.status === "failed" || s.status === "cancelled").map((s) => s.stepId),
    );
    // Mark dependents of failed step as skipped
    for (const s of plan.steps) {
      if (s.dependsOn.some((d) => failed.has(d)) && !completed.has(s.stepId)) {
        progress = updateStepProgress(progress, s.stepId, "skipped", 0);
        failed.add(s.stepId);
      }
    }
    await saveProgress(client, input.brainRunId, progress);

    const wave = readySteps(plan, completed, failed).filter(
      (s) =>
        s.capability === "synthesis" ||
        s.capability === "image" ||
        s.capability === "video",
    );
    if (!wave.length) {
      // Try the terminal delivery step with whatever findings exist.
      const terminal = plan.steps.find(
        (s) =>
          s.capability === "synthesis" ||
          s.capability === "image" ||
          s.capability === "video",
      );
      if (terminal && !completed.has(terminal.stepId) && !failed.has(terminal.stepId)) {
        wave.push(terminal);
      }
    }

    if (!wave.length) {
      await finishBrainRun(client, input.brainRunId, "failed", progress.actualWh);
      return { nextResponders: [], progress, receipt: null, finished: true };
    }

    const findings = await listFindingsForRun(client, input.workspaceId, input.brainRunId);
    const nextResponders = buildStewardResponders({
      plan,
      readySteps: wave,
      employees: input.employees,
      brainRunId: input.brainRunId,
      collaborationId: `collab_${input.rootTriggerMessageId}`,
      rootTriggerMessageId: input.rootTriggerMessageId,
      findingsBoard: formatFindingsBoard(findings) +
        `\n\nNote: ${progress.failureMessage}`,
    });
    for (const step of wave) {
      progress = updateStepProgress(progress, step.stepId, "leased");
      await claimStepLease(client, {
        workspaceId: input.workspaceId,
        brainRunId: input.brainRunId,
        brainStepId: resolveDbStepId(plan, step.stepId),
        employeeId: step.employeeId,
      });
    }
    await saveProgress(client, input.brainRunId, progress);
    return { nextResponders, progress, receipt: null, finished: false };
  }

  // Success path
  const actualWh = input.actualWh ?? stepMeta?.estimatedWh ?? 0;
  const hardLimit = Number(runRow?.hard_wh_limit ?? plan.hardWhLimit);
  const nextActual = progress.actualWh + actualWh;
  if (nextActual > hardLimit) {
    progress = {
      ...updateStepProgress(progress, input.stepId, "cancelled", 0),
      status: "waiting_for_approval",
      failureMessage: "Approved Work Hours limit reached. Approve more to continue.",
    };
    await saveProgress(client, input.brainRunId, progress);
    await client
      .from("brain_runs")
      .update({ lifecycle_status: "waiting_for_approval", status: "waiting_for_approval" })
      .eq("id", input.brainRunId);
    return { nextResponders: [], progress, receipt: null, finished: false };
  }

  if (!isTerminal) {
    await publishSharedFinding(client, {
      workspaceId: input.workspaceId,
      brainRunId: input.brainRunId,
      brainStepId: input.stepId,
      producedByEmployeeId: input.employeeId,
      title: stepMeta?.objective?.slice(0, 120) ?? "Finding",
      summary: input.reply,
      confidence: 0.75,
      visibility: "lead_only",
      containsPrivateDmContext: false,
    });
  }

  await client
    .from("brain_capability_steps")
    .update({
      status: "completed",
      actual_wh: actualWh,
      completed_at: new Date().toISOString(),
    })
    .eq("id", resolveDbStepId(plan, input.stepId));

  progress = updateStepProgress(progress, input.stepId, "completed", actualWh);
  await client
    .from("brain_runs")
    .update({ actual_wh: progress.actualWh })
    .eq("id", input.brainRunId);
  await saveProgress(client, input.brainRunId, progress);

  if (isTerminal) {
    await finishBrainRun(client, input.brainRunId, "completed", progress.actualWh);
    const receipt = buildCollaborationReceipt(plan, progress, nameById);
    progress = { ...progress, status: "completed" };
    await saveProgress(client, input.brainRunId, progress);
    return { nextResponders: [], progress, receipt, finished: true };
  }

  const completed = new Set(
    progress.steps.filter((s) => s.status === "completed").map((s) => s.stepId),
  );
  const blocked = new Set(
    progress.steps
      .filter((s) => s.status === "failed" || s.status === "cancelled" || s.status === "skipped")
      .map((s) => s.stepId),
  );
  const wave = readySteps(plan, completed, blocked);
  if (!wave.length) {
    await finishBrainRun(client, input.brainRunId, "completed", progress.actualWh);
    const receipt = buildCollaborationReceipt(plan, progress, nameById);
    progress = { ...progress, status: "completed" };
    await saveProgress(client, input.brainRunId, progress);
    return { nextResponders: [], progress, receipt, finished: true };
  }

  const findings = await listFindingsForRun(client, input.workspaceId, input.brainRunId);
  const nextResponders = buildStewardResponders({
    plan,
    readySteps: wave,
    employees: input.employees,
    brainRunId: input.brainRunId,
    collaborationId: `collab_${input.rootTriggerMessageId}`,
    rootTriggerMessageId: input.rootTriggerMessageId,
    findingsBoard: formatFindingsBoard(findings),
  });

  for (const step of wave) {
    progress = updateStepProgress(progress, step.stepId, "leased");
    await claimStepLease(client, {
      workspaceId: input.workspaceId,
      brainRunId: input.brainRunId,
      brainStepId: resolveDbStepId(plan, step.stepId),
      employeeId: step.employeeId,
    });
  }
  await saveProgress(client, input.brainRunId, progress);

  return { nextResponders, progress, receipt: null, finished: false };
}

/**
 * Claim leases for the first wave before queueing.
 */
export async function leaseReadySteps(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    plan: CollaborationPlan & { stepIdMap?: Record<string, string> };
    steps: CollaborationPlanStep[];
  },
): Promise<void> {
  for (const step of input.steps) {
    await claimStepLease(client, {
      workspaceId: input.workspaceId,
      brainRunId: input.brainRunId,
      brainStepId: resolveDbStepId(input.plan, step.stepId),
      employeeId: step.employeeId,
    });
  }
}
