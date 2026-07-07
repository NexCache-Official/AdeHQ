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
  const byHeading = new Map(sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  return headings.map((heading) => {
    const existing = byHeading.get(heading.toLowerCase());
    return existing ?? { heading, body: "—" };
  });
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
