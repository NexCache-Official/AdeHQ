// PR-22A — turn a free-text business description into a structured
// BusinessOperatingDiagnosis via generateObject (strong tier).

import { generateObject } from "ai";
import { z } from "zod";
import { getTimeoutMs, resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import type { BusinessOperatingDiagnosis, OperatingModel } from "./diagnosis-types";
import { enrichClarificationQuestions } from "./clarification-ui";

export { clarificationNeedsFreeText } from "./clarification-ui";

const MODEL_MODE = "strong" as const;
const TIMEOUT_MS = getTimeoutMs("strong");

const clarificationQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  whyItMatters: z.string(),
  options: z
    .array(z.object({ id: z.string(), label: z.string() }))
    .min(2)
    .max(5),
  allowFreeText: z
    .boolean()
    .optional()
    .describe(
      "Set true whenever an option needs the user to specify details (Mix, Other, Specify, Custom, etc.).",
    ),
});

const diagnosisSchema = z.object({
  businessType: z.string().describe("Short label, e.g. 'DTC Shopify brand' or 'Accounting firm'"),
  industry: z.string(),
  operatingModel: z
    .enum([
      "service",
      "commerce",
      "software",
      "marketplace",
      "hospitality",
      "professional_services",
      "education",
      "nonprofit",
      "other",
    ])
    .describe(
      "Use professional_services for accounting, legal, consulting, tax, and advisory firms — not generic service.",
    ),
  narrative: z
    .string()
    .describe("2–4 sentences Maya would say aloud: how she understands the business."),
  revenueMotion: z.array(z.string()).max(6),
  customerTypes: z.array(z.string()).max(6),
  productsAndServices: z.array(z.string()).max(8),
  operatingChannels: z.array(z.string()).max(8),
  recurringWork: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        frequency: z.enum(["daily", "weekly", "monthly", "ad_hoc"]),
        ownerHint: z.string().optional(),
      }),
    )
    .max(8),
  currentHumanRoles: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        responsibilities: z.array(z.string()).max(6),
      }),
    )
    .max(8),
  bottlenecks: z
    .array(
      z.object({
        id: z.string(),
        area: z.string(),
        description: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(6),
  risks: z
    .array(
      z.object({
        id: z.string(),
        area: z.string(),
        description: z.string(),
        mitigationHint: z.string().optional(),
      }),
    )
    .max(6),
  growthPriorities: z
    .array(z.object({ id: z.string(), title: z.string(), why: z.string() }))
    .max(5),
  proposedDepartments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        purpose: z.string(),
        suggestedRoleTitles: z.array(z.string()).max(6),
      }),
    )
    .max(6),
  confidence: z.number().min(0).max(1),
  assumptions: z
    .array(z.object({ id: z.string(), statement: z.string(), impact: z.string() }))
    .max(6),
  clarificationQuestions: z.array(clarificationQuestionSchema).min(1).max(5),
  designReasons: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe("Short reasons for the eventual team design."),
});

/**
 * Post-process LLM/heuristic diagnoses so professional firms are never left as
 * generic `service` (which previously routed them into software_house).
 */
export function normalizeDiagnosis(
  diagnosis: BusinessOperatingDiagnosis,
  sourceDescription = "",
): BusinessOperatingDiagnosis {
  const blob = [
    sourceDescription,
    diagnosis.businessType,
    diagnosis.industry,
    diagnosis.narrative,
    ...diagnosis.productsAndServices,
  ]
    .join(" ")
    .toLowerCase();

  let operatingModel: OperatingModel = diagnosis.operatingModel;
  let businessType = diagnosis.businessType;
  let industry = diagnosis.industry;

  if (/\b(accounting|bookkeeping|tax firm|tax prep|cpa)\b/.test(blob)) {
    operatingModel = "professional_services";
    if (!/account/i.test(businessType)) businessType = "Accounting firm";
    if (!/account|tax|book/i.test(industry)) industry = "accounting";
  } else if (/\b(law firm|legal services|lawyer)\b/.test(blob)) {
    operatingModel = "professional_services";
    if (!/legal|law/i.test(businessType)) businessType = "Legal services";
    if (!/legal|law/i.test(industry)) industry = "legal";
  } else if (/\b(consultan|advisory|professional services)\b/.test(blob)) {
    operatingModel = "professional_services";
    if (!/consult|advisor|professional/i.test(businessType)) {
      businessType = "Consultancy";
    }
    if (!/consult|advisor|professional/i.test(industry)) industry = "consulting";
  }

  return {
    ...diagnosis,
    businessType,
    industry,
    operatingModel,
    clarificationQuestions: enrichClarificationQuestions(diagnosis.clarificationQuestions),
  };
}

