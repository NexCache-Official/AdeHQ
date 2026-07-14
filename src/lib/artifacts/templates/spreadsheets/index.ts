import type { CreateSpreadsheetArgs } from "@/lib/integrations/registry/tool-definitions";
import type { EnhancedSpreadsheetSpec } from "@/lib/artifacts/engine/spreadsheet-enhanced";

export type SpreadsheetTemplateId =
  | "sales_pipeline"
  | "investor_target"
  | "content_calendar"
  | "market_research"
  | "lead_list";

const TEMPLATE_DEFAULTS: Record<
  SpreadsheetTemplateId,
  { sheetName: string; columns: string[] }
> = {
  sales_pipeline: {
    sheetName: "Pipeline",
    columns: ["Company", "Contact", "Stage", "Amount", "Currency", "Expected Close", "Notes"],
  },
  investor_target: {
    sheetName: "Targets",
    columns: ["Firm", "Contact", "Stage", "Fit Score", "Target Amount", "Currency", "Next Follow-up", "Notes"],
  },
  content_calendar: {
    sheetName: "Calendar",
    columns: ["Title", "Platform", "Status", "Scheduled At", "Campaign", "Body Preview"],
  },
  market_research: {
    sheetName: "Comparison",
    columns: ["Option", "Category", "Strengths", "Weaknesses", "Price", "Source", "Notes"],
  },
  lead_list: {
    sheetName: "Leads",
    columns: [
      "Company",
      "Contact",
      "Role",
      "Email",
      "Phone",
      "Website",
      "Location",
      "Segment",
      "Source URL",
      "Fit",
      "Notes",
    ],
  },
};

/** Apply template defaults and sheet naming when a template is selected. */
export function applySpreadsheetTemplate(
  args: CreateSpreadsheetArgs,
): Pick<EnhancedSpreadsheetSpec, "sheetName" | "columns" | "rows"> & { template?: SpreadsheetTemplateId } {
  if (!args.template) {
    return {
      sheetName: args.sheetName,
      columns: args.columns,
      rows: args.rows,
    };
  }

  const defaults = TEMPLATE_DEFAULTS[args.template];
  const columns =
    args.columns.length >= defaults.columns.length ? args.columns : defaults.columns;
  const rows = args.rows.map((row) => {
    if (row.length >= columns.length) return row;
    return [...row, ...Array(columns.length - row.length).fill("")];
  });

  return {
    template: args.template,
    sheetName: args.sheetName ?? defaults.sheetName,
    columns,
    rows,
  };
}
