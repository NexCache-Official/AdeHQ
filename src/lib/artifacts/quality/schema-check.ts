import { validateDocument, validatePresentation, validateWorkbook } from "../schemas/validate";

export type QualityCheckResult = {
  check: string;
  ok: boolean;
  errors: string[];
};

export function schemaCheck(canonical: unknown): QualityCheckResult {
  if (!canonical || typeof canonical !== "object") {
    return { check: "schema", ok: false, errors: ["canonical content missing"] };
  }
  const schemaKey = String((canonical as { schemaKey?: string }).schemaKey ?? "");
  if (schemaKey === "adehq.document.v1") {
    const r = validateDocument(canonical);
    return { check: "schema", ok: r.ok, errors: r.errors };
  }
  if (schemaKey === "adehq.presentation.v1") {
    const r = validatePresentation(canonical);
    return { check: "schema", ok: r.ok, errors: r.errors };
  }
  if (schemaKey === "adehq.workbook.v1") {
    const r = validateWorkbook(canonical);
    return { check: "schema", ok: r.ok, errors: r.errors };
  }
  return { check: "schema", ok: false, errors: [`unknown schemaKey: ${schemaKey || "(missing)"}`] };
}
