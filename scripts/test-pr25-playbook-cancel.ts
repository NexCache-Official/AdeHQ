/**
 * PR-25 — cancellation helpers stop downstream (no DB).
 */
import {
  shouldStopDownstream,
  cancelledStepStatuses,
  isCancellableRunStatus,
  advanceReadySteps,
  createPlaybookRunEnvelope,
  matchPlaybookRoles,
  PLATFORM_PLAYBOOK_SEEDS,
} from "../src/lib/playbooks";
import type { PlaybookRoleCandidate, PlaybookRunEnvelopeStep } from "../src/lib/playbooks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 playbook cancel ===\n");

check("cancelled stops downstream", shouldStopDownstream("cancelled"));
check("failed stops downstream", shouldStopDownstream("failed"));
check("completed stops downstream", shouldStopDownstream("completed"));
check("running does not stop", !shouldStopDownstream("running"));

const statuses = cancelledStepStatuses();
check("pending → cancelled", statuses.forPending === "cancelled");
check("ready → cancelled", statuses.forReady === "cancelled");
check("running → cancelled", statuses.forRunning === "cancelled");

check("running is cancellable", isCancellableRunStatus("running"));
check("queued is cancellable", isCancellableRunStatus("queued"));
check("completed not cancellable", !isCancellableRunStatus("completed"));

const definition =
  PLATFORM_PLAYBOOK_SEEDS.find((p) => p.key === "competitor_analysis") ??
  PLATFORM_PLAYBOOK_SEEDS[0]!;
const candidates: PlaybookRoleCandidate[] = definition.roleRequirements.map((r, i) => ({
  employeeId: `emp_${r.roleKey}_${i}`,
  capabilityTags: r.capabilityTags ?? [],
  roleTags: r.roleTags ?? [r.roleKey],
}));
const assignments = matchPlaybookRoles(definition.roleRequirements, candidates);
const envelope = createPlaybookRunEnvelope({
  definition,
  roleAssignments: assignments,
  inputPayload: {},
  status: "cancelled",
});

const mapCancel = (steps: PlaybookRunEnvelopeStep[]): PlaybookRunEnvelopeStep[] =>
  steps.map((s) => {
    if (s.status === "pending") return { ...s, status: statuses.forPending };
    if (s.status === "ready") return { ...s, status: statuses.forReady };
    if (s.status === "running" || s.status === "leased") {
      return { ...s, status: statuses.forRunning };
    }
    return s;
  });

let steps = mapCancel(envelope.steps);
check(
  "all non-terminal steps cancelled",
  steps.every((s) => s.status === "cancelled" || s.status === "completed" || s.status === "failed" || s.status === "skipped"),
);

// Even if someone completes a dep, cancelled run must not lease new work
const afterAdvance = advanceReadySteps(
  steps.map((s) => (s.status === "cancelled" ? s : s)),
  definition,
);
check(
  "advanceReadySteps does not revive cancelled",
  afterAdvance.every((s) => s.status !== "ready" || envelope.steps.find((o) => o.stepKey === s.stepKey)?.status === "ready"),
);
check("shouldStopDownstream on cancelled envelope", shouldStopDownstream(envelope.status));

console.log(`\n${failed ? `Failed: ${failed}` : "All playbook cancel checks passed."}\n`);
process.exit(failed ? 1 : 0);
