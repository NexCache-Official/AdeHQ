export type WorkbookCellValue = string | number | boolean | null;

export type WorkbookFormula = {
  /** Formula expression without leading '=' optional. */
  formula: string;
  /** Cached computed value when known. */
  value?: WorkbookCellValue;
};

export type WorkbookCell = WorkbookCellValue | WorkbookFormula;

export type WorkbookSheetV1 = {
  name: string;
  columns: string[];
  rows: WorkbookCell[][];
  /** Column-keyed object rows (alternative to rows matrix). */
  records?: Array<Record<string, WorkbookCell>>;
};

/**
 * Canonical workbook content with formula safety types.
 * Formulas are validated separately — VBA/macros/external refs rejected.
 */
export type WorkbookArtifactV1 = {
  schemaKey: "adehq.workbook.v1";
  schemaVersion: 1;
  kind?: "workbook" | "dataset";
  title: string;
  sheets: WorkbookSheetV1[];
  metadata?: Record<string, unknown>;
};

export type FormulaSafetyResult = {
  ok: boolean;
  errors: string[];
  allowedFunctionsUsed: string[];
};
