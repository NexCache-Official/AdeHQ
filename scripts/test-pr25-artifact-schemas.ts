/**
 * PR-25 — document/presentation/workbook schema + formula safety (no DB).
 */
import {
  validateDocument,
  validatePresentation,
  validateWorkbook,
} from "../src/lib/artifacts/schemas/validate";
import { validateFormula } from "../src/lib/artifacts/schemas/formula-safety";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 artifact schemas ===\n");

const doc = {
  schemaKey: "adehq.document.v1" as const,
  schemaVersion: 1 as const,
  title: "Brief",
  sections: [
    {
      key: "overview",
      title: "Overview",
      blocks: [
        { type: "heading" as const, level: 1 as const, text: "Hello" },
        { type: "paragraph" as const, text: "Body" },
        { type: "bullets" as const, items: ["a", "b"] },
      ],
    },
  ],
};
const docOk = validateDocument(doc);
check("valid document", docOk.ok, docOk.errors.join("; "));

const badDoc = validateDocument({ schemaKey: "wrong", schemaVersion: 2, title: "", sections: [] });
check("rejects bad document", !badDoc.ok && badDoc.errors.length >= 2);

const pres = {
  schemaKey: "adehq.presentation.v1" as const,
  schemaVersion: 1 as const,
  title: "Deck",
  slides: [{ title: "Title", bullets: ["One"] }],
};
const presOk = validatePresentation(pres);
check("valid presentation", presOk.ok, presOk.errors.join("; "));

const badPres = validatePresentation({ schemaKey: "adehq.presentation.v1", schemaVersion: 1, title: "x", slides: [] });
check("rejects empty slides", !badPres.ok);

const wb = {
  schemaKey: "adehq.workbook.v1" as const,
  schemaVersion: 1 as const,
  title: "Numbers",
  sheets: [
    {
      name: "Sheet1",
      columns: ["A", "B", "Total"],
      rows: [
        [1, 2, { formula: "SUM(A1:B1)", value: 3 }],
        [3, 4, { formula: "=AVERAGE(A2:B2)" }],
      ],
    },
  ],
};
const wbOk = validateWorkbook(wb);
check("valid workbook with allowlisted formulas", wbOk.ok, wbOk.errors.join("; "));

const badFormula = validateFormula("=WEBSERVICE(\"http://evil\")");
check("rejects WEBSERVICE", !badFormula.ok);
const macro = validateFormula("=Macro()");
check("rejects Macro", !macro.ok);
const hyperlink = validateFormula("=HYPERLINK(\"http://x\")");
check("rejects HYPERLINK", !hyperlink.ok);
const unknownFn = validateFormula("=EVAL(1)");
check("rejects unknown function", !unknownFn.ok);

const badWb = validateWorkbook({
  schemaKey: "adehq.workbook.v1",
  schemaVersion: 1,
  title: "Bad",
  sheets: [
    {
      name: "S",
      columns: ["A"],
      rows: [[{ formula: "=INDIRECT(A1)" }]],
    },
  ],
});
check("workbook validation rejects INDIRECT", !badWb.ok);

console.log(`\n${failed ? `Failed: ${failed}` : "All artifact schema checks passed."}\n`);
process.exit(failed ? 1 : 0);
