import type { FormulaSafetyResult, WorkbookArtifactV1, WorkbookCell } from "../contracts/workbook";

/** Allowlisted spreadsheet functions for V1. */
export const ALLOWED_FORMULA_FUNCTIONS = [
  "SUM",
  "AVERAGE",
  "IF",
  "COUNT",
  "MIN",
  "MAX",
  "ROUND",
  "VLOOKUP",
  "INDEX",
  "MATCH",
  "CONCATENATE",
  "TEXT",
  "DATE",
  "IFERROR",
] as const;

const ALLOWED = new Set<string>(ALLOWED_FORMULA_FUNCTIONS);

const REJECT_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\bVBA\b/i, message: "VBA is not allowed" },
  { re: /\bMacro\b/i, message: "Macros are not allowed" },
  { re: /^=?\s*CMD\b/i, message: "=CMD is not allowed" },
  { re: /\bDDE\b/i, message: "DDE is not allowed" },
  { re: /\bEXEC\b/i, message: "EXEC is not allowed" },
  { re: /\bSHELL\b/i, message: "SHELL is not allowed" },
  { re: /https?:\/\//i, message: "External URL references are not allowed in formulas" },
  { re: /\[[^\]]+\.(xlsx|xlsm|xlsb|xls|csv)\]/i, message: "External workbook refs are not allowed" },
  { re: /'\\[^']+'\!/i, message: "External sheet refs are not allowed" },
  { re: /\bWEBSERVICE\b/i, message: "WEBSERVICE is not allowed" },
  { re: /\bIMPORTXML\b/i, message: "IMPORTXML is not allowed" },
  { re: /\bHYPERLINK\b/i, message: "HYPERLINK is not allowed" },
  { re: /\bINDIRECT\b/i, message: "INDIRECT is not allowed" },
  { re: /\bCALL\b/i, message: "CALL is not allowed" },
];

function extractFunctions(formula: string): string[] {
  const found: string[] = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    found.push(m[1]!.toUpperCase());
  }
  return found;
}

export function validateFormula(formula: string): FormulaSafetyResult {
  const raw = String(formula ?? "").trim();
  const expr = raw.startsWith("=") ? raw.slice(1) : raw;
  const errors: string[] = [];

  if (!expr) {
    return { ok: false, errors: ["empty formula"], allowedFunctionsUsed: [] };
  }

  for (const rule of REJECT_PATTERNS) {
    if (rule.re.test(expr) || rule.re.test(raw)) {
      errors.push(rule.message);
    }
  }

  const used = extractFunctions(expr);
  for (const fn of used) {
    if (!ALLOWED.has(fn)) {
      errors.push(`function not allowed: ${fn}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    allowedFunctionsUsed: used.filter((f) => ALLOWED.has(f)),
  };
}

function cellFormula(cell: WorkbookCell): string | null {
  if (cell && typeof cell === "object" && "formula" in cell) {
    return String((cell as { formula: string }).formula);
  }
  if (typeof cell === "string" && cell.trim().startsWith("=")) {
    return cell;
  }
  return null;
}

export function validateWorkbookFormulas(workbook: WorkbookArtifactV1): FormulaSafetyResult {
  const errors: string[] = [];
  const allowedFunctionsUsed = new Set<string>();

  for (const sheet of workbook.sheets ?? []) {
    const matrices: WorkbookCell[][] = [];
    if (Array.isArray(sheet.rows)) matrices.push(...sheet.rows);
    if (Array.isArray(sheet.records)) {
      for (const rec of sheet.records) {
        matrices.push(sheet.columns.map((c) => rec[c] ?? null));
      }
    }
    for (const row of matrices) {
      for (const cell of row) {
        const formula = cellFormula(cell);
        if (!formula) continue;
        const result = validateFormula(formula);
        for (const fn of result.allowedFunctionsUsed) allowedFunctionsUsed.add(fn);
        for (const err of result.errors) {
          errors.push(`sheet ${sheet.name}: ${err}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    allowedFunctionsUsed: [...allowedFunctionsUsed],
  };
}
