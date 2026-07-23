// Reusable functional modules — seat/room/edge fragments compiled into packs.

import type { FunctionalModule } from "./types";

const room = (
  id: string,
  name: string,
  kind: "leadership" | "department" | "project" = "department",
  description = "",
): FunctionalModule["rooms"][number] => ({
  templateRoomId: id,
  name,
  kind,
  description,
  visibility: kind === "leadership" ? "restricted" : "workspace",
  humanReferenceRoles: kind === "leadership" ? ["Founder / Owner"] : undefined,
});

type SeatInput = Partial<FunctionalModule["seats"][number]> &
  Pick<
    FunctionalModule["seats"][number],
    "templateSeatId" | "roleKey" | "missionTemplate" | "responsibilities" | "successMetrics" | "authorityPolicy"
  >;

const seat = (partial: SeatInput): FunctionalModule["seats"][number] => ({
  toolIds: [],
  personalityTraits: ["Reliable", "Clear"],
  communicationStyle: "Clear and professional.",
  modelMode: "balanced",
  seniority: "specialist",
  ...partial,
});

export const MODULES: FunctionalModule[] = [
  {
    id: "executive_ops",
    name: "Executive operations",
    description: "Owner-facing coordination and priorities.",
    rooms: [room("room_leadership", "Leadership", "leadership", "Priorities and decisions.")],
    seats: [
      seat({
        templateSeatId: "ea_1",
        roleKey: "executive_assistant",
        missionTemplate: "Keep the owner’s priorities, calendar, and follow-ups organized.",
        responsibilities: ["Triage priorities", "Draft briefings", "Track owner follow-ups"],
        successMetrics: ["Fewer dropped owner commitments"],
        authorityPolicy: { calendar: "act_autonomously", email: "act_with_approval", room_scope: "act_with_approval" },
        primaryRoomTemplateId: "room_leadership",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Owner leverage",
        metric: "Dropped owner follow-ups",
        target: "Zero missed critical follow-ups per week",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "ea_1",
      },
    ],
    scalingRules: [],
  },
  {
    id: "finance_reporting",
    name: "Finance and reporting",
    description: "Books, invoices, and anomaly flags.",
    rooms: [room("room_finance", "Finance", "department", "Books, invoices, and cash hygiene.")],
    seats: [
      seat({
        templateSeatId: "finance_1",
        roleKey: "bookkeeping_assistant",
        modelMode: "cheap",
        missionTemplate: "Keep the books current — expenses, invoices, and reconciliation.",
        responsibilities: ["Categorize expenses", "Track invoices", "Flag anomalies"],
        successMetrics: ["Books current monthly"],
        authorityPolicy: { tasks: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_finance",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Financial hygiene",
        metric: "Unreconciled items",
        target: "Books reconciled every month",
        checkpointCadence: "monthly",
        ownerSeatTemplateId: "finance_1",
      },
    ],
  },
  {
    id: "customer_support",
    name: "Customer support",
    description: "Inbox triage, replies, and escalations.",
    rooms: [room("room_support", "Customer Experience", "department", "Customer conversations and issues.")],
    seats: [
      seat({
        templateSeatId: "support_1",
        roleKey: "customer_support_agent",
        missionTemplate: "Handle customer questions and issues with clear drafts and escalations.",
        responsibilities: ["Triage inbox", "Draft replies", "Classify recurring issues"],
        successMetrics: ["First-response SLA", "Escalation quality"],
        authorityPolicy: { email: "act_with_approval", tasks: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_support",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Customer response quality",
        metric: "First-response time",
        target: "Respond to priority threads within a business day",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "support_1",
      },
    ],
  },
  {
    id: "sales_pipeline",
    name: "Sales pipeline",
    description: "Outbound, qualification, and CRM hygiene.",
    rooms: [room("room_gtm", "Growth", "department", "Pipeline, campaigns, and customer acquisition.")],
    seats: [
      seat({
        templateSeatId: "sales_1",
        roleKey: "sales_development_rep",
        missionTemplate: "Build pipeline and qualify leads in the CRM.",
        responsibilities: ["Research prospects", "Draft outreach", "Qualify inbound", "Log CRM activity"],
        successMetrics: ["Qualified meetings", "CRM hygiene"],
        authorityPolicy: { crm: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_gtm",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Pipeline motion",
        metric: "Qualified meetings / week",
        target: "Steady qualified pipeline without CRM debt",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "sales_1",
      },
    ],
  },
  {
    id: "marketing_content",
    name: "Marketing and content",
    description: "Campaigns, content, and lifecycle messaging.",
    rooms: [room("room_gtm", "Growth", "department", "Pipeline, campaigns, and customer acquisition.")],
    seats: [
      seat({
        templateSeatId: "marketing_1",
        roleKey: "marketing_manager",
        missionTemplate: "Plan campaigns and content that drive demand.",
        responsibilities: ["Campaign calendar", "Draft messaging", "Track performance"],
        successMetrics: ["Campaign velocity", "Pipeline contribution"],
        authorityPolicy: { social: "act_with_approval", calendar: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_gtm",
      }),
    ],
    edges: [],
    outcomes: [],
    scalingRules: [
      {
        id: "add_content_strategist_standard",
        description: "Add a content seat when the team is standard or scaled.",
        condition: {
          or: [
            { "==": [{ var: "answers.team_size_preference" }, "standard"] },
            { "==": [{ var: "answers.team_size_preference" }, "scaled"] },
          ],
        },
        addSeats: [
          seat({
            templateSeatId: "content_1",
            roleKey: "content_strategist",
            missionTemplate: "Produce lifecycle content and campaign copy.",
            responsibilities: ["Draft emails and posts", "Maintain content calendar", "Align claims with performance data"],
            successMetrics: ["Publish cadence", "Engagement quality"],
            authorityPolicy: { social: "act_with_approval", drive: "act_autonomously", room_scope: "act_autonomously" },
            primaryRoomTemplateId: "room_gtm",
          }),
        ],
        addEdges: [
          {
            type: "review",
            fromSeatTemplateId: "marketing_1",
            toSeatTemplateId: "content_1",
            description: "Review campaign claims before publish.",
          },
        ],
      },
    ],
  },
  {
    id: "ecommerce_ops",
    name: "Ecommerce operations",
    description: "Orders, fulfilment exceptions, and suppliers.",
    rooms: [room("room_commerce", "Commerce Operations", "department", "Orders, stock, and supplier issues.")],
    seats: [
      seat({
        templateSeatId: "ecom_ops_1",
        roleKey: "operations_assistant",
        operationalVariant: "Ecommerce",
        missionTemplate: "Monitor orders, fulfilment exceptions, and supplier coordination.",
        responsibilities: ["Daily exception brief", "Supplier follow-ups", "Coordinate with support and marketing"],
        successMetrics: ["Exception clearance time", "Supplier response SLA"],
        authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_commerce",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Order reliability",
        metric: "Open fulfilment exceptions",
        target: "Clear same-day exceptions before end of day",
        checkpointCadence: "daily",
        ownerSeatTemplateId: "ecom_ops_1",
      },
    ],
  },
  {
    id: "procurement_suppliers",
    name: "Procurement and suppliers",
    description: "Vendor coordination and replenishment.",
    rooms: [room("room_commerce", "Commerce Operations", "department", "Orders, stock, and supplier issues.")],
    seats: [
      seat({
        templateSeatId: "procurement_1",
        roleKey: "operations_assistant",
        operationalVariant: "Suppliers",
        missionTemplate: "Keep supplier communication and replenishment on track.",
        responsibilities: ["Track POs", "Chase delayed shipments", "Surface stock risks"],
        successMetrics: ["On-time supplier updates"],
        authorityPolicy: { tasks: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_commerce",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "product_management",
    name: "Product management",
    description: "Specs, roadmap, and delivery alignment.",
    rooms: [
      room("room_leadership", "Leadership", "leadership", "Priorities and decisions."),
      room("room_product", "Product", "department", "Specs and delivery."),
    ],
    seats: [
      seat({
        templateSeatId: "pm_1",
        roleKey: "product_manager",
        missionTemplate: "Own product direction and keep delivery aligned.",
        responsibilities: ["Write specs", "Prioritize roadmap", "Synthesize feedback"],
        successMetrics: ["Specs on schedule", "Aligned priorities"],
        authorityPolicy: { tasks: "act_autonomously", drive: "act_autonomously", crm: "read", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_leadership",
        memberOfRoomTemplateIds: ["room_product"],
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Delivery clarity",
        metric: "Specs ready before build",
        target: "No major work starts without a clear brief",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "pm_1",
      },
    ],
  },
  {
    id: "engineering",
    name: "Engineering",
    description: "Build and ship product work.",
    rooms: [room("room_engineering", "Engineering", "department", "Build, review, and ship.")],
    seats: [
      seat({
        templateSeatId: "eng_frontend_1",
        roleKey: "software_engineer",
        operationalVariant: "Frontend",
        modelMode: "coding",
        missionTemplate: "Ship frontend product work with clear status and blockers.",
        responsibilities: ["Implement UI features", "Fix regressions", "Flag UX/tech risk"],
        successMetrics: ["Features shipped", "Low regression rate"],
        authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_engineering",
      }),
      seat({
        templateSeatId: "eng_backend_1",
        roleKey: "full_stack_developer",
        operationalVariant: "Backend",
        modelMode: "coding",
        missionTemplate: "Build and maintain backend services and APIs.",
        responsibilities: ["Implement APIs", "Fix production issues", "Document technical decisions"],
        successMetrics: ["Delivery reliability", "Incident response"],
        authorityPolicy: { tasks: "act_autonomously", drive: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_engineering",
      }),
    ],
    edges: [
      {
        type: "collaborates_with",
        fromSeatTemplateId: "eng_frontend_1",
        toSeatTemplateId: "eng_backend_1",
        description: "Coordinate on API contracts and ship readiness.",
      },
    ],
    outcomes: [],
    scalingRules: [
      {
        id: "scale_second_backend",
        description: "Add a second backend seat for scaled teams.",
        condition: { "==": [{ var: "answers.team_size_preference" }, "scaled"] },
        addSeats: [
          seat({
            templateSeatId: "eng_backend_2",
            roleKey: "full_stack_developer",
            operationalVariant: "Backend",
            modelMode: "coding",
            missionTemplate: "Absorb overflow backend work and raise delivery capacity.",
            responsibilities: ["Implement features", "Pair on incidents"],
            successMetrics: ["Throughput", "Handoff quality"],
            authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
            primaryRoomTemplateId: "room_engineering",
          }),
        ],
        addEdges: [
          {
            type: "collaborates_with",
            fromSeatTemplateId: "eng_backend_1",
            toSeatTemplateId: "eng_backend_2",
            description: "Split backend load and review each other’s work.",
          },
        ],
      },
    ],
  },
  {
    id: "quality_assurance",
    name: "Quality assurance",
    description: "Test coverage and release sign-off.",
    rooms: [room("room_engineering", "Engineering", "department", "Build, review, and ship.")],
    seats: [
      seat({
        templateSeatId: "qa_1",
        roleKey: "qa_test_engineer",
        missionTemplate: "Protect release quality with clear test coverage and sign-off.",
        responsibilities: ["Write test plans", "Regression checks", "Release sign-off"],
        successMetrics: ["Escaped defects", "Release confidence"],
        authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_engineering",
      }),
    ],
    edges: [
      {
        type: "review",
        fromSeatTemplateId: "eng_frontend_1",
        toSeatTemplateId: "qa_1",
        description: "Frontend work needs QA review before release.",
      },
      {
        type: "review",
        fromSeatTemplateId: "eng_backend_1",
        toSeatTemplateId: "qa_1",
        description: "Backend work needs QA review before release.",
      },
    ],
    outcomes: [],
  },
  {
    id: "research_intelligence",
    name: "Research and intelligence",
    description: "Market and competitive research.",
    rooms: [room("room_research", "Research", "department", "Insights and competitive intel.")],
    seats: [
      seat({
        templateSeatId: "research_1",
        roleKey: "market_research_analyst",
        missionTemplate: "Produce focused research briefs that inform decisions.",
        responsibilities: ["Competitive scans", "Customer insight summaries", "Brief leadership"],
        successMetrics: ["Actionable briefs / week"],
        authorityPolicy: { research: "act_autonomously", drive: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_research",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "client_success",
    name: "Client success",
    description: "Retention, onboarding, and account health.",
    rooms: [room("room_gtm", "Growth", "department", "Pipeline, campaigns, and customer acquisition.")],
    seats: [
      seat({
        templateSeatId: "cs_1",
        roleKey: "customer_success_manager",
        missionTemplate: "Keep customers successful and surface churn risk early.",
        responsibilities: ["Onboarding check-ins", "Health scoring", "Expansion signals"],
        successMetrics: ["Retention", "Time-to-value"],
        authorityPolicy: { crm: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_gtm",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Customer retention",
        metric: "At-risk accounts touched",
        target: "Every at-risk account gets a plan within a week",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "cs_1",
      },
    ],
  },
  {
    id: "scheduling_reservations",
    name: "Scheduling and reservations",
    description: "Bookings, covers, and schedule changes.",
    rooms: [room("room_front_of_house", "Front of House", "department", "Reservations, guests, and schedule.")],
    seats: [
      seat({
        templateSeatId: "scheduling_1",
        roleKey: "operations_assistant",
        operationalVariant: "Reservations",
        missionTemplate: "Keep reservations and scheduling accurate and guest-ready.",
        responsibilities: ["Manage bookings", "Confirm changes", "Flag double-books"],
        successMetrics: ["Booking accuracy", "No-show follow-ups"],
        authorityPolicy: { calendar: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_front_of_house",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "inventory_merchandising",
    name: "Inventory and merchandising",
    description: "Stock levels and merchandising cadence.",
    rooms: [room("room_retail", "Retail Ops", "department", "Stock, merchandising, and store ops.")],
    seats: [
      seat({
        templateSeatId: "inventory_1",
        roleKey: "operations_assistant",
        operationalVariant: "Inventory",
        missionTemplate: "Track stock levels and merchandising priorities.",
        responsibilities: ["Stock checks", "Reorder flags", "Promo readiness"],
        successMetrics: ["Stockout avoidance"],
        authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_retail",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "education_delivery",
    name: "Education delivery",
    description: "Curriculum, sessions, and learner follow-up.",
    rooms: [room("room_education", "Education", "department", "Sessions, materials, and learner progress.")],
    seats: [
      seat({
        templateSeatId: "education_1",
        roleKey: "project_manager",
        operationalVariant: "Programs",
        missionTemplate: "Coordinate learning delivery and learner follow-ups.",
        responsibilities: ["Session schedules", "Material readiness", "Learner progress notes"],
        successMetrics: ["Session on-time rate", "Learner completion"],
        authorityPolicy: { tasks: "act_autonomously", calendar: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_education",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "property_operations",
    name: "Property operations",
    description: "Listings, tenants, and maintenance coordination.",
    rooms: [room("room_property", "Property Ops", "department", "Listings, tenants, and maintenance.")],
    seats: [
      seat({
        templateSeatId: "property_1",
        roleKey: "operations_assistant",
        operationalVariant: "Property",
        missionTemplate: "Coordinate listings, tenant requests, and maintenance follow-ups.",
        responsibilities: ["Tenant request triage", "Maintenance chase", "Listing freshness"],
        successMetrics: ["Request cycle time"],
        authorityPolicy: { tasks: "act_autonomously", email: "act_with_approval", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_property",
      }),
    ],
    edges: [],
    outcomes: [],
  },
  {
    id: "general_operations",
    name: "General operations",
    description: "Day-to-day ops coordination for any business.",
    rooms: [room("room_operations", "Operations", "department", "Day-to-day coordination and admin.")],
    seats: [
      seat({
        templateSeatId: "ops_1",
        roleKey: "operations_assistant",
        modelMode: "cheap",
        missionTemplate: "Keep day-to-day operations running — vendors, schedules, and follow-ups.",
        responsibilities: ["Track operational tasks", "Coordinate vendors", "Document processes"],
        successMetrics: ["Fewer dropped tasks"],
        authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_operations",
      }),
    ],
    edges: [],
    outcomes: [
      {
        title: "Operational reliability",
        metric: "Dropped follow-ups",
        target: "Zero missed critical follow-ups per month",
        checkpointCadence: "weekly",
        ownerSeatTemplateId: "ops_1",
      },
    ],
    scalingRules: [
      {
        id: "add_automation_specialist",
        description: "Add automation when repetitive work is high.",
        condition: { "==": [{ var: "answers.needs_automation" }, "yes"] },
        addSeats: [
          seat({
            templateSeatId: "automation_1",
            roleKey: "automation_specialist",
            missionTemplate: "Automate repetitive operational workflows.",
            responsibilities: ["Map manual processes", "Propose automations", "Maintain runbooks"],
            successMetrics: ["Hours automated / month"],
            authorityPolicy: { tasks: "act_autonomously", room_scope: "act_with_approval" },
            primaryRoomTemplateId: "room_operations",
          }),
        ],
        addEdges: [
          {
            type: "collaborates_with",
            fromSeatTemplateId: "automation_1",
            toSeatTemplateId: "ops_1",
            description: "Automations must stay tied to live ops processes.",
          },
        ],
      },
      {
        id: "add_second_ops_standard",
        description: "Second ops seat for standard teams with broad focus.",
        condition: {
          and: [
            { "==": [{ var: "answers.team_size_preference" }, "standard"] },
            { "==": [{ var: "answers.primary_ops_focus" }, "all"] },
          ],
        },
        addSeats: [
          seat({
            templateSeatId: "ops_2",
            roleKey: "operations_assistant",
            operationalVariant: "Coverage",
            missionTemplate: "Absorb overflow operational work.",
            responsibilities: ["Cover ops backlog", "Document handoffs"],
            successMetrics: ["Backlog age"],
            authorityPolicy: { tasks: "act_autonomously", room_scope: "act_autonomously" },
            primaryRoomTemplateId: "room_operations",
          }),
        ],
        addEdges: [
          {
            type: "collaborates_with",
            fromSeatTemplateId: "ops_1",
            toSeatTemplateId: "ops_2",
            description: "Split operational coverage.",
          },
        ],
      },
    ],
  },
  {
    id: "performance_marketing",
    name: "Performance marketing",
    description: "Paid acquisition analysis and budget recommendations.",
    rooms: [room("room_gtm", "Growth", "department", "Pipeline, campaigns, and customer acquisition.")],
    seats: [
      seat({
        templateSeatId: "perf_marketing_1",
        roleKey: "data_analyst",
        operationalVariant: "Performance",
        missionTemplate: "Review campaign performance and recommend budget allocation.",
        responsibilities: ["Weekly acquisition reports", "Budget recommendations", "Channel diagnosis"],
        successMetrics: ["Clear weekly report", "Actionable budget notes"],
        authorityPolicy: { research: "act_autonomously", drive: "act_autonomously", room_scope: "act_autonomously" },
        primaryRoomTemplateId: "room_gtm",
      }),
    ],
    edges: [],
    outcomes: [],
  },
];

export function getModule(id: string): FunctionalModule | undefined {
  return MODULES.find((m) => m.id === id);
}

export function listModules(): FunctionalModule[] {
  return MODULES;
}
