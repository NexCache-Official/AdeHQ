import type { ProcedureHandler } from "../../contracts";

export const render_xlsx: ProcedureHandler = async (input, ctx) => {
  const renderer = ctx.renderers?.["xlsx.exceljs.v1"] ?? ctx.renderers?.render_xlsx;
  if (!renderer) {
    return {
      ok: true,
      output: {
        deferred: true,
        rendererKey: "xlsx.exceljs.v1",
        artifact: input.artifact ?? input.workbook ?? input,
      },
    };
  }
  const buffer = await renderer(input);
  return {
    ok: true,
    output: {
      rendererKey: "xlsx.exceljs.v1",
      format: "xlsx",
      bytes: buffer,
    },
  };
};
