import {
  buildEnhancedSpreadsheetBuffer,
  type EnhancedSpreadsheetSpec,
} from "@/lib/artifacts/engine/spreadsheet-enhanced";
import type { WorkbookArtifactV1, WorkbookCell } from "../../contracts/workbook";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

function cellToValue(cell: WorkbookCell): string | number | boolean | null {
  if (cell && typeof cell === "object" && "formula" in cell) {
    const f = cell as { formula: string; value?: string | number | boolean | null };
    return f.value ?? `=${f.formula.replace(/^=/, "")}`;
  }
  return cell as string | number | boolean | null;
}

export function workbookArtifactToSpreadsheetSpec(
  artifact: WorkbookArtifactV1,
  meta?: { generatedBy?: string; generatedAt?: string },
): EnhancedSpreadsheetSpec {
  const sheet = artifact.sheets[0];
  const columns = sheet?.columns ?? [];
  let rows: Array<Array<string | number | boolean | null>> = [];
  if (sheet?.rows?.length) {
    rows = sheet.rows.map((row) => row.map(cellToValue));
  } else if (sheet?.records?.length) {
    rows = sheet.records.map((rec) => columns.map((c) => cellToValue(rec[c] ?? null)));
  }

  return {
    sheetName: sheet?.name ?? "Sheet1",
    columns,
    rows,
    meta: {
      title: artifact.title,
      generatedBy: meta?.generatedBy,
      generatedAt: meta?.generatedAt,
      source: "AdeHQ artifact runtime",
    },
  };
}

export async function renderXlsxV1(input: ArtifactRendererInput): Promise<ArtifactRendererResult> {
  const canonical = input.canonical as WorkbookArtifactV1;
  const spec = workbookArtifactToSpreadsheetSpec(canonical, {
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
  });
  const buffer = await buildEnhancedSpreadsheetBuffer(spec);
  return {
    format: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
    pageOrSlideCount: canonical.sheets?.length ?? 1,
  };
}

export const xlsxRendererV1: ArtifactRenderer = {
  key: "xlsx.exceljs.v1",
  version: "1",
  format: "xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  render: renderXlsxV1,
};
