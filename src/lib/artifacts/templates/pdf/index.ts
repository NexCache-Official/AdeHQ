import type { CreatePdfReportArgs } from "@/lib/integrations/registry/tool-definitions";
import type { PdfReportSpec, ReportSection } from "@/lib/artifacts/engine/pdf-report";

export type PdfTemplateId =
  | "campaign_brief"
  | "investor_brief"
  | "market_research_report"
  | "sales_outreach_brief";

const TEMPLATE_SECTION_HEADINGS: Record<PdfTemplateId, string[]> = {
  campaign_brief: [
    "Executive Summary",
    "Audience",
    "Messaging",
    "Timeline",
    "Call to Action",
  ],
  investor_brief: ["Thesis", "Target List Summary", "Outreach Plan", "Next Steps"],
  market_research_report: ["Methodology", "Findings", "Comparison", "Recommendations"],
  sales_outreach_brief: ["Ideal Customer Profile", "Outreach Sequence", "Objection Handling", "Next Actions"],
};

function padSections(
  template: PdfTemplateId,
  sections: CreatePdfReportArgs["sections"],
): ReportSection[] {
  const headings = TEMPLATE_SECTION_HEADINGS[template];
  const matched = new Set<string>();
  const byHeading = new Map(sections.map((s) => [s.heading.trim().toLowerCase(), s]));

  // Fill every required heading the model actually wrote content for, in the
  // template's canonical order. A heading the model skipped is dropped
  // entirely rather than rendered as an empty "—" placeholder — a document
  // with 3 solid sections reads far better than one with 4 sections where
  // one is visibly blank.
  const templated = headings
    .map((heading) => {
      const existing = byHeading.get(heading.toLowerCase());
      if (existing) matched.add(heading.toLowerCase());
      return existing;
    })
    .filter((section): section is ReportSection => Boolean(section));

  // Anything the model wrote that didn't match a template heading is still
  // real content — keep it instead of silently discarding it.
  const extras = sections.filter((s) => !matched.has(s.heading.trim().toLowerCase()));

  return [...templated, ...extras];
}

/** Expand PDF args with template section scaffolding when needed. */
export function applyPdfTemplate(args: CreatePdfReportArgs): PdfReportSpec {
  const sections = args.template ? padSections(args.template, args.sections) : args.sections;
  return {
    title: args.title,
    summary: args.summary,
    sections,
  };
}
