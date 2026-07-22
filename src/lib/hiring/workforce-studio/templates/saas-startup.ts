// SaaS Startup template pack — a lean go-to-market + product team for an
// early-stage SaaS company: PM/founder-facing lead, engineer, marketing,
// sales/SDR, and customer success, scaling into support and a second
// engineer as the customer base grows.

import type { SimulationFinding } from "../types";
import type { TemplateManifest } from "./types";

const ROOM_LEADERSHIP = "room_leadership";
const ROOM_GTM = "room_gtm";
const ROOM_PRODUCT = "room_product";

const SEAT_PM = "pm_1";
const SEAT_ENGINEER = "eng_1";
const SEAT_MARKETING = "marketing_1";
const SEAT_SALES = "sales_1";
const SEAT_CS = "cs_1";
const SEAT_ENGINEER_2 = "eng_2";
const SEAT_SUPPORT = "support_1";

export const SAAS_STARTUP_TEMPLATE: TemplateManifest = {
  key: "saas_startup",
  version: "1.0.0",
  name: "SaaS Startup",
  description: "A lean go-to-market and product team for an early-stage SaaS company: product, engineering, marketing, sales, and customer success.",
  industry: "saas",
  intakeQuestions: [
    {
      id: "gtm_motion",
      prompt: "What's your primary go-to-market motion?",
      type: "single_select",
      options: [
        { value: "plg", label: "Product-led (self-serve)" },
        { value: "sales_led", label: "Sales-led (outbound/demos)" },
        { value: "hybrid", label: "Hybrid" },
      ],
      defaultValue: "hybrid",
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
      id: "needs_customer_support",
      prompt: "Do you need a dedicated support seat yet, or should CS cover it?",
      type: "single_select",
      options: [
        { value: "yes", label: "Dedicated support seat" },
        { value: "no", label: "CS covers it for now" },
      ],
      defaultValue: "no",
    },
  ],
  baseSeats: [
    {
      templateSeatId: SEAT_PM,
      roleKey: "product_manager",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Direct and structured — leads with the decision, then the reasoning.",
      personalityTraits: ["Decisive", "User-focused"],
      missionTemplate: "Own product direction and specs, keeping GTM and engineering aligned.",
      responsibilities: ["Write specs for upcoming work", "Prioritize the roadmap", "Synthesize customer feedback"],
      successMetrics: ["Specs ready on schedule", "Aligned priorities across GTM and engineering"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", drive: "act_autonomously", crm: "read", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_LEADERSHIP,
      memberOfRoomTemplateIds: [ROOM_PRODUCT, ROOM_GTM],
    },
    {
      templateSeatId: SEAT_ENGINEER,
      roleKey: "full_stack_developer",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Concise engineering updates with a clear status and blockers.",
      personalityTraits: ["Pragmatic", "Ships fast"],
      missionTemplate: "Build and ship the product end to end.",
      responsibilities: ["Implement features from specs", "Fix bugs and regressions", "Flag technical risk early"],
      successMetrics: ["Features shipped on schedule", "Low regression rate"],
      toolIds: [],
      authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_PRODUCT,
    },
    {
      templateSeatId: SEAT_MARKETING,
      roleKey: "marketing_manager",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Energetic, campaign-focused updates with clear next steps.",
      personalityTraits: ["Creative", "Metrics-driven"],
      missionTemplate: "Drive awareness and demand generation for the product.",
      responsibilities: ["Plan campaigns and launch calendars", "Draft messaging and positioning", "Track campaign performance"],
      successMetrics: ["Campaign velocity", "Pipeline contribution"],
      toolIds: [],
      authorityPolicy: { social: "act_with_approval", calendar: "act_autonomously", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_GTM,
    },
    {
      templateSeatId: SEAT_SALES,
      roleKey: "sales_development_rep",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Friendly, persistent, and CRM-disciplined.",
      personalityTraits: ["Persistent", "Curious"],
      missionTemplate: "Build pipeline and qualify inbound/outbound leads.",
      responsibilities: ["Research prospects and accounts", "Draft personalized outreach", "Qualify inbound leads", "Log activity in CRM"],
      successMetrics: ["Qualified meetings booked", "Clean CRM hygiene"],
      toolIds: [],
      authorityPolicy: { crm: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_GTM,
    },
    {
      templateSeatId: SEAT_CS,
      roleKey: "customer_success_manager",
      seniority: "specialist",
      modelMode: "balanced",
      communicationStyle: "Warm, proactive, and health-signal driven.",
      personalityTraits: ["Empathetic", "Proactive"],
      missionTemplate: "Drive adoption, retention, and expansion across the customer base.",
      responsibilities: ["Monitor account health and usage", "Run onboarding check-ins", "Identify expansion and risk signals"],
      successMetrics: ["Higher retention", "Faster time-to-value"],
      toolIds: [],
      authorityPolicy: { crm: "act_autonomously", room_scope: "act_autonomously" },
      primaryRoomTemplateId: ROOM_GTM,
    },
  ],
  baseRooms: [
    {
      templateRoomId: ROOM_LEADERSHIP,
      name: "Leadership",
      kind: "leadership",
      description: "Strategy, priorities, and cross-team decisions.",
      visibility: "restricted",
      humanReferenceRoles: ["Founder / CEO"],
    },
    {
      templateRoomId: ROOM_PRODUCT,
      name: "Product & Engineering",
      kind: "department",
      description: "Build and ship the product.",
      visibility: "workspace",
    },
    {
      templateRoomId: ROOM_GTM,
      name: "Go-to-Market",
      kind: "department",
      description: "Marketing, sales, and customer success.",
      visibility: "workspace",
    },
  ],
  baseEdges: [
    {
      type: "handoff",
      fromSeatTemplateId: SEAT_PM,
      toSeatTemplateId: SEAT_ENGINEER,
      description: "PM hands off approved specs before each build cycle.",
    },
    {
      type: "collaborates_with",
      fromSeatTemplateId: SEAT_MARKETING,
      toSeatTemplateId: SEAT_SALES,
      description: "Coordinate campaign timing with outbound pushes.",
    },
    {
      type: "handoff",
      fromSeatTemplateId: SEAT_SALES,
      toSeatTemplateId: SEAT_CS,
      description: "Sales hands off closed accounts for onboarding.",
    },
    {
      type: "escalation",
      fromSeatTemplateId: SEAT_CS,
      toSeatTemplateId: SEAT_ENGINEER,
      description: "Escalate confirmed product bugs affecting customer health.",
      slaHours: 24,
    },
  ],
  baseOutcomes: [
    {
      title: "Pipeline generation",
      metric: "Qualified meetings booked",
      target: "Steady week-over-week growth in qualified meetings",
      checkpointCadence: "weekly",
      ownerSeatTemplateId: SEAT_SALES,
    },
    {
      title: "Retention",
      metric: "Net revenue retention",
      target: "No preventable churn from missed health signals",
      checkpointCadence: "monthly",
      ownerSeatTemplateId: SEAT_CS,
    },
  ],
  scalingRules: [
    {
      id: "scale_second_engineer",
      description: "Scaled teams get a second engineer.",
      condition: { "==": [{ var: "answers.team_size_preference" }, "scaled"] },
      addSeats: [
        {
          templateSeatId: SEAT_ENGINEER_2,
          roleKey: "full_stack_developer",
          operationalVariant: "Second engineer",
          seniority: "specialist",
          modelMode: "balanced",
          communicationStyle: "Concise engineering updates with a clear status and blockers.",
          personalityTraits: ["Collaborative", "Detail-oriented"],
          missionTemplate: "Share build ownership with the primary engineer as scope grows.",
          responsibilities: ["Implement features from specs", "Own a distinct area of the codebase", "Pair on complex changes"],
          successMetrics: ["Features shipped on schedule", "Balanced workload across engineering"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
          primaryRoomTemplateId: ROOM_PRODUCT,
        },
      ],
      addEdges: [
        {
          type: "collaborates_with",
          fromSeatTemplateId: SEAT_ENGINEER,
          toSeatTemplateId: SEAT_ENGINEER_2,
          description: "Split ownership and pair on complex or cross-cutting changes.",
        },
      ],
    },
    {
      id: "add_dedicated_support",
      description: "Add a dedicated support seat when requested instead of routing through CS.",
      condition: { "==": [{ var: "answers.needs_customer_support" }, "yes"] },
      addSeats: [
        {
          templateSeatId: SEAT_SUPPORT,
          roleKey: "customer_support_agent",
          seniority: "specialist",
          modelMode: "cheap",
          communicationStyle: "Warm, clear, and fast — always closes the loop with the customer.",
          personalityTraits: ["Empathetic", "Responsive"],
          missionTemplate: "Triage and resolve support tickets, escalating product bugs to engineering.",
          responsibilities: ["Triage and reply to support tickets", "Document recurring issues", "Escalate product bugs with repro context"],
          successMetrics: ["Faster first response", "Higher resolution rate"],
          toolIds: [],
          authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
          primaryRoomTemplateId: ROOM_GTM,
        },
      ],
      addEdges: [
        {
          type: "escalation",
          fromSeatTemplateId: SEAT_SUPPORT,
          toSeatTemplateId: SEAT_ENGINEER,
          description: "Escalate confirmed product bugs with reproduction context.",
          slaHours: 24,
        },
        {
          type: "handoff",
          fromSeatTemplateId: SEAT_CS,
          toSeatTemplateId: SEAT_SUPPORT,
          description: "CS hands off reactive ticket volume to dedicated support.",
        },
      ],
    },
  ],
  scenarios: buildSaasScenarios(),
  firstMissionTasks: [
    {
      titleTemplate: "Draft the first GTM plan",
      descriptionTemplate: "Lay out the first 30 days of campaigns and outbound targeting for a {{gtmMotion}} motion.",
      ownerSeatTemplateId: SEAT_MARKETING,
      dueInDays: 3,
    },
    {
      titleTemplate: "Set up onboarding checklist",
      descriptionTemplate: "Create the first customer onboarding checklist so new accounts ramp consistently.",
      ownerSeatTemplateId: SEAT_CS,
      dueInDays: 3,
    },
  ],
};

function buildSaasScenarios() {
  return [
    {
      id: "saas_sales_without_crm_access",
      title: "Sales seat without CRM authority",
      category: "permission_risk" as const,
      description: "A sales/SDR seat needs at least read+act CRM authority to log activity.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const salesSeats = payload.seats.filter((s) => s.roleKey === "sales_development_rep");
        const findings: SimulationFinding[] = [];
        for (const seat of salesSeats) {
          const level = seat.authorityPolicy.crm;
          if (!level || level === "none") {
            findings.push({
              id: `saas_sales_without_crm_${seat.id}`,
              kind: "permission_missing",
              severity: "critical",
              message: `${seat.roleTitle} has no CRM authority — they cannot log outreach or pipeline activity.`,
              seatIds: [seat.id],
              domain: "crm",
            });
          }
        }
        return findings;
      },
    },
    {
      id: "saas_no_retention_owner",
      title: "No seat owns retention",
      category: "global" as const,
      description: "Someone must own the retention outcome when a CS or support seat exists.",
      check(payload: import("../types").WorkforceBlueprintPayload): SimulationFinding[] {
        const hasCsOrSupport = payload.seats.some((s) => s.roleKey === "customer_success_manager" || s.roleKey === "customer_support_agent");
        if (!hasCsOrSupport) return [];
        const hasOwner = payload.outcomes.some((o) => o.ownerSeatId);
        if (hasOwner) return [];
        return [
          {
            id: "saas_no_retention_owner",
            kind: "coverage_gap",
            severity: "warning",
            message: "No outcome has an assigned owner seat — retention risk signals may fall through the cracks.",
          },
        ];
      },
    },
  ];
}
