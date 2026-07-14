import type { CreateDocxArgs } from "@/lib/integrations/registry/tool-definitions";
import type { ReportSection } from "@/lib/artifacts/engine/pdf-report";

export type DocxTemplateId =
  | "business_brief"
  | "sales_outreach_brief"
  | "investor_brief"
  | "research_report";

const TEMPLATE_SECTION_HEADINGS: Record<DocxTemplateId, string[]> = {
  business_brief: ["Executive Summary", "Scope", "Approach", "Timeline", "Next Steps"],
  sales_outreach_brief: [
    "Ideal Customer Profile",
    "Outreach Sequence",
    "Objection Handling",
    "Next Actions",
  ],
  investor_brief: ["Thesis", "Target List Summary", "Outreach Plan", "Next Steps"],
  research_report: ["Methodology", "Findings", "Comparison", "Recommendations"],
};

function padSections(
  template: DocxTemplateId,
  sections: CreateDocxArgs["sections"],
): ReportSection[] {
  const headings = TEMPLATE_SECTION_HEADINGS[template];
  const matched = new Set<string>();
  const byHeading = new Map(sections.map((s) => [s.heading.trim().toLowerCase(), s]));
  const templated = headings
    .map((heading) => {
      const existing = byHeading.get(heading.toLowerCase());
      if (existing) matched.add(heading.toLowerCase());
      return existing;
    })
    .filter((section): section is ReportSection => Boolean(section));
  const extras = sections.filter((s) => !matched.has(s.heading.trim().toLowerCase()));
  return [...templated, ...extras];
}

export function applyDocxTemplate(args: CreateDocxArgs): {
  title: string;
  summary?: string;
  sections: ReportSection[];
  template?: DocxTemplateId;
} {
  const template = args.template as DocxTemplateId | undefined;
  const sections = template ? padSections(template, args.sections) : args.sections;
  return {
    title: args.title,
    summary: args.summary,
    sections,
    template,
  };
}
