// ===========================================================================
// Autonomy engine — runs one iteration of the plan → act → observe → report
// loop, and an inline driver that runs iterations until the session pauses,
// finishes, or hits a guardrail. Rides the Tool Execution Core for actions.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { runToolCall } from "@/lib/integrations/executor/tool-executor";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import { ensureDefaultEmployeeToolGrants } from "@/lib/integrations/permissions";
import { listGrantedToolUsage } from "@/lib/integrations/prompt";
import type { IntegrationEmployee } from "@/lib/integrations/types";
import { nowISO, uid } from "@/lib/utils";
import {
  appendStep,
  claimForIteration,
  getSession,
  listSteps,
  updateSession,
} from "./session-store";
import type { ToolCallResult } from "@/lib/integrations/types";
import type {
  AutonomousSession,
  AutonomyBrain,
  AutonomyBrainContext,
  AutonomyObservation,
  IterationOutcome,
} from "./types";

/** Injectable tool runner — defaults to the real Tool Execution Core. */
export type ToolRunner = typeof runToolCall;

export type EngineDeps = {
  runTool?: ToolRunner;
};

/** Rough per-iteration model cost used only for budget guardrails (not billing). */
const ESTIMATED_MODEL_COST_PER_ITERATION = 0.01;
const MAX_TOOL_CALLS_PER_ITERATION = 4;

type EmployeeInfo = { employee: IntegrationEmployee; role: string };

