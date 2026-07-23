import type { ProcedureHandler } from "../../contracts";

/** Stub that calls injectable PDF renderer (Playwright path is worker-side). */
export const render_pdf: ProcedureHandler = async (input, ctx) => {
  const renderer = ctx.renderers?.["pdf.playwright.v1"] ?? ctx.renderers?.render_pdf;
  if (!renderer) {
    return {
      ok: true,
      output: {
        deferred: true,
        rendererKey: "pdf.playwright.v1",
        note: "Playwright PDF rendering runs on the worker path",
        artifact: input.artifact ?? input.document ?? input,
      },
    };
  }
  const buffer = await renderer(input);
  return {
    ok: true,
    output: {
      rendererKey: "pdf.playwright.v1",
      format: "pdf",
      bytes: buffer,
    },
  };
};
