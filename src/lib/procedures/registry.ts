import type { ProcedureHandler, ProcedureManifest } from "./contracts";

import { normalize_csv } from "./procedures/data/normalize_csv";
import { profile_table } from "./procedures/data/profile_table";
import { calculate_summary_statistics } from "./procedures/data/calculate_summary_statistics";
import { detect_missing_values } from "./procedures/data/detect_missing_values";
import { sort_and_filter } from "./procedures/data/sort_and_filter";
import { deduplicate_rows } from "./procedures/data/deduplicate_rows";
import { transform_rows } from "./procedures/data/transform_rows";
import { compare_tables } from "./procedures/data/compare_tables";
import { calculate_financial_ratios } from "./procedures/data/calculate_financial_ratios";
import { bar_chart } from "./procedures/charts/bar_chart";
import { line_chart } from "./procedures/charts/line_chart";
import { pie_chart } from "./procedures/charts/pie_chart";
import { validate_schema } from "./procedures/quality/validate_schema";
import { compose_document } from "./procedures/documents/compose_document";
import { render_docx } from "./procedures/documents/render_docx";
import { render_pdf } from "./procedures/documents/render_pdf";
import { compose_presentation } from "./procedures/presentations/compose_presentation";
import { render_pptx } from "./procedures/presentations/render_pptx";
import { compose_workbook } from "./procedures/spreadsheets/compose_workbook";
import { render_xlsx } from "./procedures/spreadsheets/render_xlsx";
import { format_citations } from "./procedures/citations/format_citations";
import {
  build_toc,
  generate_executive_summary,
  plan_narrative,
  split_overflowing_slide,
  render_pdf_preview,
  generate_thumbnails,
  validate_formulas,
  generate_summary_sheet,
  generate_data_dictionary,
  export_csv,
  validate_provenance,
  validate_links,
  validate_numbers,
  validate_readability,
  validate_export,
  generate_preview,
  waterfall_chart,
  timeline_chart,
  matrix_chart,
  bridge_search_execute,
  bridge_vision_inspect,
  bridge_image_generate,
  bridge_file_extract,
  bridge_file_retrieve_chunks,
} from "./procedures/stubs";

function manifest(
  partial: Omit<
    ProcedureManifest,
    "version" | "runtime" | "network" | "timeoutMs" | "engine" | "permissions"
  > &
    Partial<
      Pick<
        ProcedureManifest,
        "version" | "runtime" | "network" | "timeoutMs" | "engine" | "permissions"
      >
    >,
): ProcedureManifest {
  return {
    version: 1,
    runtime: "node",
    network: "none",
    timeoutMs: 30_000,
    engine: "node_builtin",
    ...partial,
    permissions: partial.permissions ?? [],
  };
}

