import * as XLSX from "xlsx";

export type SpreadsheetSpec = {
  sheetName?: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
};

export function buildSpreadsheetBuffer(spec: SpreadsheetSpec): Buffer {
  const sheetName = (spec.sheetName ?? "Sheet1").slice(0, 31);
  const header = spec.columns.map((c) => String(c));
  const body = spec.rows.map((row) =>
    row.map((cell) => (cell == null ? "" : cell)),
  );
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export function spreadsheetMarkdownPreview(spec: SpreadsheetSpec): string {
  const header = `| ${spec.columns.join(" | ")} |`;
  const divider = `| ${spec.columns.map(() => "---").join(" | ")} |`;
  const rows = spec.rows
    .slice(0, 12)
    .map((row) => `| ${row.map((c) => String(c ?? "")).join(" | ")} |`)
    .join("\n");
  const more =
    spec.rows.length > 12 ? `\n\n_…and ${spec.rows.length - 12} more rows in the spreadsheet file._` : "";
  return `${header}\n${divider}\n${rows}${more}`;
}
