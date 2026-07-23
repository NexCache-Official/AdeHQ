import type { ProcedureHandler } from "../../contracts";

/** Stub that calls an injectable renderer — no OOXML authored here. */
export const render_docx: ProcedureHandler = async (input, ctx) => {
  const renderer = ctx.renderers?.["docx.docxjs.v1"] ?? ctx.renderers?.render_docx;
  if (!renderer) {
    return {
      ok: true,
      output: {
        deferred: true,
        rendererKey: "docx.docxjs.v1",
        artifact: input.artifact ?? input.document ?? input,
      },
    };
  }
  const buffer = await renderer(input);
  return {
    ok: true,
    output: {
      rendererKey: "docx.docxjs.v1",
      format: "docx",
      bytes: buffer,
    },
  };
};
