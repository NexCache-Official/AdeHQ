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
    // Match how people actually fill landlord/investor lead sheets — not CRM contact schema.
    columns: [
      "Name",
      "Company",
      "Area",
      "Portfolio",
      "Email / Phone",
      "Source URL",
      "Priority",
      "Why now",
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
  // Prefer the model's/user's columns when provided — never widen to template
  // defaults over shorter custom headers (that left rows misaligned under
  // Company/Contact/Role while data was Name/Company/Area/…).
  const columns =
    Array.isArray(args.columns) && args.columns.length > 0
      ? args.columns
      : defaults.columns;
  const rows = args.rows.map((row) => {
    if (row.length === columns.length) return row;
    if (row.length > columns.length) return row.slice(0, columns.length);
    return [...row, ...Array(columns.length - row.length).fill("")];
  });

  return {
    template: args.template,
    sheetName: args.sheetName ?? defaults.sheetName,
    columns,
    rows,
  };
}
