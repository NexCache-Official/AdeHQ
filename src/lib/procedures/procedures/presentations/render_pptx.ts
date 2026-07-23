import type { ProcedureHandler } from "../../contracts";

export const render_pptx: ProcedureHandler = async (input, ctx) => {
  const renderer = ctx.renderers?.["pptx.pptxgenjs.v1"] ?? ctx.renderers?.render_pptx;
  if (!renderer) {
    return {
      ok: true,
      output: {
        deferred: true,
        rendererKey: "pptx.pptxgenjs.v1",
        artifact: input.artifact ?? input.presentation ?? input,
      },
    };
  }
  const buffer = await renderer(input);
  return {
    ok: true,
    output: {
      rendererKey: "pptx.pptxgenjs.v1",
      format: "pptx",
      bytes: buffer,
    },
  };
};
