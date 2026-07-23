/**
 * PR-25 — render pptx/docx/xlsx/html via registry; OOXML PK magic (no DB).
 *
 *   npm run test:pr25:renderers
 */
import { getArtifactRenderer } from "../src/lib/artifacts/renderers/registry";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function hasZipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b; // PK
}

console.log("\n=== PR-25 artifact renderers ===\n");

const document = {
  schemaKey: "adehq.document.v1" as const,
  schemaVersion: 1 as const,
  title: "Renderer Fixture Doc",
  sections: [
    {
      key: "s1",
      title: "Section",
      blocks: [
        { type: "paragraph" as const, text: "Hello AdeHQ" },
        { type: "bullets" as const, items: ["One", "Two"] },
      ],
    },
  ],
};

const presentation = {
  schemaKey: "adehq.presentation.v1" as const,
  schemaVersion: 1 as const,
  title: "Renderer Fixture Deck",
  slides: [{ title: "Slide A", bullets: ["Point"] }],
};

const workbook = {
  schemaKey: "adehq.workbook.v1" as const,
  schemaVersion: 1 as const,
  title: "Renderer Fixture Sheet",
  sheets: [
    {
      name: "Data",
      columns: ["Name", "Value"],
      rows: [["Alpha", 1], ["Beta", 2]],
    },
  ],
};

async function main() {
  const pptx = getArtifactRenderer("pptx.pptxgenjs.v1");
  const docx = getArtifactRenderer("docx.docxjs.v1");
  const xlsx = getArtifactRenderer("xlsx.exceljs.v1");
  const html = getArtifactRenderer("html.preview.v1");

  check("pptx renderer registered", Boolean(pptx));
  check("docx renderer registered", Boolean(docx));
  check("xlsx renderer registered", Boolean(xlsx));
  check("html renderer registered", Boolean(html));

  const pptxOut = await pptx!.render({
    canonical: presentation,
    generatedBy: "pr25-test",
  });
  check("pptx buffer non-empty", pptxOut.buffer.byteLength > 0, String(pptxOut.buffer.byteLength));
  check("pptx OOXML PK magic", hasZipMagic(pptxOut.buffer));

  const docxOut = await docx!.render({
    canonical: document,
    generatedBy: "pr25-test",
  });
  check("docx buffer non-empty", docxOut.buffer.byteLength > 0, String(docxOut.buffer.byteLength));
  check("docx OOXML PK magic", hasZipMagic(docxOut.buffer));

  const xlsxOut = await xlsx!.render({
    canonical: workbook,
    generatedBy: "pr25-test",
  });
  check("xlsx buffer non-empty", xlsxOut.buffer.byteLength > 0, String(xlsxOut.buffer.byteLength));
  check("xlsx OOXML PK magic", hasZipMagic(xlsxOut.buffer));

  const htmlOut = await html!.render({
    canonical: document,
    generatedBy: "pr25-test",
  });
  check("html buffer non-empty", htmlOut.buffer.byteLength > 0);
  const htmlText = htmlOut.buffer.toString("utf8");
  check("html contains title", /Renderer Fixture Doc/.test(htmlText));

  console.log(`\n${failed ? `Failed: ${failed}` : "All artifact renderer checks passed."}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