/** Offline-safe diagnosis used when SiliconFlow is unavailable and for golden evals. */
export function diagnoseBusinessHeuristic(description: string): BusinessOperatingDiagnosis {
  const text = description.trim();
  const lower = text.toLowerCase();
  let operatingModel: BusinessOperatingDiagnosis["operatingModel"] = "other";
  let businessType = "Independent business";
  let industry = "General";
  if (/\b(shopify|ecommerce|e-commerce|dtc)\b/.test(lower) || /\border(s)?\b/.test(lower) && /\b(store|sku|fulfil)/.test(lower)) {
    operatingModel = "commerce";
    businessType = /\bshopify\b/.test(lower) ? "Shopify store" : "Ecommerce brand";
    industry = "ecommerce";
  } else if (/\b(retail store|convenience store|brick and mortar|shop floor)\b/.test(lower) || /\bconvenience stores\b/.test(lower)) {
    operatingModel = "commerce";
    businessType = "Physical retail";
    industry = "retail";
  } else if (/\b(wholesale|distribution|warehouse)\b/.test(lower)) {
    operatingModel = "commerce";
    businessType = "Wholesale / distribution";
    industry = "logistics";
  } else if (/\b(restaurant|café|cafe|bakery|hotel|guesthouse|hospitality)\b/.test(lower)) {
    operatingModel = "hospitality";
    businessType = /\brestaurant\b/.test(lower) ? "Restaurant" : "Hospitality business";
    industry = "hospitality";
  } else if (/\b(salon|gym|fitness|clinic|wellness|dental)\b/.test(lower)) {
    operatingModel = "service";
    businessType = "Wellness practice";
    industry = "wellness";
  } else if (/\b(saas|subscription software|b2b software|product-led)\b/.test(lower)) {
    operatingModel = "software";
    businessType = "SaaS product";
    industry = "saas";
  } else if (
    /\b(software agency|software house|dev shop|development studio|development agency|msp|managed service)\b/.test(
      lower,
    )
  ) {
    operatingModel = "service";
    businessType = "Software agency";
    industry = "software";
  } else if (/\b(accountant|accounting|bookkeeping firm)\b/.test(lower)) {
    operatingModel = "professional_services";
    businessType = "Accounting firm";
    industry = "accounting";
  } else if (/\b(lawyer|legal|law firm)\b/.test(lower)) {
    operatingModel = "professional_services";
    businessType = "Legal services";
    industry = "legal";
  } else if (/\b(consultan|advisory)\b/.test(lower)) {
    operatingModel = "professional_services";
    businessType = "Consultancy";
    industry = "consulting";
  } else if (
    /\b(real estate|property management|property manager|vacation.?rental|short.?term rental|airbnb|leasing|tenant|listings)\b/.test(
      lower,
    )
  ) {
    operatingModel = "service";
    businessType = /\b(vacation|short.?term|airbnb)\b/.test(lower)
      ? "Vacation rental business"
      : "Property business";
    industry = "real_estate";
  } else if (/\b(tutoring|tutor|course|school|training|student)\b/.test(lower)) {
    operatingModel = "education";
    businessType = "Education business";
    industry = "education";
  } else if (/\b(youtube|creator|newsletter|podcast)\b/.test(lower)) {
    operatingModel = "other";
    businessType = "Creator / media";
    industry = "media";
  } else if (/\b(plumber|electrician|hvac|home services|trades)\b/.test(lower)) {
    operatingModel = "service";
    businessType = "Home services";
    industry = "trades";
  } else if (/\b(it support|msp|managed service)\b/.test(lower)) {
    operatingModel = "service";
    businessType = "IT support provider";
    industry = "it_services";
  } else if (/\b(sales department|outbound pipeline|\bsdr\b)\b/.test(lower)) {
    operatingModel = "other";
    businessType = "Sales-focused team";
    industry = "sales";
  } else if (/\b(customer support department|support department|support inbox)\b/.test(lower)) {
    operatingModel = "other";
    businessType = "Support-focused team";
    industry = "support";
  } else if (/\b(nonprofit|charity|community organization|foundation)\b/.test(lower)) {
    operatingModel = "nonprofit";
    businessType = "Nonprofit";
    industry = "nonprofit";
  } else if (/\b(multi-location retail|retail fashion|shop floor)\b/.test(lower)) {
    operatingModel = "commerce";
    businessType = "Physical retail";
    industry = "retail";
  } else if (/\b(software|app|platform|api)\b/.test(lower)) {
    operatingModel = "software";
    businessType = "Software company";
    industry = "software";
  }

  const raw: BusinessOperatingDiagnosis = {
    businessType,
    industry,
    operatingModel,
    narrative:
      "You're running a hands-on business where the founder still covers several recurring workloads. I can design a lean AI team around the highest-friction areas once I confirm a few operating details.",
    revenueMotion: [],
    customerTypes: [],
    productsAndServices: [],
    operatingChannels: [],
    recurringWork: [
      {
        id: "rw_ops",
        name: "Day-to-day operations",
        description: "Coordination, follow-ups, and status work the founder currently owns.",
        frequency: "daily",
      },
    ],
    currentHumanRoles: [
      {
        id: "human_founder",
        title: "Founder / owner",
        responsibilities: ["Operations", "Customer work", "Growth"],
      },
    ],
    bottlenecks: [
      {
        id: "bn_bandwidth",
        area: "Founder bandwidth",
        description: "Too many recurring tasks sit with one person.",
        severity: "high",
      },
    ],
    risks: [],
    growthPriorities: [
      {
        id: "gp_capacity",
        title: "Create capacity without hiring a large human team",
        why: "Stated need to grow without adding five people.",
      },
    ],
    proposedDepartments: [
      {
        id: "dept_ops",
        name: "Operations",
        purpose: "Keep recurring work moving with clear owner approvals.",
        suggestedRoleTitles: ["Operations Manager", "Executive Assistant"],
      },
    ],
    confidence: 0.45,
    assumptions: [
      {
        id: "as_owner_approvals",
        statement: "The owner wants approval on high-risk external actions.",
        impact: "Authority policies stay guided rather than fully autonomous.",
      },
    ],
    clarificationQuestions: [
      {
        id: "q_biggest_pain",
        prompt: "Which area creates the most disruption for you each week?",
        whyItMatters: "This decides whether the first AI seats lean support, growth, or ops.",
        options: [
          { id: "support", label: "Customer support / inbox" },
          { id: "growth", label: "Marketing / acquisition" },
          { id: "ops", label: "Operations / suppliers / admin" },
          { id: "mixed", label: "All of the above equally" },
        ],
      },
      {
        id: "q_team_size",
        prompt: "How lean should the first AI team be?",
        whyItMatters: "Sets seat count and weekly Work Hours expectations.",
        options: [
          { id: "lean", label: "Lean (3–4 people)" },
          { id: "standard", label: "Standard (5–7 people)" },
          { id: "scaled", label: "Ambitious (8+ people)" },
        ],
      },
    ],
    designReasons: [
      "Cover the founder's highest recurring workloads first.",
      "Keep refunds, outbound email, and publishing under owner approval.",
      "Leave room to grow the team as volume increases.",
    ],
  };
  return normalizeDiagnosis(raw, text);
}

