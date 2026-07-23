/**
 * PR-25 — artifact storage + provenance path helpers (no DB).
 */
import {
  artifactVersionPrefix,
  artifactCanonicalObjectPath,
  artifactExportObjectPath,
  artifactPreviewObjectPath,
} from "../src/lib/artifacts/storage/paths";
import {
  artifactPathFor,
  parseArtifactPath,
  sourceRefToLocator,
  mapSourceRefsToProvenance,
  groupProvenanceByPath,
  flattenProvenance,
} from "../src/lib/playbooks/provenance";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 artifact provenance / paths ===\n");

const parts = { workspaceId: "ws1", artifactId: "art1", versionId: "ver1" };
const prefix = artifactVersionPrefix(parts);
check(
  "version prefix shape",
  prefix === "workspace/ws1/artifacts/art1/versions/ver1/",
);
check(
  "canonical path",
  artifactCanonicalObjectPath(parts) === `${prefix}canonical.json`,
);
check(
  "export path default",
  artifactExportObjectPath({ ...parts, format: "docx" }) === `${prefix}export.docx`,
);
check(
  "export path custom filename",
  artifactExportObjectPath({ ...parts, format: "pptx", filename: "deck.pptx" }) ===
    `${prefix}deck.pptx`,
);
check("preview path", artifactPreviewObjectPath(parts) === `${prefix}preview.html`);

let threw = false;
try {
  artifactVersionPrefix({ workspaceId: "", artifactId: "a", versionId: "v" });
} catch {
  threw = true;
}
check("prefix requires ids", threw);

const dotted = artifactPathFor("overview", "b1", "text");
check("artifactPathFor dotted", dotted === "sections.overview.blocks.b1.text");
const parsed = parseArtifactPath(dotted);
check("parseArtifactPath section", parsed.sectionKey === "overview");
check("parseArtifactPath block", parsed.blockKey === "b1");
check("parseArtifactPath field", parsed.field === "text");

const refs = [
  { sourceType: "web", sourceId: "src1", sourceLocator: "p2" },
  { sourceType: "file", sourceId: "f1" },
];
check(
  "sourceRefToLocator with fragment",
  sourceRefToLocator(refs[0]!) === "web:src1#p2",
);
const links = mapSourceRefsToProvenance(dotted, refs);
check("mapSourceRefsToProvenance count", links.length === 2);
const grouped = groupProvenanceByPath(links);
check("groupProvenanceByPath", (grouped[dotted]?.length ?? 0) === 2);
check("flattenProvenance roundtrip", flattenProvenance(grouped).length === 2);

console.log(`\n${failed ? `Failed: ${failed}` : "All artifact provenance checks passed."}\n`);
process.exit(failed ? 1 : 0);
