// PR-22D — deterministic goal-based team edits with WH impact math.
// Produces NlEditProposal-compatible diffs; Apply reuses applyNlEditProposal.

import { getAllRoles, getRoleByKey } from "@/lib/hiring/role-library";
import {
  applyNlEditProposal,
  buildNlEditOps,
  type NlEditDiffOp,
  type NlEditProposal,
} from "./nl-edit-apply";
import { forecastWorkHours } from "./simulation";
import type { WorkforceBlueprintPayload, WorkforceSeat } from "./types";

export type GoalOpId =
  | "make_leaner"
  | "optimize_growth"
  | "optimize_support"
  | "reduce_costs"
  | "add_qc"
  | "increase_speed"
  | "more_cautious"
  | "prepare_expansion"
  | "design_around_humans";

export type GoalOpImpact = {
  beforeLowWh: number;
  beforeHighWh: number;
  afterLowWh: number;
  afterHighWh: number;
  deltaLowWh: number;
  deltaHighWh: number;
  bullets: string[];
};

export type GoalOpResult = {
  proposal: NlEditProposal;
  ops: NlEditDiffOp[];
  impact: GoalOpImpact;
  message: string;
};

export const GOAL_OP_LABELS: Record<GoalOpId, string> = {
  make_leaner: "Make leaner",
  optimize_growth: "Optimize for growth",
  optimize_support: "Optimize for support",
  reduce_costs: "Reduce costs",
  add_qc: "Add stronger QC",
  increase_speed: "Increase execution speed",
  more_cautious: "Make more cautious",
  prepare_expansion: "Prepare for expansion",
  design_around_humans: "Design around humans",
};

function emptyProposal(summary: string): NlEditProposal {
  return {
    summary,
    addOutcomes: [],
    addSeats: [],
    removeSeatIds: [],
    updateSeats: [],
    addSeatTitles: [],
  };
}

function whBand(payload: WorkforceBlueprintPayload) {
  const bands = forecastWorkHours(payload.seats);
  return {
    low: Math.round(bands.reduce((s, b) => s + b.lowWh, 0)),
    high: Math.round(bands.reduce((s, b) => s + b.highWh, 0)),
  };
}

function impactOf(
  before: WorkforceBlueprintPayload,
  after: WorkforceBlueprintPayload,
  bullets: string[],
): GoalOpImpact {
  const b = whBand(before);
  const a = whBand(after);
  return {
    beforeLowWh: b.low,
    beforeHighWh: b.high,
    afterLowWh: a.low,
    afterHighWh: a.high,
    deltaLowWh: a.low - b.low,
    deltaHighWh: a.high - b.high,
    bullets,
  };
}

function hasRole(payload: WorkforceBlueprintPayload, roleKey: string): boolean {
  return payload.seats.some((s) => s.roleKey === roleKey);
}

