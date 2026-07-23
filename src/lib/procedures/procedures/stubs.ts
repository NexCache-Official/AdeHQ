import type { ProcedureHandler } from "../contracts";

/** Deterministic stub for registered procedures not yet fully implemented. */
export function stubProcedure(name: string): ProcedureHandler {
  return (input) => ({
    ok: true,
    output: {
      procedure: name,
      stub: true,
      echo: input,
    },
  });
}

export const build_toc = stubProcedure("document.build_toc");
export const generate_executive_summary = stubProcedure("document.generate_executive_summary");
export const plan_narrative = stubProcedure("presentation.plan_narrative");
export const split_overflowing_slide = stubProcedure("presentation.split_overflowing_slide");
export const render_pdf_preview = stubProcedure("presentation.render_pdf_preview");
export const generate_thumbnails = stubProcedure("presentation.generate_thumbnails");
export const validate_formulas = stubProcedure("spreadsheet.validate_formulas");
export const generate_summary_sheet = stubProcedure("spreadsheet.generate_summary_sheet");
export const generate_data_dictionary = stubProcedure("spreadsheet.generate_data_dictionary");
export const export_csv = stubProcedure("spreadsheet.export_csv");
export const validate_provenance = stubProcedure("artifact.validate_provenance");
export const validate_links = stubProcedure("artifact.validate_links");
export const validate_numbers = stubProcedure("artifact.validate_numbers");
export const validate_readability = stubProcedure("artifact.validate_readability");
export const validate_export = stubProcedure("artifact.validate_export");
export const generate_preview = stubProcedure("artifact.generate_preview");
export const waterfall_chart = stubProcedure("chart.waterfall");
export const timeline_chart = stubProcedure("chart.timeline");
export const matrix_chart = stubProcedure("chart.matrix");
export const bridge_search_execute = stubProcedure("search.execute");
export const bridge_vision_inspect = stubProcedure("vision.inspect");
export const bridge_image_generate = stubProcedure("image.generate");
export const bridge_file_extract = stubProcedure("file.extract");
export const bridge_file_retrieve_chunks = stubProcedure("file.retrieve_chunks");
