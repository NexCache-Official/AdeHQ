import type { DocumentArtifactV1, DocumentBlock } from "../contracts/document";
import type { PresentationArtifactV1 } from "../contracts/presentation";
import type { WorkbookArtifactV1 } from "../contracts/workbook";
import { validateWorkbookFormulas } from "./formula-safety";

export type ArtifactValidationResult = {
  ok: boolean;
  errors: string[];
};

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bullets",
  "numbered",
  "callout",
  "table",
  "quote",
  "divider",
]);

function validateBlock(block: DocumentBlock, path: string): string[] {
  const errors: string[] = [];
  if (!block || typeof block !== "object" || !("type" in block)) {
    return [`${path}: invalid block`];
  }
  if (!BLOCK_TYPES.has(block.type)) {
    errors.push(`${path}: unknown block type ${String((block as { type: string }).type)}`);
  }
  if (block.type === "paragraph" || block.type === "callout" || block.type === "quote") {
    if (typeof block.text !== "string") errors.push(`${path}: text required`);
  }
  if (block.type === "heading") {
    if (typeof block.text !== "string") errors.push(`${path}: text required`);
    if (![1, 2, 3].includes(block.level)) errors.push(`${path}: heading level must be 1|2|3`);
  }
  if (block.type === "bullets" || block.type === "numbered") {
    if (!Array.isArray(block.items)) errors.push(`${path}: items required`);
  }
  if (block.type === "table") {
    if (!Array.isArray(block.columns) || !Array.isArray(block.rows)) {
      errors.push(`${path}: table columns/rows required`);
    }
  }
  return errors;
}

export function validateDocument(doc: unknown): ArtifactValidationResult {
  const errors: string[] = [];
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["document must be an object"] };
  const d = doc as Partial<DocumentArtifactV1>;
  if (d.schemaKey !== "adehq.document.v1") errors.push("schemaKey must be adehq.document.v1");
  if (d.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!d.title?.trim()) errors.push("title is required");
  if (!Array.isArray(d.sections) || d.sections.length === 0) {
    errors.push("sections must be a non-empty array");
  } else {
    const keys = new Set<string>();
    d.sections.forEach((section, i) => {
      if (!section.key?.trim()) errors.push(`sections[${i}] missing key`);
      else if (keys.has(section.key)) errors.push(`duplicate section key: ${section.key}`);
      else keys.add(section.key);
      if (!section.title?.trim()) errors.push(`sections[${i}] missing title`);
      if (!Array.isArray(section.blocks)) errors.push(`sections[${i}] blocks required`);
      else {
        section.blocks.forEach((b, j) => {
          errors.push(...validateBlock(b, `sections[${i}].blocks[${j}]`));
        });
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validatePresentation(pres: unknown): ArtifactValidationResult {
  const errors: string[] = [];
  if (!pres || typeof pres !== "object") {
    return { ok: false, errors: ["presentation must be an object"] };
  }
  const p = pres as Partial<PresentationArtifactV1>;
  if (p.schemaKey !== "adehq.presentation.v1") {
    errors.push("schemaKey must be adehq.presentation.v1");
  }
  if (p.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!p.title?.trim()) errors.push("title is required");
  if (!Array.isArray(p.slides) || p.slides.length === 0) {
    errors.push("slides must be a non-empty array");
  } else {
    p.slides.forEach((slide, i) => {
      if (!slide?.title?.trim()) errors.push(`slides[${i}] missing title`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export function validateWorkbook(wb: unknown): ArtifactValidationResult {
  const errors: string[] = [];
  if (!wb || typeof wb !== "object") return { ok: false, errors: ["workbook must be an object"] };
  const w = wb as Partial<WorkbookArtifactV1>;
  if (w.schemaKey !== "adehq.workbook.v1") errors.push("schemaKey must be adehq.workbook.v1");
  if (w.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!w.title?.trim()) errors.push("title is required");
  if (!Array.isArray(w.sheets) || w.sheets.length === 0) {
    errors.push("sheets must be a non-empty array");
  } else {
    w.sheets.forEach((sheet, i) => {
      if (!sheet?.name?.trim()) errors.push(`sheets[${i}] missing name`);
      if (!Array.isArray(sheet.columns)) errors.push(`sheets[${i}] columns required`);
      if (!Array.isArray(sheet.rows) && !Array.isArray(sheet.records)) {
        errors.push(`sheets[${i}] rows or records required`);
      }
    });
    if (errors.length === 0) {
      const formula = validateWorkbookFormulas(w as WorkbookArtifactV1);
      errors.push(...formula.errors);
    }
  }
  return { ok: errors.length === 0, errors };
}
