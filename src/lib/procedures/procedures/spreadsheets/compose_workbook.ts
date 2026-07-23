import type { ProcedureHandler } from "../../contracts";

export const compose_workbook: ProcedureHandler = (input) => {
  const title = String(input.title ?? "Workbook");
  const sheets = Array.isArray(input.sheets)
    ? input.sheets
    : [
        {
          name: "Sheet1",
          columns: Array.isArray(input.columns) ? input.columns : [],
          rows: Array.isArray(input.rows) ? input.rows : [],
        },
      ];

  return {
    ok: true,
    output: {
      artifact: {
        schemaKey: "adehq.workbook.v1",
        schemaVersion: 1,
        kind: "workbook",
        title,
        sheets,
        metadata: (input.metadata as Record<string, unknown>) ?? {},
      },
    },
  };
};
