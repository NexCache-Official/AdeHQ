// General Ops template pack — a lean back-office team for any business:
// operations, finance/bookkeeping, and an executive assistant, scaling into
// an automation specialist and a second ops seat as workload grows.

import type { SimulationFinding } from "../types";
import type { TemplateManifest } from "./types";

const ROOM_OPERATIONS = "room_operations";
const ROOM_LEADERSHIP = "room_leadership";

const SEAT_OPS = "ops_1";
const SEAT_FINANCE = "finance_1";
const SEAT_EA = "ea_1";
const SEAT_AUTOMATION = "automation_1";
const SEAT_OPS_2 = "ops_2";

export const GENERAL_OPS_TEMPLATE: TemplateManifest = {
  key: "general_ops",
  version: "1.0.0",
  name: "General Ops",
  description: "A lean back-office team — operations, finance, and executive support — that scales in automation as manual workload grows.",
  industry: "general",
  intakeQuestions: [
    {
      id: "primary_ops_focus",
      prompt: "What should this team focus on first?",
      type: "single_select",
      options: [
        { value: "vendor_logistics", label: "Vendor & logistics coordination" },
        { value: "financial_hygiene", label: "Financial hygiene (books, invoices)" },
        { value: "executive_support", label: "Executive support" },
        { value: "all", label: "A bit of everything" },
      ],
      defaultValue: "all",
    },
    {
      id: "team_size_preference",
      prompt: "How big should this team start?",
      type: "single_select",
      options: [
        { value: "lean", label: "Lean (2-3 seats)" },
        { value: "standard", label: "Standard (4-5 seats)" },
      ],
      defaultValue: "lean",
    },
    {
      id: "needs_automation",
      prompt: "Is there a lot of repetitive manual work to automate?",
      type: "single_select",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "Not yet" },
      ],
      defaultValue: "no",
    },
  ],
  baseSeats: [
    {
      templateSeatId: SEAT_OPS,
      roleKey: "operations_assistant",
      seniority: "specialist",
      modelMode: "cheap",
      communicationStyle: "Practical, checklist-driven updates.",
      personalityTraits: ["Organized", "Reliable"],
      missionTemplate: "Keep day-to-day operations running — vendors, schedules, and follow-ups.",
      responsibilities: ["Track operational tasks and follow-ups", "Coordinate vendors and schedules", "Document processes"],
      successMetrics: ["Fewer dropped tasks", "Clear process docs"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_OPERATIONS,
    },
    {
      templateSeatId: SEAT_FINANCE,
      roleKey: "bookkeeping_assistant",
      seniority: "specialist",
      modelMode: "cheap",
      communicationStyle: "Precise, numbers-first updates with clear flags for anomalies.",
      personalityTraits: ["Careful", "Detail-oriented"],
      missionTemplate: "Keep the books current — expenses, invoices, and reconciliation.",
      responsibilities: ["Categorize transactions and expenses", "Track invoices and payments", "Flag anomalies for review"],
      successMetrics: ["Up-to-date books", "Fewer reconciliation errors"],
      toolIds: [],
      authorityPolicy: { tasks: "act_with_approval", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_OPERATIONS,
    },
  ],
  baseRooms: [
    {
      templateRoomId: ROOM_LEADERSHIP,
      name: "Leadership",
      kind: "leadership",
      description: "Priorities and decisions that affect the whole business.",
      visibility: "restricted",
      humanReferenceRoles: ["Founder / Owner"],
    },
    {
      templateRoomId: ROOM_OPERATIONS,
      name: "Operations",
      kind: "department",
      description: "Day-to-day coordination, finance hygiene, and admin.",
      visibility: "workspace",
    },
  ],
  baseEdges: [
    {
      type: "collaborates_with",
      fromSeatTemplateId: SEAT_OPS,
      toSeatTemplateId: SEAT_FINANCE,
      description: "Coordinate on vendor payments and invoice status.",
    },
  ],
  baseOutcomes: [
    {
      title: "Operational reliability",
      metric: "Dropped or late follow-ups",
      target: "Zero missed vendor/process follow-ups per month",
      checkpointCadence: "weekly",
      ownerSeatTemplateId: SEAT_OPS,
    },
    {
      title: "Financial hygiene",
      metric: "Unreconciled transactions and overdue invoices",
      target: "Books reconciled and invoices current every month, zero surprises at close",
      checkpointCadence: "monthly",
      ownerSeatTemplateId: SEAT_FINANCE,
    },
  ],
  scalingRules: [
    {
      id: "add_executive_assistant",
      description: "Standard-size teams get a dedicated executive assistant.",
      condition: { "==": [{ var: "answers.team_size_preference" }, "standard"] },
      addSeats: [
        {
          templateSeatId: SEAT_EA,
          roleKey: "executive_assistant",
          seniority: "specialist",
          modelMode: "balanced",
          communicationStyle: "Warm, efficient, and proactive about scheduling conflicts.",
          personalityTraits: ["Proactive", "Discreet"],
          missionTemplate: "Manage calendar, inbox triage, and meeting prep for leadership.",
          responsibilities: ["Manage calendar and meeting prep", "Draft executive communications", "Track action items"],
          successMetrics: ["Smoother executive schedule", "Timely follow-ups"],
          toolIds: [],
          authorityPolicy: { calendar: "act_autonomously", email: "act_with_approval", room_scope: "act_with_approval" },
          primaryRoomTemplateId: ROOM_LEADERSHIP,
        },
      ],
      addEdges: [
        {
          type: "handoff",
          fromSeatTemplateId: SEAT_EA,
          toSeatTemplateId: SEAT_OPS,
          description: "EA hands off scheduling/logistics requests that need operational follow-through.",
        },
      ],
      addOutcomes: [
        {
          title: "Executive schedule health",
          metric: "Double-bookings and last-minute reschedules",
          target: "Zero double-bookings; leadership calendar confirmed 48h ahead",
          checkpointCadence: "weekly",
          ownerSeatTemplateId: SEAT_EA,
        },
      ],
    },
    {
      id: "add_automation_specialist",
      description: "Add an automation specialist when there's meaningful repetitive manual work.",
      condition: { "==": [{ var: "answers.needs_automation" }, "yes"] },
      addSeats: [
        {
          templateSeatId: SEAT_AUTOMATION,
          roleKey: "automation_specialist",
          seniority: "specialist",
          modelMode: "balanced",
          communicationStyle: "Systems-thinking updates with before/after time-saved framing.",
          personalityTraits: ["Systematic", "Curious"],
          missionTemplate: "Find and automate the team's most repetitive manual workflows.",
          responsibilities: ["Identify repetitive manual workflows", "Design automation recipes", "Monitor automation reliability"],
          successMetrics: ["Hours saved per week", "Fewer manual errors"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_with_approval" },
          primaryRoomTemplateId: ROOM_OPERATIONS,
        },
      ],
      addEdges: [
        {
          type: "collaborates_with",
          fromSeatTemplateId: SEAT_AUTOMATION,
          toSeatTemplateId: SEAT_OPS,
          description: "Automation specialist and ops agree on which workflows to automate next.",
        },
      ],
      addOutcomes: [
        {
          title: "Manual work reduced",
          metric: "Hours of manual work automated per week",
          target: "At least 5 hours/week of manual work automated within the first quarter",
          checkpointCadence: "monthly",
          ownerSeatTemplateId: SEAT_AUTOMATION,
        },
      ],
    },
    {
      id: "add_second_ops_seat",
      description: "Standard-size teams with a broad focus get a second ops generalist.",
      condition: {
        and: [
          { "==": [{ var: "answers.team_size_preference" }, "standard"] },
          { "==": [{ var: "answers.primary_ops_focus" }, "all"] },
        ],
      },
      addSeats: [
        {
          templateSeatId: SEAT_OPS_2,
          roleKey: "operations_assistant",
          operationalVariant: "Second ops generalist",
          seniority: "specialist",
          modelMode: "cheap",
          communicationStyle: "Practical, checklist-driven updates.",
          personalityTraits: ["Flexible", "Reliable"],
          missionTemplate: "Share operational coverage with the primary ops seat as workload grows.",
          responsibilities: ["Cover overflow operational tasks", "Own a distinct slice of vendor relationships"],
          successMetrics: ["Balanced workload across ops", "Fewer dropped tasks"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
          primaryRoomTemplateId: ROOM_OPERATIONS,
        },
      ],
      addEdges: [
        {
          type: "collaborates_with",
          fromSeatTemplateId: SEAT_OPS,
          toSeatTemplateId: SEAT_OPS_2,
          description: "Split ownership of vendor relationships and cross-cover each other's follow-ups.",
        },
      ],
    },
  ],
  scenarios: buildGeneralOpsScenarios(),
  firstMissionTasks: [
    {
      titleTemplate: "Audit current vendor commitments",
      descriptionTemplate: "List every active vendor/subscription and flag anything unused or overdue for renewal review.",
      ownerSeatTemplateId: SEAT_OPS,
      dueInDays: 3,
    },
    {
      titleTemplate: "Reconcile the books and flag anomalies",
      descriptionTemplate: "Run a full reconciliation pass on recent transactions and invoices, flagging anything that needs a human decision.",
      ownerSeatTemplateId: SEAT_FINANCE,
      dueInDays: 4,
    },
  ],
};

function buildGeneralOpsScenarios() {
  return [
    {
      id: "ops_finance_without_approval_gate",
      title: "Finance seat can act without approval",
      category: "permission_risk" as const,
      description: "Bookkeeping/finance seats should never get act_autonomously on tasks that touch money without an approval gate.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const financeSeats = payload.seats.filter((s) => s.roleKey === "bookkeeping_assistant" || s.roleKey === "financial_analyst");
        const findings: SimulationFinding[] = [];
        for (const seat of financeSeats) {
          if (seat.authorityPolicy.tasks === "act_autonomously") {
            findings.push({
              id: `ops_finance_no_approval_${seat.id}`,
              kind: "permission_excess",
              severity: "critical",
              message: `${seat.roleTitle} can act on tasks with no approval gate — financial actions should require approval.`,
              seatIds: [seat.id],
              domain: "tasks",
            });
          }
        }
        return findings;
      },
    },
    {
      id: "ops_automation_without_ops_link",
      title: "Automation specialist with no operations link",
      category: "global" as const,
      description: "An automation specialist should have a collaboration edge to an ops seat — otherwise nobody is jointly deciding what to automate.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const automationSeats = payload.seats.filter((s) => s.roleKey === "automation_specialist");
        const opsSeatIds = new Set(payload.seats.filter((s) => s.roleKey === "operations_assistant").map((s) => s.id));
        const findings: SimulationFinding[] = [];
        for (const seat of automationSeats) {
          const hasOpsLink = payload.edges.some(
            (e) => (e.fromSeatId === seat.id && opsSeatIds.has(e.toSeatId)) || (e.toSeatId === seat.id && opsSeatIds.has(e.fromSeatId)),
          );
          if (!hasOpsLink) {
            findings.push({
              id: `ops_automation_no_link_${seat.id}`,
              kind: "coverage_gap",
              severity: "warning",
              message: `${seat.roleTitle} has no collaboration edge to an ops seat — add one so automation priorities are jointly owned, not siloed.`,
              seatIds: [seat.id],
            });
          }
        }
        return findings;
      },
    },
    {
      id: "ops_ea_with_autonomous_email",
      title: "Executive assistant with unsupervised email access",
      category: "permission_risk" as const,
      description: "An executive assistant sending email fully autonomously (no approval) risks a leadership-voice mistake going out unreviewed.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const eaSeats = payload.seats.filter((s) => s.roleKey === "executive_assistant");
        const findings: SimulationFinding[] = [];
        for (const seat of eaSeats) {
          if (seat.authorityPolicy.email === "act_autonomously") {
            findings.push({
              id: `ops_ea_autonomous_email_${seat.id}`,
              kind: "permission_excess",
              severity: "warning",
              message: `${seat.roleTitle} can send email fully autonomously — consider requiring approval for leadership-voice correspondence.`,
              seatIds: [seat.id],
              domain: "email",
            });
          }
        }
        return findings;
      },
    },
  ];
}
