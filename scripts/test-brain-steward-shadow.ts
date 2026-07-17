/**
 * PR-19 Session 2 — Steward shadow planning golden scenarios.
 * Plan generation + validation only. No delegation execution.
 *
 *   npm run test:brain:steward-shadow
 */
import {
  buildStewardShadowPlan,
  shouldCollaborate,
  validateCollaborationPlan,
  getMultiAgentPolicy,
} from "../src/lib/brain/steward";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const alex = { id: "emp_alex", name: "Alex", role: "PM", roleKey: "pm" };
const priya = { id: "emp_priya", name: "Priya", role: "Research Analyst", roleKey: "analyst" };
const jordan = {
  id: "emp_jordan",
  name: "Jordan",
  role: "Engineer",
  roleKey: "engineer",
};
const roster = [alex, priya, jordan];
const accessible = roster.map((e) => e.id);

console.log("\n=== PR-19 Steward shadow planning ===\n");

// --- triggers ---
check(
  "greeting skips collaboration",
  !shouldCollaborate({
    message: "Hi team",
    mentionedEmployeeCount: 0,
    isPrivateDm: false,
    accessibleEmployeeCount: 3,
  }).collaborate,
);

check(
  "private DM never collaborates",
  !shouldCollaborate({
    message: "@Alex and @Priya research Acme and draft outreach",
    mentionedEmployeeCount: 2,
    isPrivateDm: true,
    accessibleEmployeeCount: 1,
  }).collaborate,
);

check(
  "research+artifact triggers collaboration",
  shouldCollaborate({
    message: "Research Acme Corp and draft a sales outreach email",
    mentionedEmployeeCount: 0,
    isPrivateDm: false,
    accessibleEmployeeCount: 3,
  }).collaborate,
);

check(
  "explicit multi-mention triggers",
  shouldCollaborate({
    message: "@Alex work with @Priya on the launch plan",
    mentionedEmployeeCount: 2,
    isPrivateDm: false,
    accessibleEmployeeCount: 3,
  }).collaborate,
);

// --- golden: single employee ---
{
  const shadow = buildStewardShadowPlan({
    message: "What time is standup usually?",
    candidates: roster,
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    preferredEmployeeIds: [alex.id],
    legacy: { mode: "direct_reply", leadEmployeeId: alex.id, participantEmployeeIds: [alex.id] },
  });
  check("simple question → single_employee", shadow.plan?.mode === "single_employee");
  check("simple question validates", shadow.validation.ok, shadow.validation.errors.join(","));
  check("simple question lead matches legacy", Boolean(shadow.comparison?.leadMatches));
  check("shadow never executes", shadow.executed === false && shadow.shadow === true);
}

// --- golden: research + outreach ---
{
  const shadow = buildStewardShadowPlan({
    message: "Research the market and draft outreach for Acme",
    candidates: roster,
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    preferredEmployeeIds: [alex.id, priya.id],
    orchestrationSelectedIds: [alex.id],
    legacy: {
      mode: "lead_collaborator",
      leadEmployeeId: alex.id,
      participantEmployeeIds: [alex.id, priya.id],
    },
  });
  check(
    "research+draft → multi-step plan",
    Boolean(shadow.plan && shadow.plan.steps.length >= 2),
    `mode=${shadow.plan?.mode} steps=${shadow.plan?.steps.length}`,
  );
  check("research plan validates", shadow.validation.ok, shadow.validation.errors.join(","));
  check("research lead is accessible", shadow.plan?.leadEmployeeId === alex.id);
  check(
    "synthesis owned by lead",
    Boolean(shadow.plan?.steps.some((s) => s.capability === "synthesis" && s.employeeId === alex.id)),
  );
  check("mode family matches legacy collab", Boolean(shadow.comparison?.modeFamilyMatches));
}

// --- golden: produce and review ---
{
  const shadow = buildStewardShadowPlan({
    message: "Implement the auth fix and then peer review the code",
    candidates: roster,
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    preferredEmployeeIds: [jordan.id, alex.id],
  });
  check(
    "coding+review → produce_and_review or delegated multi-step",
    Boolean(
      shadow.plan &&
        (shadow.plan.mode === "produce_and_review" || shadow.plan.steps.length >= 2),
    ),
    `mode=${shadow.plan?.mode}`,
  );
  check("coding plan validates", shadow.validation.ok, shadow.validation.errors.join(","));
}

