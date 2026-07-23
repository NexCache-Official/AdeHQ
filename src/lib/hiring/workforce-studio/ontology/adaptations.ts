import type { IndustryAdaptation } from "./types";

export const ADAPTATIONS: IndustryAdaptation[] = [
  {
    id: "adapt_general",
    name: "General business",
    description: "Neutral language for mixed operations.",
    seatOverlays: [],
  },
  {
    id: "adapt_ecommerce",
    name: "Ecommerce / DTC",
    description: "Orders, returns, ads, and supplier exceptions.",
    seatOverlays: [
      {
        templateSeatId: "support_1",
        missionTemplate:
          "Handle order-status questions, returns, damaged products, and delivery escalations with approval before refunds.",
        responsibilities: [
          "Triage order and delivery tickets",
          "Draft refund/return replies for approval",
          "Flag recurring product complaints to operations",
        ],
        successMetrics: ["Refund draft quality", "Repeat-issue detection"],
        operationalVariant: "Ecommerce CX",
      },
      {
        templateSeatId: "ecom_ops_1",
        missionTemplate:
          "Monitor orders, fulfilment exceptions, and supplier issues; publish a daily exception brief.",
      },
      {
        templateSeatId: "marketing_1",
        missionTemplate: "Drive paid and lifecycle demand for the store without overclaiming inventory.",
      },
      {
        templateSeatId: "content_1",
        missionTemplate: "Draft product content, email campaigns, and promotional calendars.",
      },
    ],
    roomOverlays: [
      { templateRoomId: "room_support", name: "Customer Experience", description: "Orders, returns, and delivery issues." },
      { templateRoomId: "room_commerce", name: "Commerce Operations" },
    ],
  },
  {
    id: "adapt_restaurant",
    name: "Restaurant / hospitality",
    description: "Reservations, allergens, menus, and guest complaints.",
    seatOverlays: [
      {
        templateSeatId: "support_1",
        missionTemplate:
          "Handle reservations, allergen questions, menu enquiries, complaints, and delivery issues.",
        responsibilities: [
          "Respond to guest enquiries",
          "Flag allergen/safety issues immediately",
          "Coordinate with front-of-house on booking changes",
        ],
        operationalVariant: "Guest Experience",
      },
      {
        templateSeatId: "scheduling_1",
        missionTemplate: "Keep covers, reservations, and schedule changes accurate.",
      },
      {
        templateSeatId: "ops_1",
        missionTemplate: "Coordinate suppliers, prep planning inputs, and daily operational follow-ups.",
        operationalVariant: "Hospitality Ops",
      },
    ],
    roomOverlays: [
      { templateRoomId: "room_support", name: "Guest Experience" },
      { templateRoomId: "room_operations", name: "Kitchen & Ops" },
    ],
  },
  {
    id: "adapt_saas",
    name: "SaaS / software product",
    description: "Onboarding, product questions, bug triage, churn signals.",
    seatOverlays: [
      {
        templateSeatId: "support_1",
        roleKey: "technical_support_agent",
        missionTemplate: "Handle product questions, bug triage, and churn signals with clear engineering handoffs.",
        responsibilities: ["Triage product tickets", "Reproduce bugs", "Route churn risk to CS"],
        operationalVariant: "Product Support",
      },
      {
        templateSeatId: "cs_1",
        missionTemplate: "Drive onboarding and retention; surface expansion and churn risk.",
      },
      {
        templateSeatId: "pm_1",
        missionTemplate: "Own roadmap and specs so GTM and engineering stay aligned.",
      },
    ],
  },
  {
    id: "adapt_agency",
    name: "Agency / client delivery",
    description: "Client work, reviews, and delivery cadence.",
    seatOverlays: [
      {
        templateSeatId: "pm_1",
        roleKey: "project_manager",
        missionTemplate: "Run client delivery cadence, scope, and reviews across the studio.",
        operationalVariant: "Delivery",
      },
      {
        templateSeatId: "eng_frontend_1",
        missionTemplate: "Ship client-facing frontend work with clear review checkpoints.",
      },
      {
        templateSeatId: "support_1",
        missionTemplate: "Handle client requests and route delivery issues to the right seat.",
        operationalVariant: "Client Care",
      },
    ],
  },
  {
    id: "adapt_retail",
    name: "Physical retail",
    description: "Store ops, stock, and local customer care.",
    seatOverlays: [
      {
        templateSeatId: "support_1",
        missionTemplate: "Handle store customer questions, pickup issues, and local complaints.",
        operationalVariant: "Store CX",
      },
      {
        templateSeatId: "inventory_1",
        missionTemplate: "Keep merchandising and stock levels ready for the floor and promos.",
      },
    ],
  },
  {
    id: "adapt_professional_services",
    name: "Professional services",
    description: "Clients, proposals, delivery, and billing hygiene.",
    seatOverlays: [
      {
        templateSeatId: "ops_1",
        missionTemplate: "Coordinate client delivery admin, proposals follow-ups, and scheduling.",
        operationalVariant: "Client Ops",
      },
      {
        templateSeatId: "finance_1",
        missionTemplate: "Keep invoices, retainers, and expense categorization current.",
      },
      {
        templateSeatId: "sales_1",
        missionTemplate: "Qualify inbound client leads and keep the pipeline tidy.",
        operationalVariant: "Business Development",
      },
    ],
  },
  {
    id: "adapt_education",
    name: "Education / tutoring",
    description: "Sessions, materials, and learner follow-up.",
    seatOverlays: [
      {
        templateSeatId: "education_1",
        missionTemplate: "Coordinate sessions, materials, and learner progress follow-ups.",
      },
      {
        templateSeatId: "support_1",
        missionTemplate: "Handle parent/learner questions and scheduling changes.",
        operationalVariant: "Learner Support",
      },
    ],
  },
  {
    id: "adapt_property",
    name: "Real estate / property",
    description: "Listings, tenants, tours, and maintenance.",
    seatOverlays: [
      {
        templateSeatId: "property_1",
        missionTemplate: "Coordinate listings, tenant requests, tours, and maintenance chase-ups.",
      },
      {
        templateSeatId: "support_1",
        missionTemplate: "Respond to prospect and tenant enquiries; escalate maintenance and leasing issues.",
        operationalVariant: "Leasing & Tenant Care",
      },
      {
        templateSeatId: "sales_1",
        missionTemplate: "Qualify prospect enquiries and keep viewing pipelines moving.",
        operationalVariant: "Leasing Pipeline",
      },
    ],
  },
  {
    id: "adapt_creator",
    name: "Creator / media",
    description: "Content cadence, audience, and sponsorship ops.",
    seatOverlays: [
      {
        templateSeatId: "content_1",
        missionTemplate: "Own publishing cadence, drafts, and channel consistency.",
      },
      {
        templateSeatId: "marketing_1",
        missionTemplate: "Grow audience and sponsorship pipeline with clear performance notes.",
      },
      {
        templateSeatId: "ops_1",
        missionTemplate: "Keep production schedules, assets, and sponsor follow-ups organized.",
        operationalVariant: "Studio Ops",
      },
    ],
  },
  {
    id: "adapt_healthcare",
    name: "Healthcare / wellness",
    description: "Appointments, patient questions, and careful external communication.",
    seatOverlays: [
      {
        templateSeatId: "scheduling_1",
        missionTemplate: "Keep appointments accurate and confirm changes carefully.",
      },
      {
        templateSeatId: "support_1",
        missionTemplate: "Handle patient/client questions with care; never invent clinical advice.",
        authorityPolicy: { email: "act_with_approval", tasks: "act_with_approval", room_scope: "act_with_approval" },
        operationalVariant: "Patient Care Admin",
      },
    ],
  },
  {
    id: "adapt_trades",
    name: "Trades / home services",
    description: "Jobs, quoting, scheduling, and customer updates.",
    seatOverlays: [
      {
        templateSeatId: "ops_1",
        missionTemplate: "Coordinate jobs, parts, and day-of scheduling.",
        operationalVariant: "Field Ops",
      },
      {
        templateSeatId: "support_1",
        missionTemplate: "Update customers on jobs, quotes, and arrival windows.",
      },
      {
        templateSeatId: "sales_1",
        missionTemplate: "Qualify inbound job requests and keep the quote pipeline moving.",
      },
    ],
  },
];

export function getAdaptation(id: string): IndustryAdaptation | undefined {
  return ADAPTATIONS.find((a) => a.id === id);
}