async function loadEmployee(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<EmployeeInfo | null> {
  const base = await loadIntegrationEmployee(client, workspaceId, employeeId);
  if (!base) return null;
  const employee = await ensureDefaultEmployeeToolGrants(client, workspaceId, base);
  const { data } = await client
    .from("ai_employees")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  return { employee, role: data?.role ? String(data.role) : "AI employee" };
}

/** Rebuild prior thoughts + observations from the step timeline, by iteration. */
async function buildHistory(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomyBrainContext["history"]> {
  const steps = await listSteps(client, sessionId);
  const byIter = new Map<number, { thought: string; observations: AutonomyObservation[] }>();
  for (const step of steps) {
    const iter = Number(step.metadata.iteration ?? 0);
    if (!byIter.has(iter)) byIter.set(iter, { thought: "", observations: [] });
    const entry = byIter.get(iter)!;
    if (step.kind === "thought") entry.thought = step.title;
    if (step.kind === "observation") {
      entry.observations.push({
        tool: step.toolName ?? "tool",
        status: String(step.metadata.status ?? step.status),
        summary: step.detail ?? step.title,
      });
    }
  }
  return [...byIter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

async function finalize(
  client: SupabaseClient,
  session: AutonomousSession,
  status: "completed" | "failed" | "stopped",
  report: string,
  seq: number,
): Promise<IterationOutcome> {
  await appendStep(client, {
    workspaceId: session.workspaceId,
    sessionId: session.id,
    seq,
    kind: status === "failed" ? "error" : "report",
    title: status === "completed" ? "Objective complete" : status === "stopped" ? "Stopped" : "Blocked",
    detail: report,
    metadata: { iteration: session.stepsUsed },
  });
  await updateSession(client, session.id, {
    status,
    resultSummary: report,
    completedAt: nowISO(),
  });
  await maybeCompleteTask(client, session, status);
  await postReportToRoom(client, session, report, status);
  return { status, shouldContinue: false };
}

async function maybeCompleteTask(
  client: SupabaseClient,
  session: AutonomousSession,
  status: "completed" | "failed" | "stopped",
): Promise<void> {
  if (!session.taskId || status !== "completed") return;
  await client
    .from("tasks")
    .update({ status: "done", updated_at: nowISO() })
    .eq("workspace_id", session.workspaceId)
    .eq("id", session.taskId)
    .then(({ error }) => {
      if (error) console.warn("[AdeHQ autonomy] task complete failed", error);
    });
}

async function postReportToRoom(
  client: SupabaseClient,
  session: AutonomousSession,
  report: string,
  status: "completed" | "failed" | "stopped",
): Promise<void> {
  if (!session.roomId || !session.topicId) return;
  const { data: emp } = await client
    .from("ai_employees")
    .select("name")
    .eq("workspace_id", session.workspaceId)
    .eq("id", session.employeeId)
    .maybeSingle();
  const prefix =
    status === "completed" ? "✅ Autopilot complete" : status === "stopped" ? "⏹ Autopilot stopped" : "⚠️ Autopilot blocked";
  const content = `**${prefix}**\n\n${report}`;
  await client
    .from("messages")
    .insert({
      workspace_id: session.workspaceId,
      id: uid("msg"),
      room_id: session.roomId,
      topic_id: session.topicId,
      sender_type: "ai",
      sender_id: session.employeeId,
      sender_name: emp?.name ? String(emp.name) : "AI employee",
      content,
      pending: false,
      created_at: nowISO(),
      artifacts: [{ type: "autonomous_session", id: session.id, label: "Autopilot session" }],
    })
    .then(({ error }) => {
      if (error) console.warn("[AdeHQ autonomy] report post failed", error);
    });
}

/**
 * Run a single iteration. Assumes the session was already claimed (status
 * "running"). Returns whether the caller should schedule another iteration.
 */
export async function runSessionIteration(
  client: SupabaseClient,
  sessionId: string,
  brain: AutonomyBrain,
  deps: EngineDeps = {},
): Promise<IterationOutcome> {
  const runTool: ToolRunner = deps.runTool ?? runToolCall;
  const session = await getSession(client, sessionId);
  if (!session) return { status: "failed", shouldContinue: false };
  if (session.status !== "running") {
    return { status: session.status, shouldContinue: false };
  }

  const iteration = session.stepsUsed;
  let seq = (await listSteps(client, sessionId)).length;

  // Guardrail: stop requested.
  if (session.stopRequested) {
    return finalize(client, session, "stopped", "Stopped by a teammate before finishing.", seq);
  }

  // Guardrail: budgets exhausted.
  if (session.stepsUsed >= session.stepBudget) {
    return finalize(
      client,
      session,
      "completed",
      `Reached the step budget (${session.stepBudget} steps). Pausing — ask me to continue if more is needed.`,
      seq,
    );
  }
  if (session.costUsedUsd >= session.costBudgetUsd) {
    return finalize(client, session, "completed", "Reached the cost budget for this run.", seq);
  }

  const info = await loadEmployee(client, session.workspaceId, session.employeeId);
  if (!info) {
    return finalize(client, session, "failed", "The assigned employee no longer exists.", seq);
  }

  const toolCatalog = listGrantedToolUsage(info.employee) || "(no tools available)";
  const history = await buildHistory(client, sessionId);

  // Read + clear any one-shot approval outcome the resume step recorded.
  const lastApprovalOutcome = await popApprovalOutcome(client, session);

  const ctx: AutonomyBrainContext = {
    objective: session.objective,
    employeeName: info.employee.name,
    employeeRole: info.role,
    iteration,
    stepBudget: session.stepBudget,
    stepsUsed: session.stepsUsed,
    toolCatalog,
    history,
    lastApprovalOutcome,
  };

  let decision;
  try {
    decision = await brain(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model call failed.";
    return finalize(client, session, "failed", `Autopilot hit an error: ${message}`, seq);
  }

  // Record the thought (and the plan on the first iteration).
  if (iteration === 0 && decision.plan?.length) {
    await appendStep(client, {
      workspaceId: session.workspaceId,
      sessionId,
      seq: seq++,
      kind: "plan",
      title: "Plan",
      detail: decision.plan.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      metadata: { iteration },
    });
    await updateSession(client, sessionId, { plan: decision.plan });
  }
  await appendStep(client, {
    workspaceId: session.workspaceId,
    sessionId,
    seq: seq++,
    kind: "thought",
    title: decision.thought || "Thinking…",
    metadata: { iteration },
  });

  // Terminal decisions.
  if (decision.status === "done") {
    return finalize(client, session, "completed", decision.report || "Objective complete.", seq);
  }
  if (decision.status === "blocked") {
    return finalize(client, session, "failed", decision.report || "I could not proceed.", seq);
  }

  // Execute tool calls, observing each result. Use the brain's real model
  // cost when reported, else the flat estimate, so the budget reflects usage.
  const calls = decision.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ITERATION);
  let iterationCost =
    decision.usageCostUsd != null && decision.usageCostUsd > 0
      ? decision.usageCostUsd
      : ESTIMATED_MODEL_COST_PER_ITERATION;

  if (calls.length === 0) {
    // No action and not done — nudge forward without burning the loop forever.
    await appendStep(client, {
      workspaceId: session.workspaceId,
      sessionId,
      seq: seq++,
      kind: "observation",
      title: "No action taken",
      detail: "No tool was called this step.",
      metadata: { iteration, status: "skipped" },
    });
  }

  for (const call of calls) {
    const runId = `auton:${session.id}:${iteration}`;
    const result: ToolCallResult = await runTool(
      client,
      {
        client,
        workspaceId: session.workspaceId,
        employeeId: session.employeeId,
        employeeName: info.employee.name,
        roomId: session.roomId,
        topicId: session.topicId,
        triggerMessageId: runId,
      },
      {
        tool: call.tool,
        mode: call.mode === "preview" ? "preview" : "execute",
        args: call.args ?? {},
        employeeId: session.employeeId,
      },
      { employee: info.employee },
    );

    iterationCost += result.costUsd;
    if (result.toolRunId) void linkToolRun(client, session.workspaceId, result.toolRunId, session.id);

    await appendStep(client, {
      workspaceId: session.workspaceId,
      sessionId,
      seq: seq++,
      kind: "tool_call",
      title: call.tool,
      detail: describeArgs(call.args),
      toolName: call.tool,
      toolRunId: result.toolRunId,
      status: result.status === "success" ? "success" : result.status === "approval_pending" ? "pending" : "failed",
      metadata: { iteration },
    });

    // Approval-gated action → pause the session.
    if (result.status === "approval_pending" && result.approvalId) {
      await appendStep(client, {
        workspaceId: session.workspaceId,
        sessionId,
        seq: seq++,
        kind: "approval",
        title: "Waiting for approval",
        detail: result.preview?.summary ?? `Needs approval to run ${call.tool}.`,
        toolName: call.tool,
        metadata: { iteration, approvalId: result.approvalId },
      });
      await updateSession(client, sessionId, {
        status: "waiting_approval",
        pendingApprovalId: result.approvalId,
        stepsUsed: session.stepsUsed + 1,
        costUsedUsd: session.costUsedUsd + iterationCost,
      });
      return { status: "waiting_approval", shouldContinue: false };
    }

    const summary =
      result.output?.summary ??
      (result.status === "success" ? `${call.tool} ran.` : result.error ?? `${call.tool} ${result.status}.`);
    await appendStep(client, {
      workspaceId: session.workspaceId,
      sessionId,
      seq: seq++,
      kind: "observation",
      title: result.status === "success" ? "Result" : `Result (${result.status})`,
      detail: summary,
      toolName: call.tool,
      status: result.status === "success" ? "success" : "failed",
      metadata: { iteration, status: result.status },
    });
  }

  // Advance: increment budget usage and re-queue for the next iteration.
  const stepsUsed = session.stepsUsed + 1;
  const costUsedUsd = session.costUsedUsd + iterationCost;
  const budgetHit = stepsUsed >= session.stepBudget || costUsedUsd >= session.costBudgetUsd;
  await updateSession(client, sessionId, {
    status: budgetHit ? "running" : "queued",
    stepsUsed,
    costUsedUsd,
  });

  if (budgetHit) {
    const fresh = await getSession(client, sessionId);
    if (fresh) {
      return finalize(
        client,
        fresh,
        "completed",
        `Reached the run budget after ${stepsUsed} steps. Ask me to continue if more is needed.`,
        await countSteps(client, sessionId),
      );
    }
  }

  return { status: "queued", shouldContinue: true };
}

// ---------------------------------------------------------------------------
// Approval resume — one-shot outcome passed to the next iteration's context.
// ---------------------------------------------------------------------------

async function popApprovalOutcome(
  client: SupabaseClient,
  session: AutonomousSession,
): Promise<AutonomyBrainContext["lastApprovalOutcome"]> {
  const steps = await listSteps(client, session.id);
  const last = steps[steps.length - 1];
  // One-shot: only surface when the resolved-approval step is the most recent
  // event — once the next iteration appends thoughts/observations it's stale.
  if (!last || last.kind !== "approval" || !last.metadata.resolved) return undefined;
  const approved = String(last.metadata.resolution) === "approved";
  return { approved, summary: last.detail ?? (approved ? "Approved." : "Rejected.") };
}

/**
 * Called by the poll route while a session is waiting_approval: if the pending
 * approval has been resolved, record the outcome and re-queue for continuation.
 */
export async function resumeIfApprovalResolved(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const session = await getSession(client, sessionId);
  if (!session || session.status !== "waiting_approval" || !session.pendingApprovalId) return session;

  const { data: approval } = await client
    .from("approvals")
    .select("status")
    .eq("workspace_id", session.workspaceId)
    .eq("id", session.pendingApprovalId)
    .maybeSingle();
  const status = approval?.status ? String(approval.status) : null;
  if (!status || status === "pending" || status === "revision_requested") return session;

  const approved = status === "approved";
  const seq = await countSteps(client, sessionId);
  await appendStep(client, {
    workspaceId: session.workspaceId,
    sessionId,
    seq,
    kind: "approval",
    title: approved ? "Approved" : "Rejected",
    detail: approved ? "The action was approved and executed." : "The action was rejected.",
    status: approved ? "success" : "failed",
    metadata: { iteration: session.stepsUsed, resolved: true, resolution: status },
  });
  return updateSession(client, sessionId, {
    status: "queued",
    pendingApprovalId: null,
  });
}

// ---------------------------------------------------------------------------
// Inline driver — runs iterations until the session pauses or finishes.
// ---------------------------------------------------------------------------

/**
 * Max wall-clock a single drive request holds the loop. Serverless functions
 * have a hard duration cap, and the poll route awaits this — so we bound each
 * request to ~one iteration's worth of work, return, and let the next poll
 * re-claim the (re-queued) session. Combined with the atomic per-iteration
 * claim this makes autopilot resilient to killed requests without any single
 * request running for minutes or overlapping polls double-driving.
 */
const DRIVE_DEADLINE_MS = 55_000;

export async function driveSession(
  client: SupabaseClient,
  sessionId: string,
  brain: AutonomyBrain,
  maxIterations = 20,
  deps: EngineDeps = {},
  deadlineMs = DRIVE_DEADLINE_MS,
): Promise<AutonomousSession | null> {
  const deadline = Date.now() + deadlineMs;
  for (let i = 0; i < maxIterations; i += 1) {
    if (Date.now() >= deadline) break;
    // Atomic claim: flips queued → running (recovering an orphaned running
    // session whose lease expired). Null means the session isn't drivable right
    // now — it's terminal, paused, waiting on approval, or another request holds
    // a fresh lock — so we stop rather than racing it.
    const claimed = await claimForIteration(client, sessionId);
    if (!claimed) {
      return getSession(client, sessionId);
    }
    const outcome = await runSessionIteration(client, sessionId, brain, deps);
    if (!outcome.shouldContinue) break;
  }
  return getSession(client, sessionId);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function countSteps(client: SupabaseClient, sessionId: string): Promise<number> {
  return (await listSteps(client, sessionId)).length;
}

async function linkToolRun(
  client: SupabaseClient,
  workspaceId: string,
  toolRunId: string,
  sessionId: string,
): Promise<void> {
  await client
    .from("integration_tool_runs")
    .update({ autonomous_session_id: sessionId })
    .eq("workspace_id", workspaceId)
    .eq("id", toolRunId)
    .then(({ error }) => {
      if (error) console.warn("[AdeHQ autonomy] tool run link failed", error);
    });
}

function describeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v != null && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}`);
  return parts.join(" · ");
}
