/**
 * Deterministic, token-cheap scaffolding for Drive artifacts when the model
 * under-fills sections/rows/slides. Prefer this over longer system prompts.
 */

export function firstSentence(text: string): string {
  return text.trim().split(/[.!?\n]/)[0]?.trim() || text.trim();
}

export function extractColumnList(message: string): string[] | null {
  const match = message.match(
    /columns?\s*(?:must be|=|:)?\s*([^.!\n]+?)(?:\.|$)/i,
  );
  if (!match?.[1]) return null;
  const cols = match[1]
    .split(/,|•|·|;/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0 && part.length < 48);
  return cols.length >= 2 ? cols : null;
}

export function extractRequestedCount(message: string): number | null {
  const match = message.match(
    /\b(\d+)\s+(?:realistic\s+)?(?:uk\s+)?(?:weeks?|rows?|branches?|vendors?|leads?|prospects?|slides?|items?|options?)\b/i,
  );
  if (!match) return null;
  return Math.min(20, Math.max(3, Number(match[1])));
}

/** Pull short focus phrases / bullet-like clauses from the user ask. */
export function extractFocusPoints(message: string, limit = 6): string[] {
  const points: string[] = [];
  const listed = message.match(
    /(?:sections?|include|cover|with)\s*[:=]?\s*([^.!\n]+)/i,
  );
  if (listed?.[1]) {
    for (const part of listed[1].split(/,|•|·|;|\/| and /i)) {
      const clean = part.replace(/\s+/g, " ").trim();
      if (clean.length > 2 && clean.length < 80) points.push(clean);
    }
  }
  const paren = [...message.matchAll(/\(([^)]{3,80})\)/g)].map((m) => m[1]?.trim()).filter(Boolean) as string[];
  for (const p of paren) {
    if (!points.includes(p)) points.push(p);
  }
  return points.slice(0, limit);
}

export function detectVendorCompare(message: string): boolean {
  return /\b(?:vendor|competitor|compar|vs\.?|versus|proptech|field-service|crm pricing|3 vendors|options?)\b/i.test(
    message,
  );
}

export function detectOpsBoard(message: string): boolean {
  return /\b(?:ops board|exec(?:utive)? review|capacity|sla|hiring|cost burn|incidents?)\b/i.test(
    message,
  );
}

export function detectSowOrRfp(message: string): boolean {
  return /\b(?:sow|rfp|statement of work|scope|deliverables|commercials|timeline|fees|assumptions)\b/i.test(
    message,
  );
}

const SAMPLE_TEAMS = [
  "Platform Engineering",
  "Customer Success",
  "Field Ops",
  "Support L2",
  "Billing Ops",
  "Data Platform",
  "Security",
  "Integrations",
];

const SAMPLE_OWNERS = [
  "A. Patel",
  "J. Okonkwo",
  "E. Richards",
  "D. Chen",
  "P. Sharma",
  "T. Fletcher",
  "M. Hughes",
  "S. Mitchell",
];

const SAMPLE_BRANCHES = [
  "Canary Wharf",
  "Stratford",
  "Clapham",
  "Islington",
  "Hackney",
  "Croydon",
  "Camden",
  "Greenwich",
];

function cellForColumn(column: string, index: number, message: string): string | number {
  const col = column.toLowerCase();
  if (/^week\b|week\b/.test(col)) return `W${String(index + 1).padStart(2, "0")}`;
  if (/branch/.test(col)) return SAMPLE_BRANCHES[index % SAMPLE_BRANCHES.length];
  if (/team/.test(col)) return SAMPLE_TEAMS[index % SAMPLE_TEAMS.length];
  if (/manager|owner/.test(col)) return SAMPLE_OWNERS[index % SAMPLE_OWNERS.length];
  if (/breach|ticket|p1|p2|open/.test(col)) return 4 + ((index * 3) % 11);
  if (/nps|score|fit/.test(col)) return 55 + ((index * 4) % 30);
  if (/mttr|resolution|restore|hrs|hours/.test(col)) return Number((2.5 + (index % 5) * 0.7).toFixed(1));
  if (/revenue|amount|£|mtd|burn|cost/.test(col)) return 42000 + index * 8700;
  if (/status/.test(col)) return ["On track", "Needs attention", "At risk", "Exceeding"][index % 4];
  if (/remediation|notes|next/.test(col)) {
    return [
      "Hotfix deployed; monitor 48h",
      "Add surge capacity next sprint",
      "Escalate to ops lead",
      "Process tweak reduced queue",
    ][index % 4];
  }
  if (/vendor|option|product/.test(col)) {
    return ["OptimoRoute", "ServiceTitan", "Jobber", "Housecall Pro"][index % 4];
  }
  if (/priority/.test(col)) return ["H", "M", "L"][index % 3];
  if (index === 0 && /name|title|item/.test(col)) return firstSentence(message).slice(0, 48);
  return index === 0 ? "Sample" : `Sample ${index + 1}`;
}

/** Build realistic multi-row spreadsheet content from the user ask. */
export function buildSpreadsheetRowsFromMessage(
  message: string,
  columns: string[],
  rowCount: number,
): Array<Array<string | number | boolean | null>> {
  return Array.from({ length: rowCount }, (_, index) =>
    columns.map((column) => cellForColumn(column, index, message)),
  );
}

