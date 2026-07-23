import type { ProcedureHandler } from "../../contracts";

export const compose_presentation: ProcedureHandler = (input) => {
  const title = String(input.title ?? "Untitled presentation");
  const slides = Array.isArray(input.slides)
    ? input.slides
    : [
        {
          key: "title",
          layout: "title",
          title,
          bullets: [],
        },
      ];

  return {
    ok: true,
    output: {
      artifact: {
        schemaKey: "adehq.presentation.v1",
        schemaVersion: 1,
        kind: "presentation",
        title,
        subtitle: input.subtitle ? String(input.subtitle) : undefined,
        slides,
        metadata: (input.metadata as Record<string, unknown>) ?? {},
      },
    },
  };
};