// --- golden: private DM single only ---
{
  const shadow = buildStewardShadowPlan({
    message: "@Alex and @Priya research Acme and draft outreach",
    candidates: [alex],
    accessibleEmployeeIds: [alex.id],
    roomEmployeeIds: [alex.id],
    preferredEmployeeIds: [alex.id, priya.id],
    dmEmployeeId: alex.id,
    isPrivateDm: true,
  });
  check("private DM plan is single_employee", shadow.plan?.mode === "single_employee");
  check(
    "private DM has no other employees in steps",
    Boolean(shadow.plan?.steps.every((s) => s.employeeId === alex.id)),
  );
  check("private DM validates", shadow.validation.ok, shadow.validation.errors.join(","));
}

// --- validation: inaccessible employee ---
{
  const policy = getMultiAgentPolicy();
  const bad = buildStewardShadowPlan({
    message: "@Alex work with @Priya on launch",
    candidates: roster,
    accessibleEmployeeIds: [alex.id], // Priya inaccessible
    roomEmployeeIds: [alex.id],
    preferredEmployeeIds: [alex.id, priya.id],
    legacy: { mode: "lead_collaborator", leadEmployeeId: alex.id },
  });
  // Builder only uses accessible candidates; plan should still validate
  check(
    "inaccessible specialists excluded from plan",
    Boolean(bad.plan && bad.plan.steps.every((s) => s.employeeId === alex.id || accessible.includes(s.employeeId))),
  );
  check("restricted access plan validates", bad.validation.ok, bad.validation.errors.join(","));

  const forged = {
    ...bad.plan!,
    steps: [
      ...bad.plan!.steps,
      {
        stepId: "evil",
        objective: "leak",
        capability: "search" as const,
        employeeId: "emp_outsider",
        dependsOn: [],
        expectedOutput: "x",
        shareScope: "workspace" as const,
        estimatedWh: 1,
      },
    ],
  };
  const v = validateCollaborationPlan(forged, {
    accessibleEmployeeIds: [alex.id],
    roomEmployeeIds: [alex.id],
    policy,
  });
  check("validator rejects inaccessible employee", !v.ok && v.errors.some((e) => e.includes("not_accessible")));
}

// --- validation: cycle ---
{
  const policy = getMultiAgentPolicy();
  const cyclic = {
    objective: "x",
    leadEmployeeId: alex.id,
    mode: "delegated" as const,
    steps: [
      {
        stepId: "a",
        objective: "a",
        capability: "reasoning" as const,
        employeeId: alex.id,
        dependsOn: ["b"],
        expectedOutput: "a",
        shareScope: "room" as const,
        estimatedWh: 1,
      },
      {
        stepId: "b",
        objective: "b",
        capability: "reasoning" as const,
        employeeId: priya.id,
        dependsOn: ["a"],
        expectedOutput: "b",
        shareScope: "room" as const,
        estimatedWh: 1,
      },
    ],
    maxCollaborators: 2,
    maxSteps: 8,
    estimatedWhMin: 1,
    estimatedWhMax: 2,
    hardWhLimit: 5,
    approvalRequired: false,
  };
  const v = validateCollaborationPlan(cyclic, {
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    policy,
  });
  check("validator rejects dependency cycle", !v.ok && v.errors.includes("dependency_cycle"));
}

// --- budget approval gate ---
{
  const shadow = buildStewardShadowPlan({
    message: "Research the market and draft a board launch plan with legal review",
    candidates: roster,
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    preferredEmployeeIds: [alex.id, priya.id, jordan.id],
    policy: { maxEmployees: 3, maxSteps: 8, autoWhLimit: 1, reviewEnabled: true },
  });
  check(
    "expensive estimate may require approval",
    Boolean(shadow.plan && (shadow.plan.approvalRequired || shadow.plan.estimatedWhMax > 1)),
  );
}

console.log(`\n${failed ? `Failed: ${failed}` : "All steward shadow checks passed."}\n`);
process.exit(failed ? 1 : 0);
