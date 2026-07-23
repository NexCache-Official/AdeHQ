/**
 * PR-25 — buildIdempotencyKey stability / uniqueness (no DB).
 */
import { buildIdempotencyKey } from "../src/lib/playbooks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 playbook idempotency ===\n");

const a = buildIdempotencyKey(["ws_1", "playbook_run", "step_a", "v1"]);
const b = buildIdempotencyKey(["ws_1", "playbook_run", "step_a", "v1"]);
const c = buildIdempotencyKey(["ws_1", "playbook_run", "step_b", "v1"]);
const d = buildIdempotencyKey(["  ws_1  ", "playbook_run", "step_a", "v1"]);

check("stable across calls", a === b);
check("hex sha256 length", /^[a-f0-9]{64}$/.test(a));
check("unique for different parts", a !== c);
check("trims whitespace parts", a === d);

let threw = false;
try {
  buildIdempotencyKey(["", "  "]);
} catch {
  threw = true;
}
check("rejects empty parts", threw);

console.log(`\n${failed ? `Failed: ${failed}` : "All playbook idempotency checks passed."}\n`);
process.exit(failed ? 1 : 0);