/** Static PR-25 procedure catalog — keyed by executorKey. */
export const ARTIFACT_PROCEDURES: Record<string, ProcedureManifest> = {
  // data
  normalize_csv: manifest({
    executorKey: "normalize_csv",
    name: "Normalize CSV",
    category: "data",
    trustLevel: "core",
    description: "Parse CSV text into a structured table",
  }),
  profile_table: manifest({
    executorKey: "profile_table",
    name: "Profile Table",
    category: "data",
    trustLevel: "core",
  }),
  calculate_summary_statistics: manifest({
    executorKey: "calculate_summary_statistics",
    name: "Summary Statistics",
    category: "data",
    trustLevel: "core",
  }),
  detect_missing_values: manifest({
    executorKey: "detect_missing_values",
    name: "Detect Missing Values",
    category: "data",
    trustLevel: "core",
  }),
  sort_and_filter: manifest({
    executorKey: "sort_and_filter",
    name: "Sort and Filter",
    category: "data",
    trustLevel: "core",
  }),
  deduplicate_rows: manifest({
    executorKey: "deduplicate_rows",
    name: "Deduplicate Rows",
    category: "data",
    trustLevel: "core",
  }),
  transform_rows: manifest({
    executorKey: "transform_rows",
    name: "Transform Rows",
    category: "data",
    trustLevel: "core",
  }),
  compare_tables: manifest({
    executorKey: "compare_tables",
    name: "Compare Tables",
    category: "data",
    trustLevel: "core",
  }),
  calculate_financial_ratios: manifest({
    executorKey: "calculate_financial_ratios",
    name: "Financial Ratios",
    category: "data",
    trustLevel: "core",
  }),

  // charts — return chart spec JSON, not scripts
  bar_chart: manifest({
    executorKey: "bar_chart",
    name: "Bar Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),
  line_chart: manifest({
    executorKey: "line_chart",
    name: "Line Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),
  pie_chart: manifest({
    executorKey: "pie_chart",
    name: "Pie Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),

  // quality
  validate_schema: manifest({
    executorKey: "validate_schema",
    name: "Validate Schema",
    category: "quality",
    trustLevel: "core",
  }),

  // documents
  compose_document: manifest({
    executorKey: "compose_document",
    name: "Compose Document",
    category: "documents",
    trustLevel: "core",
    engine: "artifact_engine",
  }),
  render_docx: manifest({
    executorKey: "render_docx",
    name: "Render DOCX",
    category: "documents",
    trustLevel: "core",
    engine: "artifact_engine",
    permissions: ["artifact.export"],
  }),
  render_pdf: manifest({
    executorKey: "render_pdf",
    name: "Render PDF",
    category: "documents",
    trustLevel: "verified",
    engine: "artifact_engine",
    runtime: "worker",
    permissions: ["artifact.export"],
    timeoutMs: 120_000,
  }),

  // presentations
  compose_presentation: manifest({
    executorKey: "compose_presentation",
    name: "Compose Presentation",
    category: "presentations",
    trustLevel: "core",
    engine: "artifact_engine",
  }),
  render_pptx: manifest({
    executorKey: "render_pptx",
    name: "Render PPTX",
    category: "presentations",
    trustLevel: "core",
    engine: "artifact_engine",
    permissions: ["artifact.export"],
  }),

  // spreadsheets
  compose_workbook: manifest({
    executorKey: "compose_workbook",
    name: "Compose Workbook",
    category: "spreadsheets",
    trustLevel: "core",
    engine: "artifact_engine",
  }),
  render_xlsx: manifest({
    executorKey: "render_xlsx",
    name: "Render XLSX",
    category: "spreadsheets",
    trustLevel: "core",
    engine: "artifact_engine",
    permissions: ["artifact.export"],
  }),

  // citations
  format_citations: manifest({
    executorKey: "format_citations",
    name: "Format Citations",
    category: "citations",
    trustLevel: "core",
  }),

  // documents (extended)
  build_toc: manifest({
    executorKey: "build_toc",
    name: "Build Table of Contents",
    category: "documents",
    trustLevel: "core",
  }),
  generate_executive_summary: manifest({
    executorKey: "generate_executive_summary",
    name: "Generate Executive Summary",
    category: "documents",
    trustLevel: "core",
  }),

  // presentations (extended)
  plan_narrative: manifest({
    executorKey: "plan_narrative",
    name: "Plan Presentation Narrative",
    category: "presentations",
    trustLevel: "core",
  }),
  split_overflowing_slide: manifest({
    executorKey: "split_overflowing_slide",
    name: "Split Overflowing Slide",
    category: "presentations",
    trustLevel: "core",
  }),
  render_pdf_preview: manifest({
    executorKey: "render_pdf_preview",
    name: "Render PDF Preview",
    category: "presentations",
    trustLevel: "verified",
    runtime: "worker",
  }),
  generate_thumbnails: manifest({
    executorKey: "generate_thumbnails",
    name: "Generate Thumbnails",
    category: "presentations",
    trustLevel: "verified",
    runtime: "worker",
  }),

  // spreadsheets (extended)
  validate_formulas: manifest({
    executorKey: "validate_formulas",
    name: "Validate Formulas",
    category: "spreadsheets",
    trustLevel: "core",
  }),
  generate_summary_sheet: manifest({
    executorKey: "generate_summary_sheet",
    name: "Generate Summary Sheet",
    category: "spreadsheets",
    trustLevel: "core",
  }),
  generate_data_dictionary: manifest({
    executorKey: "generate_data_dictionary",
    name: "Generate Data Dictionary",
    category: "spreadsheets",
    trustLevel: "core",
  }),
  export_csv: manifest({
    executorKey: "export_csv",
    name: "Export CSV",
    category: "spreadsheets",
    trustLevel: "core",
  }),

  // charts (extended)
  waterfall_chart: manifest({
    executorKey: "waterfall_chart",
    name: "Waterfall Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),
  timeline_chart: manifest({
    executorKey: "timeline_chart",
    name: "Timeline Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),
  matrix_chart: manifest({
    executorKey: "matrix_chart",
    name: "Matrix Chart Spec",
    category: "charts",
    trustLevel: "core",
  }),

  // quality (extended)
  validate_provenance: manifest({
    executorKey: "validate_provenance",
    name: "Validate Provenance",
    category: "quality",
    trustLevel: "core",
  }),
  validate_links: manifest({
    executorKey: "validate_links",
    name: "Validate Links",
    category: "quality",
    trustLevel: "core",
  }),
  validate_numbers: manifest({
    executorKey: "validate_numbers",
    name: "Validate Numbers",
    category: "quality",
    trustLevel: "core",
  }),
  validate_readability: manifest({
    executorKey: "validate_readability",
    name: "Validate Readability",
    category: "quality",
    trustLevel: "core",
  }),
  validate_export: manifest({
    executorKey: "validate_export",
    name: "Validate Export",
    category: "quality",
    trustLevel: "core",
  }),
  generate_preview: manifest({
    executorKey: "generate_preview",
    name: "Generate Preview",
    category: "quality",
    trustLevel: "core",
  }),

  // capability bridges — still go through Brain router at call sites
  "search.execute": manifest({
    executorKey: "search.execute",
    name: "Search Execute Bridge",
    category: "bridges",
    trustLevel: "verified",
    permissions: ["search.execute"],
  }),
  "vision.inspect": manifest({
    executorKey: "vision.inspect",
    name: "Vision Inspect Bridge",
    category: "bridges",
    trustLevel: "verified",
    permissions: ["vision.inspect"],
  }),
  "image.generate": manifest({
    executorKey: "image.generate",
    name: "Image Generate Bridge",
    category: "bridges",
    trustLevel: "verified",
    permissions: ["image.generate"],
  }),
  "file.extract": manifest({
    executorKey: "file.extract",
    name: "File Extract Bridge",
    category: "bridges",
    trustLevel: "verified",
    permissions: ["file.extract"],
  }),
  "file.retrieve_chunks": manifest({
    executorKey: "file.retrieve_chunks",
    name: "File Retrieve Chunks Bridge",
    category: "bridges",
    trustLevel: "verified",
    permissions: ["file.retrieve"],
  }),
};

export const PROCEDURE_HANDLERS: Record<string, ProcedureHandler> = {
  normalize_csv,
  profile_table,
  calculate_summary_statistics,
  detect_missing_values,
  sort_and_filter,
  deduplicate_rows,
  transform_rows,
  compare_tables,
  calculate_financial_ratios,
  bar_chart,
  line_chart,
  pie_chart,
  validate_schema,
  compose_document,
  render_docx,
  render_pdf,
  compose_presentation,
  render_pptx,
  compose_workbook,
  render_xlsx,
  format_citations,
  build_toc,
  generate_executive_summary,
  plan_narrative,
  split_overflowing_slide,
  render_pdf_preview,
  generate_thumbnails,
  validate_formulas,
  generate_summary_sheet,
  generate_data_dictionary,
  export_csv,
  waterfall_chart,
  timeline_chart,
  matrix_chart,
  validate_provenance,
  validate_links,
  validate_numbers,
  validate_readability,
  validate_export,
  generate_preview,
  "search.execute": bridge_search_execute,
  "vision.inspect": bridge_vision_inspect,
  "image.generate": bridge_image_generate,
  "file.extract": bridge_file_extract,
  "file.retrieve_chunks": bridge_file_retrieve_chunks,
};

/** Spec-style dotted aliases → executor keys (static; no dynamic import). */
export const PROCEDURE_KEY_ALIASES: Record<string, string> = {
  "data.normalize_csv": "normalize_csv",
  "data.profile_table": "profile_table",
  "data.compare_tables": "compare_tables",
  "data.calculate_summary_statistics": "calculate_summary_statistics",
  "data.detect_missing_values": "detect_missing_values",
  "data.calculate_financial_ratios": "calculate_financial_ratios",
  "data.transform_rows": "transform_rows",
  "data.deduplicate_rows": "deduplicate_rows",
  "data.sort_and_filter": "sort_and_filter",
  "chart.bar": "bar_chart",
  "chart.line": "line_chart",
  "chart.pie": "pie_chart",
  "chart.waterfall": "waterfall_chart",
  "chart.timeline": "timeline_chart",
  "chart.matrix": "matrix_chart",
  "document.build_toc": "build_toc",
  "document.format_citations": "format_citations",
  "document.generate_executive_summary": "generate_executive_summary",
  "document.render_docx": "render_docx",
  "document.render_pdf": "render_pdf",
  "presentation.plan_narrative": "plan_narrative",
  "presentation.split_overflowing_slide": "split_overflowing_slide",
  "presentation.render_pptx": "render_pptx",
  "presentation.render_pdf_preview": "render_pdf_preview",
  "presentation.generate_thumbnails": "generate_thumbnails",
  "spreadsheet.render_xlsx": "render_xlsx",
  "spreadsheet.validate_formulas": "validate_formulas",
  "spreadsheet.generate_summary_sheet": "generate_summary_sheet",
  "spreadsheet.generate_data_dictionary": "generate_data_dictionary",
  "spreadsheet.export_csv": "export_csv",
  "artifact.validate_schema": "validate_schema",
  "artifact.validate_provenance": "validate_provenance",
  "artifact.validate_links": "validate_links",
  "artifact.validate_numbers": "validate_numbers",
  "artifact.validate_readability": "validate_readability",
  "artifact.validate_export": "validate_export",
  "artifact.generate_preview": "generate_preview",
};

/** Alias used by call sites — same static map as ARTIFACT_PROCEDURES. */
export const PROCEDURE_REGISTRY: Record<string, ProcedureManifest> = ARTIFACT_PROCEDURES;

/** Resolve dotted spec aliases to the static executor key. */
export function resolveProcedureKey(executorKey: string): string {
  return PROCEDURE_KEY_ALIASES[executorKey] ?? executorKey;
}

export function getProcedureManifest(executorKey: string): ProcedureManifest | undefined {
  return PROCEDURE_REGISTRY[resolveProcedureKey(executorKey)];
}

export function getProcedureHandler(executorKey: string): ProcedureHandler | undefined {
  return PROCEDURE_HANDLERS[resolveProcedureKey(executorKey)];
}

export function listProcedureKeys(): string[] {
  return Object.keys(PROCEDURE_REGISTRY);
}
