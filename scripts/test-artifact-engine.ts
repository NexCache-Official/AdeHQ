/**
 * Artifact Engine smoke test — validates local binary builders without DB.
 *
 * Usage:
 *   npx tsx scripts/test-artifact-engine.ts
 */

import { buildEnhancedSpreadsheetBuffer } from "../src/lib/artifacts/engine/spreadsheet-enhanced";
import { buildHtmlPdfBuffer } from "../src/lib/artifacts/engine/pdf-report";
import { buildDocxBuffer } from "../src/lib/artifacts/engine/docx";
import { buildPresentationBuffer } from "../src/lib/artifacts/engine/presentation";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const sections = [
    { heading: "Overview", body: "GreenEdge Robotics is a qualified sales opportunity." },
    { heading: "Next Steps", body: "Follow up with Praveen and update the pipeline workbook." },
  ];

  const xlsx = await buildEnhancedSpreadsheetBuffer({
    sheetName: "Pipeline",
    columns: ["Company", "Contact", "Stage", "Amount"],
    rows: [["GreenEdge Robotics", "Praveen", "Qualified", 5000]],
    meta: { title: "Pipeline Smoke Test", generatedBy: "test" },
  });
  const pdf = await buildHtmlPdfBuffer({ title: "PDF Smoke Test", sections, generatedBy: "test" });
  const docx = await buildDocxBuffer({ title: "DOCX Smoke Test", sections, generatedBy: "test" });
  const pptx = await buildPresentationBuffer({
    title: "PPTX Smoke Test",
    slides: sections.map((section) => ({ title: section.heading, bullets: [section.body] })),
    generatedBy: "test",
  });

  assert(xlsx.byteLength > 4000, `xlsx too small: ${xlsx.byteLength}`);
  assert(pdf.byteLength > 500, `pdf too small: ${pdf.byteLength}`);
  assert(docx.byteLength > 4000, `docx too small: ${docx.byteLength}`);
  assert(pptx.byteLength > 4000, `pptx too small: ${pptx.byteLength}`);

  console.log("Artifact engine smoke test passed.", {
    xlsx: xlsx.byteLength,
    pdf: pdf.byteLength,
    docx: docx.byteLength,
    pptx: pptx.byteLength,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
