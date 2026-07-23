import type { ProcedureHandler } from "../../contracts";

/** Compose canonical document content — models never emit OOXML. */
export const compose_document: ProcedureHandler = (input) => {
  const title = String(input.title ?? "Untitled document");
  const sections = Array.isArray(input.sections)
    ? input.sections
    : [
        {
          key: "body",
          title: "Body",
          blocks: [{ type: "paragraph", text: String(input.body ?? input.summary ?? "") }],
        },
      ];

  return {
    ok: true,
    output: {
      artifact: {
        schemaKey: "adehq.document.v1",
        schemaVersion: 1,
        kind: "document",
        title,
        sections,
        metadata: (input.metadata as Record<string, unknown>) ?? {},
      },
    },
  };
};
