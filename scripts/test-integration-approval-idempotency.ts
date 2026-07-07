/**
 * Phase 2D — Approval idempotency smoke test (registry + key stability).
 * Live Supabase duplicate-approve test requires credentials — skipped here.
 */
import { buildIdempotencyKey } from "../src/lib/integrations/tool-runs";
import { getToolDefinition } from "../src/lib/integrations/registry/tool-definitions";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let failures = 0;
function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run("approval-scoped idempotency keys are stable", () => {
  const keyA = buildIdempotencyKey({
    scope: "approval:appr-123",
    tool: "crm.createDeal",
    args: { name: "Acme", amount: 5000 },
  });
  const keyB = buildIdempotencyKey({
    scope: "approval:appr-123",
    tool: "crm.createDeal",
    args: { amount: 5000, name: "Acme" },
  });
  assert(keyA === keyB, "same approval + tool + args must produce identical keys");
});

run("different approvals produce different keys", () => {
  const keyA = buildIdempotencyKey({
    scope: "approval:appr-1",
    tool: "investor.createFirm",
    args: { name: "Seed VC" },
  });
  const keyB = buildIdempotencyKey({
    scope: "approval:appr-2",
    tool: "investor.createFirm",
    args: { name: "Seed VC" },
  });
  assert(keyA !== keyB, "different approval ids must not collide");
});

run("calendar schedule tool is approval-suggested", () => {
  const tool = getToolDefinition("calendar.scheduleDraft");
  assert(tool !== null, "calendar.scheduleDraft registered");
  assert(tool!.approval === "suggested", "scheduleDraft uses suggested approval");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll approval idempotency smoke tests passed.");