function leastEssentialSeat(payload: WorkforceBlueprintPayload): WorkforceSeat | null {
  if (payload.seats.length <= 2) return null;
  const ranked = [...payload.seats].sort((a, b) => {
    const score = (s: WorkforceSeat) => {
      let n = 0;
      if (s.seniority === "assistant") n += 2;
      if (s.source === "manual") n += 1;
      if (/research|content|automation/i.test(s.roleKey)) n += 3;
      if (/product_manager|operations_assistant|customer_support/.test(s.roleKey)) n -= 2;
      return n;
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

function buildProposal(op: GoalOpId, payload: WorkforceBlueprintPayload): {
  proposal: NlEditProposal;
  bullets: string[];
} {
  const proposal = emptyProposal(GOAL_OP_LABELS[op]);
  const bullets: string[] = [];
  const roles = getAllRoles();

  switch (op) {
    case "make_leaner":
    case "reduce_costs": {
      const seat = leastEssentialSeat(payload);
      if (seat) {
        proposal.removeSeatIds = [seat.id];
        proposal.summary =
          op === "reduce_costs"
            ? `Remove ${seat.roleTitle} to reduce weekly capacity cost.`
            : `Remove the least essential seat (${seat.roleTitle}) to lean the team.`;
        bullets.push(`Remove ${seat.roleTitle}`);
        bullets.push("Lower expected weekly Work Hours");
      } else {
        proposal.summary = "Team is already lean — no seat removed.";
        bullets.push("No structural change — already at minimum size");
      }
      break;
    }
    case "optimize_growth": {
      if (!hasRole(payload, "marketing_manager") && !hasRole(payload, "sales_development_rep")) {
        const role = getRoleByKey("marketing_manager") ?? roles[0];
        proposal.addSeats = [
          {
            roleKey: role.roleKey,
            mission: "Drive demand generation and campaign performance for growth.",
            primaryRoomName: "Growth",
          },
        ];
        bullets.push(`Add ${role.title}`);
      }
      if (!hasRole(payload, "sales_development_rep")) {
        proposal.addSeats = [
          ...proposal.addSeats,
          {
            roleKey: "sales_development_rep",
            mission: "Build and qualify pipeline in CRM.",
            primaryRoomName: "Growth",
          },
        ];
        bullets.push("Add Sales Development Rep");
      }
      if (proposal.addSeats.length === 0) {
        const marketing = payload.seats.find((s) => /marketing|sales|content/.test(s.roleKey));
        if (marketing) {
          proposal.updateSeats = [
            {
              seatId: marketing.id,
              mission: `${marketing.mission} Prioritize acquisition and pipeline contribution this quarter.`,
            },
          ];
          bullets.push(`Tighten ${marketing.roleTitle} toward growth`);
        }
      }
      proposal.addOutcomes = [
        {
          title: "Growth pipeline",
          metric: "Qualified opportunities / week",
          target: "Steady qualified pipeline without CRM debt",
          checkpointCadence: "weekly",
        },
      ];
      bullets.push("Add growth pipeline outcome");
      proposal.summary = "Optimize the team for sales and growth coverage.";
      break;
    }
    case "optimize_support": {
      if (!hasRole(payload, "customer_support_agent") && !hasRole(payload, "technical_support_agent")) {
        proposal.addSeats = [
          {
            roleKey: "customer_support_agent",
            mission: "Handle customer questions with clear drafts and escalations; approval before refunds/outbound.",
            primaryRoomName: "Customer Experience",
          },
        ];
        bullets.push("Add Customer Support Agent");
      } else {
        const support = payload.seats.find((s) => /support|success/.test(s.roleKey));
        if (support) {
          proposal.updateSeats = [
            {
              seatId: support.id,
              mission: `${support.mission} Prioritize response quality and escalation clarity.`,
            },
          ];
          bullets.push(`Strengthen ${support.roleTitle} support focus`);
        }
      }
      proposal.addOutcomes = [
        {
          title: "Customer response quality",
          metric: "First-response time",
          target: "Priority threads answered within a business day",
          checkpointCadence: "weekly",
        },
      ];
      bullets.push("Add support quality outcome");
      proposal.summary = "Optimize the team for customer support coverage.";
      break;
    }
    case "add_qc": {
      if (!hasRole(payload, "qa_test_engineer")) {
        proposal.addSeats = [
          {
            roleKey: "qa_test_engineer",
            mission: "Protect release and deliverable quality with clear review checkpoints.",
            primaryRoomName: "Quality",
          },
        ];
        bullets.push("Add QA / Test Engineer");
      }
      proposal.addOutcomes = [
        {
          title: "Quality bar",
          metric: "Escaped defects / rework",
          target: "No major deliverable ships without review",
          checkpointCadence: "weekly",
        },
      ];
      bullets.push("Add quality outcome");
      // Tighten a delivery seat's mission toward review.
      const deliver = payload.seats.find((s) => /engineer|developer|ops|content/.test(s.roleKey));
      if (deliver) {
        proposal.updateSeats = [
          {
            seatId: deliver.id,
            mission: `${deliver.mission} Route finished work through QA review before external publish.`,
          },
        ];
        bullets.push(`Give ${deliver.roleTitle} a QA handoff`);
      }
      proposal.summary = "Add stronger quality control across the team.";
      break;
    }
    case "increase_speed": {
      if (!hasRole(payload, "automation_specialist") && payload.seats.length < 10) {
        proposal.addSeats = [
          {
            roleKey: "automation_specialist",
            mission: "Automate repetitive workflows to raise execution speed.",
            primaryRoomName: "Operations",
          },
        ];
        bullets.push("Add Automation Specialist");
      }
      const ops = payload.seats.find((s) => /operations|project_manager|product_manager/.test(s.roleKey));
      if (ops) {
        proposal.updateSeats = [
          {
            seatId: ops.id,
            mission: `${ops.mission} Bias toward faster cycle time and clear blockers.`,
          },
        ];
        bullets.push(`Speed-focus ${ops.roleTitle}`);
      }
      proposal.addOutcomes = [
        {
          title: "Cycle time",
          metric: "Time from ask → draft delivered",
          target: "Cut median cycle time by 20%",
          checkpointCadence: "biweekly",
        },
      ];
      proposal.summary = "Increase execution speed with automation and tighter cycle goals.";
      break;
    }
    case "more_cautious": {
      // Represent caution as mission updates (authorityPolicy is not NL-editable).
      proposal.updateSeats = payload.seats.slice(0, 4).map((s) => ({
        seatId: s.id,
        mission: `${s.mission} Prefer draft-first; escalate anything external or irreversible.`,
      }));
      bullets.push("Bias missions toward draft-first / approval-seeking");
      proposal.addOutcomes = [
        {
          title: "Safe external actions",
          metric: "Unapproved external sends",
          target: "Zero unapproved external actions",
          checkpointCadence: "weekly",
        },
      ];
      bullets.push("Add safety outcome");
      proposal.summary = "Make the team more cautious on external and irreversible actions.";
      break;
    }
    case "prepare_expansion": {
      if (!hasRole(payload, "executive_assistant")) {
        proposal.addSeats = [
          {
            roleKey: "executive_assistant",
            mission: "Keep expansion priorities, hiring follow-ups, and owner briefings organized.",
            primaryRoomName: "Leadership",
          },
        ];
        bullets.push("Add Executive Assistant");
      }
      proposal.addOutcomes = [
        {
          title: "Expansion readiness",
          metric: "Documented playbooks",
          target: "Core workflows documented before headcount grows",
          checkpointCadence: "monthly",
        },
      ];
      bullets.push("Add expansion readiness outcome");
      if (payload.seats.length >= 2 && !hasRole(payload, "operations_assistant")) {
        proposal.addSeats = [
          ...proposal.addSeats,
          {
            roleKey: "operations_assistant",
            mission: "Absorb operational overflow as the team scales.",
            primaryRoomName: "Operations",
          },
        ];
        bullets.push("Add Operations coverage for scale");
      }
      proposal.summary = "Prepare this team for expansion with coverage and playbooks.";
      break;
    }
    case "design_around_humans": {
      proposal.updateSeats = payload.seats.slice(0, 5).map((s) => ({
        seatId: s.id,
        mission: `${s.mission} Humans own strategy and final external decisions; you draft and coordinate.`,
      }));
      bullets.push("Reframe seats as draft/coordinate around human owners");
      proposal.addOutcomes = [
        {
          title: "Human-in-the-loop",
          metric: "Strategic decisions with human owner",
          target: "100% of strategy calls have a named human owner",
          checkpointCadence: "weekly",
        },
      ];
      bullets.push("Add human-in-the-loop outcome");
      proposal.summary = "Design the team around existing human owners for strategy.";
      break;
    }
  }

  proposal.addSeatTitles = proposal.addSeats.map((s) => getRoleByKey(s.roleKey)?.title ?? s.roleKey);
  return { proposal, bullets };
}

export function proposeGoalOp(op: GoalOpId, payload: WorkforceBlueprintPayload): GoalOpResult | null {
  if (!(op in GOAL_OP_LABELS)) return null;
  const { proposal, bullets } = buildProposal(op, payload);
  const hasWork =
    proposal.addSeats.length +
      proposal.removeSeatIds.length +
      proposal.updateSeats.length +
      proposal.addOutcomes.length >
    0;
  if (!hasWork) {
    return {
      proposal,
      ops: [],
      impact: impactOf(payload, payload, bullets),
      message: proposal.summary,
    };
  }
  const after = applyNlEditProposal(payload, proposal);
  const ops = buildNlEditOps(payload, proposal);
  const impact = impactOf(payload, after, bullets);
  const whNote =
    impact.deltaHighWh === 0 && impact.deltaLowWh === 0
      ? "Capacity roughly unchanged"
      : impact.deltaHighWh > 0
        ? `About +${impact.deltaLowWh}–${impact.deltaHighWh} WH/week`
        : `About ${impact.deltaLowWh}–${impact.deltaHighWh} WH/week`;
  return {
    proposal,
    ops,
    impact: { ...impact, bullets: [...bullets, whNote] },
    message: proposal.summary,
  };
}

export function isGoalOpId(value: string): value is GoalOpId {
  return value in GOAL_OP_LABELS;
}