export async function diagnoseBusiness(input: {
  description: string;
  websiteSnippet?: string | null;
}): Promise<BusinessOperatingDiagnosis> {
  const description = input.description.trim();
  if (!description) {
    throw new Error("Describe your business so Maya can design a workforce.");
  }

  if (!isSiliconFlowConfigured()) {
    return diagnoseBusinessHeuristic(description);
  }

  try {
    const modelId = resolveModel("siliconflow", MODEL_MODE);
    const { object } = await generateObject({
      model: siliconFlowChatModel(modelId),
      schema: diagnosisSchema,
      system: [
        "You are Maya, AdeHQ's workforce architect.",
        "Diagnose how this business operates from the founder's description.",
        "Be specific to their industry — never force a SaaS framing onto a restaurant, shop, or professional firm.",
        "Accounting, legal, tax, bookkeeping, and consulting firms use operatingModel professional_services — never generic service.",
        "When an answer option is Mix / Other / Specify / Custom, set allowFreeText true so the founder can type details.",
        "Ask only high-information clarification questions (2–5).",
        "confidence is 0–1; leave room to ask when uncertain.",
        "designReasons should be concrete and non-generic.",
      ].join(" "),
      prompt: [
        `Business description:\n${description}`,
        input.websiteSnippet?.trim()
          ? `Website excerpt (best-effort):\n${input.websiteSnippet.trim().slice(0, 4000)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      providerOptions: siliconFlowProviderOptions(modelId),
    });
    return normalizeDiagnosis(object as BusinessOperatingDiagnosis, description);
  } catch (error) {
    console.warn("[AdeHQ workforce-studio] diagnoseBusiness failed", error);
    return diagnoseBusinessHeuristic(description);
  }
}

/** Best-effort website text for diagnosis context. Never throws to the caller. */
export async function fetchWebsiteSnippet(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;

  try {
    const response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": "AdeHQ-WorkforceArchitect/1.0" },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text") && !contentType.includes("html")) return null;
    const html = (await response.text()).slice(0, 80_000);
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4_000);
  } catch {
    return null;
  }
}
