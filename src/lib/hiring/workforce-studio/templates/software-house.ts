// Software House template pack — a product engineering team: PM, frontend +
// backend engineers, QA, with DevOps/architecture/support seats that scale
// in based on intake answers.

import type { SimulationFinding } from "../types";
import type { TemplateManifest } from "./types";

const ROOM_LEADERSHIP = "room_leadership";
const ROOM_ENGINEERING = "room_engineering";
const ROOM_SUPPORT = "room_support";

const SEAT_PM = "pm_1";
const SEAT_FRONTEND = "eng_frontend_1";
const SEAT_BACKEND = "eng_backend_1";
const SEAT_QA = "qa_1";
const SEAT_BACKEND_2 = "eng_backend_2";
const SEAT_DEVOPS = "devops_1";
const SEAT_ARCHITECT = "architect_1";
const SEAT_SUPPORT = "support_1";

export const SOFTWARE_HOUSE_TEMPLATE: TemplateManifest = {
  key: "software_house",
  version: "1.0.0",
  name: "Software House",
  description:
    "A product engineering team that ships and supports a software product: PM, frontend + backend engineers, and QA, scaling into DevOps, architecture, and support as you grow.",
  industry: "software",
  intakeQuestions: [
    {
      id: "product_type",
      prompt: "What are you building?",
      type: "single_select",
      options: [
        { value: "web_app", label: "Web app" },
        { value: "mobile_app", label: "Mobile app" },
        { value: "api_platform", label: "API / developer platform" },
        { value: "internal_tool", label: "Internal tool" },
      ],
      defaultValue: "web_app",
    },
    {
      id: "release_cadence",
      prompt: "How often do you want to ship?",
      type: "single_select",
      options: [
        { value: "weekly", label: "Weekly or faster" },
        { value: "biweekly", label: "Every 2 weeks" },
        { value: "monthly", label: "Monthly" },
      ],
      defaultValue: "biweekly",
    },
    {
      id: "team_size_preference",
      prompt: "How big should this team start?",
      type: "single_select",
      options: [
        { value: "lean", label: "Lean (3-4 seats)" },
        { value: "standard", label: "Standard (5-7 seats)" },
        { value: "scaled", label: "Scaled (8+ seats)" },
      ],
      defaultValue: "standard",
    },
    {
      id: "needs_dedicated_devops",
      prompt: "Do you need dedicated deployment/infra ownership?",
      type: "single_select",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "Not yet" },
      ],
      defaultValue: "no",
    },
    {
      id: "needs_customer_support",
      prompt: "Will this team handle customer support directly?",
      type: "single_select",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No — support lives elsewhere" },
      ],
      defaultValue: "no",
    },
    {
      id: "expected_monthly_tickets",
      prompt: "Roughly how many support tickets per month?",
      type: "number",
      defaultValue: 0,
      appliesWhen: { "==": [{ var: "needs_customer_support" }, "yes"] },
    },
  ],
  baseSeats: [
    {
      templateSeatId: SEAT_PM,
      roleKey: "product_manager",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Direct and structured — leads with the decision, then the reasoning.",
      personalityTraits: ["Decisive", "User-focused", "Organized"],
      missionTemplate:
        "Own the roadmap and specs for {{productType}}, keeping engineering and QA aligned on scope and priorities.",
      responsibilities: [
        "Write PRDs and specs for upcoming work",
        "Prioritize the roadmap against shipping cadence",
        "Synthesize feedback into clear requirements",
        "Align engineering and QA on scope before each cycle",
      ],
      successMetrics: ["Specs ready before each cycle starts", "Aligned priorities across the team", "Fewer scope changes mid-cycle"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", drive: "act_autonomously", crm: "read", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_LEADERSHIP,
      memberOfRoomTemplateIds: [ROOM_ENGINEERING],
    },
    {
      templateSeatId: SEAT_FRONTEND,
      roleKey: "full_stack_developer",
      operationalVariant: "Frontend",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Concise engineering updates with a clear status and blockers.",
      personalityTraits: ["Detail-oriented", "Pragmatic"],
      missionTemplate: "Build and ship the frontend for {{productType}}, translating specs into working UI.",
      responsibilities: [
        "Implement UI from specs and designs",
        "Integrate with backend APIs",
        "Fix frontend bugs and regressions",
        "Flag technical risk to the PM early",
      ],
      successMetrics: ["Features shipped on schedule", "Low regression rate", "Clear handoff notes"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_ENGINEERING,
      memberOfRoomTemplateIds: [],
    },
    {
      templateSeatId: SEAT_BACKEND,
      roleKey: "full_stack_developer",
      operationalVariant: "Backend",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Concise engineering updates with a clear status and blockers.",
      personalityTraits: ["Systematic", "Reliability-minded"],
      missionTemplate: "Build and ship the backend/services for {{productType}}, owning data and API design.",
      responsibilities: [
        "Design and implement APIs and data models",
        "Own service reliability and performance",
        "Review integration points with frontend",
        "Document technical decisions",
      ],
      successMetrics: ["Features shipped on schedule", "Stable service uptime", "Clear API documentation"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_ENGINEERING,
      memberOfRoomTemplateIds: [],
    },
    {
      templateSeatId: SEAT_QA,
      roleKey: "qa_test_engineer",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Clear, evidence-based bug reports with reproduction steps.",
      personalityTraits: ["Meticulous", "Skeptical of happy paths"],
      missionTemplate: "Protect release quality for {{productType}} across every {{releaseCadence}} cycle.",
      responsibilities: [
        "Write and run test plans for new features",
        "Document bugs with clear repro steps",
        "Maintain the regression checklist",
        "Sign off before release",
      ],
      successMetrics: ["Critical bugs caught pre-release", "Regression coverage improved", "Clean release sign-offs"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_ENGINEERING,
      memberOfRoomTemplateIds: [],
    },
  ],
  baseRooms: [
    {
      templateRoomId: ROOM_LEADERSHIP,
      name: "Product Leadership",
      kind: "leadership",
      description: "Roadmap, priorities, and cross-team decisions.",
      visibility: "restricted",
      humanReferenceRoles: ["Founder / CEO"],
    },
    {
      templateRoomId: ROOM_ENGINEERING,
      name: "Product & Engineering",
      kind: "department",
      description: "Day-to-day build, QA, and shipping work.",
      visibility: "workspace",
    },
  ],
  baseEdges: [
    {
      type: "handoff",
      fromSeatTemplateId: SEAT_PM,
      toSeatTemplateId: SEAT_FRONTEND,
      description: "PM hands off approved specs before each cycle starts.",
    },
    {
      type: "handoff",
      fromSeatTemplateId: SEAT_PM,
      toSeatTemplateId: SEAT_BACKEND,
      description: "PM hands off approved specs before each cycle starts.",
    },
    {
      type: "review",
      fromSeatTemplateId: SEAT_FRONTEND,
      toSeatTemplateId: SEAT_QA,
      description: "QA reviews and signs off before release.",
      slaHours: 24,
    },
    {
      type: "review",
      fromSeatTemplateId: SEAT_BACKEND,
      toSeatTemplateId: SEAT_QA,
      description: "QA reviews and signs off before release.",
      slaHours: 24,
    },
    {
      type: "collaborates_with",
      fromSeatTemplateId: SEAT_FRONTEND,
      toSeatTemplateId: SEAT_BACKEND,
      description: "Coordinate on API contracts and integration points.",
    },
  ],
  baseOutcomes: [
    {
      title: "Ship on cadence",
      metric: "Features shipped per cycle",
      target: "At least 1 meaningful release per cycle with no rollback",
      checkpointCadence: "biweekly",
      ownerSeatTemplateId: SEAT_PM,
    },
    {
      title: "Release quality",
      metric: "Critical bugs escaping to production",
      target: "Zero critical bugs escaping per release",
      checkpointCadence: "biweekly",
      ownerSeatTemplateId: SEAT_QA,
    },
  ],
  scalingRules: [
    {
      id: "scale_second_backend_for_scaled_team",
      description: "Standard/scaled teams get a second backend engineer for API + integration coverage.",
      condition: { "==": [{ var: "answers.team_size_preference" }, "scaled"] },
      addSeats: [
        {
          templateSeatId: SEAT_BACKEND_2,
          roleKey: "full_stack_developer",
          operationalVariant: "Backend — integrations",
          seniority: "specialist",
          modelMode: "balanced",
          communicationStyle: "Concise engineering updates with a clear status and blockers.",
          personalityTraits: ["Collaborative", "Integration-minded"],
          missionTemplate: "Own third-party integrations and secondary services for {{productType}}.",
          responsibilities: [
            "Build and maintain third-party integrations",
            "Support the primary backend engineer on shared services",
            "Own integration incident response",
          ],
          successMetrics: ["Stable integrations", "Fast incident response"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
          primaryRoomTemplateId: ROOM_ENGINEERING,
        },
      ],
      addEdges: [
        {
          type: "collaborates_with",
          fromSeatTemplateId: SEAT_BACKEND,
          toSeatTemplateId: SEAT_BACKEND_2,
          description: "Split ownership of core services vs. integrations; sync on shared data models.",
        },
      ],
    },
    {
      id: "add_devops_when_requested",
      description: "Add a DevOps seat when the intake says infra ownership is needed.",
      condition: { "==": [{ var: "answers.needs_dedicated_devops" }, "yes"] },
      addSeats: [
        {
          templateSeatId: SEAT_DEVOPS,
          roleKey: "devops_engineer",
          seniority: "specialist",
          modelMode: "balanced",
          communicationStyle: "Calm, precise incident and deployment updates.",
          personalityTraits: ["Careful", "Process-driven"],
          missionTemplate: "Own deployments, infra, and reliability for {{productType}}.",
          responsibilities: [
            "Maintain CI/CD pipelines",
            "Monitor production health",
            "Document runbooks and deployments",
          ],
          successMetrics: ["Faster, safer deploys", "Reduced downtime", "Clear runbooks"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_with_approval" },
          primaryRoomTemplateId: ROOM_ENGINEERING,
        },
      ],
      addEdges: [
        {
          type: "handoff",
          fromSeatTemplateId: SEAT_BACKEND,
          toSeatTemplateId: SEAT_DEVOPS,
          description: "Backend hands off release-ready builds for deployment.",
        },
      ],
    },
    {
      id: "add_architect_for_scaled_team",
      description: "Scaled teams get a Solutions Architect for cross-cutting technical decisions.",
      condition: { "==": [{ var: "answers.team_size_preference" }, "scaled"] },
      addSeats: [
        {
          templateSeatId: SEAT_ARCHITECT,
          roleKey: "solutions_architect",
          seniority: "advisor",
          modelMode: "strong",
          communicationStyle: "Structured technical write-ups with clear tradeoffs.",
          personalityTraits: ["Analytical", "Big-picture"],
          missionTemplate: "Guide architecture and technical tradeoffs across {{productType}} as the team scales.",
          responsibilities: [
            "Draft architecture recommendations",
            "Review technical risk on major changes",
            "Support cross-team technical alignment",
          ],
          successMetrics: ["Clear architecture docs", "Fewer rework cycles on technical decisions"],
          toolIds: [],
          authorityPolicy: { tasks: "act_with_approval", room_scope: "read" },
          primaryRoomTemplateId: ROOM_ENGINEERING,
          memberOfRoomTemplateIds: [ROOM_LEADERSHIP],
        },
      ],
    },
    {
      id: "add_support_when_requested",
      description: "Add a support seat when this team owns customer support directly.",
      condition: { "==": [{ var: "answers.needs_customer_support" }, "yes"] },
      addSeats: [
        {
          templateSeatId: SEAT_SUPPORT,
          roleKey: "customer_support_agent",
          seniority: "specialist",
          modelMode: "cheap",
          communicationStyle: "Warm, clear, and fast — always closes the loop with the customer.",
          personalityTraits: ["Empathetic", "Responsive"],
          missionTemplate: "Triage and resolve support tickets for {{productType}}, escalating product bugs to engineering.",
          responsibilities: [
            "Triage and reply to support tickets",
            "Document recurring issues",
            "Escalate product bugs with repro context",
          ],
          successMetrics: ["Faster first response", "Higher resolution rate"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
          primaryRoomTemplateId: ROOM_SUPPORT,
        },
      ],
      addRooms: [
        {
          templateRoomId: ROOM_SUPPORT,
          name: "Customer Support",
          kind: "department",
          description: "Ticket triage, escalations, and customer-facing communication.",
          visibility: "workspace",
        },
      ],
      addEdges: [
        {
          type: "escalation",
          fromSeatTemplateId: SEAT_SUPPORT,
          toSeatTemplateId: SEAT_BACKEND,
          description: "Escalate confirmed product bugs with reproduction context.",
          slaHours: 24,
        },
      ],
    },
  ],
  scenarios: buildSoftwareHouseScenarios(),
  firstMissionTasks: [
    {
      titleTemplate: "Draft the first cycle plan",
      descriptionTemplate: "Turn the current priorities into a scoped plan for the first {{releaseCadence}} cycle.",
      ownerSeatTemplateId: SEAT_PM,
      dueInDays: 2,
    },
    {
      titleTemplate: "Set up the regression checklist",
      descriptionTemplate: "Create the initial regression checklist for {{productType}} so releases have a repeatable QA pass.",
      ownerSeatTemplateId: SEAT_QA,
      dueInDays: 3,
    },
  ],
};

function buildSoftwareHouseScenarios() {
  return [
    {
      id: "sh_release_without_qa_signoff",
      title: "Release without a QA sign-off path",
      category: "global" as const,
      description: "Every seat that ships code should have a review/QA edge before release.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const engineerSeats = payload.seats.filter((s) => s.roleKey === "full_stack_developer" || s.roleKey === "software_engineer");
        const hasQa = payload.seats.some((s) => s.roleKey === "qa_test_engineer");
        if (engineerSeats.length === 0 || hasQa) return [];
        return [
          {
            id: "sh_release_without_qa_signoff",
            kind: "coverage_gap",
            severity: "warning",
            message: "Engineers can ship without any QA sign-off — add a QA seat or a peer-review edge before go-live.",
            seatIds: engineerSeats.map((s) => s.id),
          },
        ];
      },
    },
    {
      id: "sh_support_without_escalation",
      title: "Support seat with no escalation path",
      category: "permission_risk" as const,
      description: "A support seat must have an escalation edge to engineering.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const support = payload.seats.filter((s) => s.roleKey === "customer_support_agent");
        if (support.length === 0) return [];
        const findings: SimulationFinding[] = [];
        for (const seat of support) {
          const hasEscalation = payload.edges.some((e) => e.type === "escalation" && e.fromSeatId === seat.id);
          if (!hasEscalation) {
            findings.push({
              id: `sh_support_without_escalation_${seat.id}`,
              kind: "structural",
              severity: "critical",
              message: `${seat.roleTitle} has no escalation edge to engineering — confirmed bugs will have nowhere to go.`,
              seatIds: [seat.id],
            });
          }
        }
        return findings;
      },
    },
  ];
}
