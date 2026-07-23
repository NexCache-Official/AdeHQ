/**
 * PR-25 — procedure registry keys, trust levels, data procedure fixtures (no DB).
 */
import {
  listProcedureKeys,
  PROCEDURE_REGISTRY,
  PROCEDURE_HANDLERS,
  isExecutableTrustLevel,
  executeProcedure,
  canExecuteProcedure,
} from "../src/lib/procedures";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EXPECTED_KEYS = [
  "normalize_csv",
  "profile_table",
  "calculate_summary_statistics",
  "detect_missing_values",
  "sort_and_filter",
  "deduplicate_rows",
  "transform_rows",
  "compare_tables",
  "calculate_financial_ratios",
  "bar_chart",
  "line_chart",
  "pie_chart",
  "validate_schema",
  "compose_document",
  "render_docx",
  "render_pdf",
  "compose_presentation",
  "render_pptx",
  "compose_workbook",
  "render_xlsx",
  "format_citations",
] as const;

console.log("\n=== PR-25 procedure registry ===\n");

const keys = listProcedureKeys();
check("registry non-empty", keys.length >= EXPECTED_KEYS.length);
for (const key of EXPECTED_KEYS) {
  check(`key present: ${key}`, keys.includes(key) && Boolean(PROCEDURE_REGISTRY[key]));
  check(`handler present: ${key}`, Boolean(PROCEDURE_HANDLERS[key]));
}

for (const key of keys) {
  const manifest = PROCEDURE_REGISTRY[key]!;
  check(
    `${key}: executable trust is core|verified`,
    isExecutableTrustLevel(manifest.trustLevel),
    `trustLevel=${manifest.trustLevel}`,
  );
  check(
    `${key}: canExecuteProcedure allows core|verified`,
    canExecuteProcedure(manifest, { grantedPermissions: manifest.permissions }).allowed,
  );
}

async function main() {
  const csv = await executeProcedure("normalize_csv", {
    csv: "name,score\nAda,9\nBob,7\nAda,9\n",
  });
  check("normalize_csv ok", csv.ok, csv.safeErrorMessage);
  const table = (csv.output.table ?? {}) as { columns: string[]; rows: Array<Record<string, unknown>> };
  check("normalize_csv columns", table.columns?.join(",") === "name,score");
  check("normalize_csv rows", table.rows?.length === 3);

  const stats = await executeProcedure("calculate_summary_statistics", { table });
  check("calculate_summary_statistics ok", stats.ok);
  const statistics = stats.output.statistics as Record<string, { mean: number | null }>;
  check("stats mean for score", statistics?.score?.mean === 8.333333);

  const sorted = await executeProcedure("sort_and_filter", {
    table,
    sortBy: "score",
    sortDir: "desc",
    limit: 2,
  });
  check("sort_and_filter ok", sorted.ok);
  const sortedTable = sorted.output.table as { rows: Array<Record<string, unknown>> };
  check("sort_and_filter limit", sortedTable.rows?.length === 2);
  // CSV cells are strings; single-digit scores sort lexicographically == numerically.
  check("sort_and_filter order", String(sortedTable.rows?.[0]?.score) === "9");

  const dedup = await executeProcedure("deduplicate_rows", { table, keys: ["name", "score"] });
  check("deduplicate_rows ok", dedup.ok);
  check("deduplicate_rows removed", Number(dedup.output.removed) === 1);

  const unknown = await executeProcedure("not_a_real_procedure", {});
  check("unknown procedure fails closed", !unknown.ok);

  console.log(`\n${failed ? `Failed: ${failed}` : "All procedure registry checks passed."}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