export function buildPdfSectionsFromMessage(
  message: string,
  title: string,
  template?: string,
): Array<{ heading: string; body: string }> {
  const focus = extractFocusPoints(message);
  const summary = firstSentence(message);
  const detail = message.trim().slice(0, 700);

  if (template === "market_research_report" || detectVendorCompare(message)) {
    const vendors = ["OptimoRoute", "ServiceTitan", "Jobber"];
    return [
      {
        heading: "Methodology",
        body: `Desk comparison of three UK-relevant field-service / scheduling platforms (${vendors.join(", ")}) against the ask: "${summary}". Criteria: routing quality, mobile UX, integrations, pricing transparency, and ops fit. Assumptions marked where live product pricing was not refreshed in-session.`,
      },
      {
        heading: "Findings",
        body: [
          `${vendors[0]}: strong multi-stop routing and territory tools; best when dispatch density is high.`,
          `${vendors[1]}: deepest vertical ops suite (jobs, invoicing, reporting); heavier implementation.`,
          `${vendors[2]}: faster time-to-value for SMB field teams; lighter enterprise controls.`,
          focus.length ? `User focus points: ${focus.join("; ")}.` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        heading: "Comparison",
        body: [
          "Routing & scheduling: OptimoRoute > ServiceTitan ≈ Jobber for dense routes.",
          "Ops breadth (jobs→invoice): ServiceTitan > Jobber > OptimoRoute.",
          "Speed to roll out: Jobber > OptimoRoute > ServiceTitan.",
          "Best default for a UK ops lead piloting scheduling: start Jobber or OptimoRoute for a 4-week pilot, reserve ServiceTitan if you need full FSM suite.",
        ].join("\n"),
      },
      {
        heading: "Recommendations",
        body: [
          "1) Run a 4-week pilot with 1 branch / 8–12 techs on the lighter option that matches current stack integrations.",
          "2) Score vendors weekly on: on-time %, travel minutes saved, missed appointments, admin time.",
          "3) Only expand to full FSM suite once routing ROI is proven.",
          `Ask context retained: ${detail.slice(0, 220)}`,
        ].join("\n"),
      },
    ];
  }

  if (detectSowOrRfp(message) || template === "business_brief") {
    return [
      {
        heading: "Understanding",
        body: `We understand the engagement as: ${summary}. Success means clear scope control, weekly visibility, and low change-order friction.`,
      },
      {
        heading: "Approach",
        body: focus.length
          ? `Delivery shaped around: ${focus.join(", ")}. We will run a discovery → build → stabilize cadence with named owners and exit criteria per phase.`
          : "Phased delivery with discovery, build, UAT, and hypercare. Weekly steering, risk log, and decision register.",
      },
      {
        heading: "Timeline",
        body: "Indicative 10–12 week plan: Weeks 1–2 discovery & plan, Weeks 3–8 build/integrate, Weeks 9–10 UAT, Weeks 11–12 stabilize & handoff.",
      },
      {
        heading: "Team & commercials",
        body: "Core team: engagement lead, technical lead, analyst. Commercials assumed T&M with a not-to-exceed band pending scoping workshop; travel/expenses billed at cost.",
      },
      {
        heading: "Risks & assumptions",
        body: "Key assumptions: timely stakeholder access, stable environments, and frozen MVP scope after week 2. Risks: integration latency, data quality, and change requests mid-build.",
      },
    ];
  }

  return [
    { heading: "Summary", body: summary || title },
    {
      heading: "Briefing",
      body: detail || "Generated from the chat request with stated assumptions where detail was thin.",
    },
    {
      heading: "Recommendations",
      body: focus.length
        ? `Prioritize: ${focus.slice(0, 4).join("; ")}. Confirm owners and dates in the next ops sync.`
        : "Confirm owners, success metrics, and a 2-week checkpoint before scaling.",
    },
    {
      heading: "Next Steps",
      body: "Review in Drive, share with the decision owner, and reply with any corrections to assumptions.",
    },
  ];
}

export function buildPresentationSlidesFromMessage(
  message: string,
  title: string,
): Array<{ title: string; bullets: string[] }> {
  const focus = extractFocusPoints(message, 8);
  const summary = firstSentence(message);

  if (detectOpsBoard(message)) {
    return [
      { title, bullets: [summary, "Ops review pack — decisions needed at the end"] },
      {
        title: "Incidents & SLA",
        bullets: [
          "P1/P2 trend vs prior week",
          "Top recurring failure modes",
          "MTTR and reopen rate",
          focus.find((f) => /sla|incident/i.test(f)) ?? "Focus: stabilize top 2 breach drivers",
        ],
      },
      {
        title: "Capacity",
        bullets: [
          "Utilization by team",
          "Queue age / WIP limits",
          "Bottlenecks needing surge or process cut",
        ],
      },
      {
        title: "Vendor & hiring risk",
        bullets: [
          "Vendor SLA / dependency risk",
          "Open reqs vs critical skills",
          "Cost burn vs plan",
        ],
      },
      {
        title: "Decisions needed",
        bullets: [
          "Approve pilot / spend band",
          "Hire or reallocate capacity",
          "Accept / defer scope this week",
          "Owners + dates",
        ],
      },
    ];
  }

  const topics = focus.length
    ? focus
    : ["Context", "Options", "Recommendation", "Risks", "Next steps"];

  return [
    { title, bullets: [summary, "Prepared from your brief — edit freely in Drive"] },
    ...topics.slice(0, 4).map((topic) => ({
      title: topic.replace(/^\w/, (c) => c.toUpperCase()).slice(0, 48),
      bullets: [
        `Key point on ${topic}`,
        "Evidence / assumption called out",
        "Owner to confirm",
      ],
    })),
    {
      title: "Ask / next steps",
      bullets: ["Approve direction", "Assign owners", "Set checkpoint date"],
    },
  ].slice(0, 6);
}
