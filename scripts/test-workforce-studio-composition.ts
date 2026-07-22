// PR-21A regression: template composition, JsonLogic safety, canonical
// hashing, and template manifest integrity.
//
// Run: npm run test:workforce-studio:composition

import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { listTemplateManifests } from "../src/lib/hiring/workforce-studio/templates/registry";
import { assertSafeRule, UnsafeJsonLogicRuleError } from "../src/lib/hiring/workforce-studio/json-logic";
import { canonicalHash, canonicalStringify } from "../src/lib/hiring/workforce-studio/canonical";
import type { TemplateManifest } from "../src/lib/hiring/workforce-studio/templates/types";

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

function stripIds<T>(payload: T): T {
  // Structural comparison ignoring freshly-minted ids: replace every id-ish
  // field with a stable placeholder derived from position, not value.
  const json = JSON.stringify(payload, (key, value) => {
    if (key === "id" || key.endsWith("Id") || key.endsWith("Ids")) return "<id>";
    return value;
  });
  return JSON.parse(json);
}

console.log("=== Workforce Studio composition + safety tests ===\n");

// ---------------------------------------------------------------------------
// 1. Template manifest integrity — every referenced templateSeatId/
//    templateRoomId must resolve, every scaling rule condition must be a
//    safe JsonLogic rule.
// ---------------------------------------------------------------------------
function validateManifestIntegrity(manifest: TemplateManifest) {
  const seatIds = new Set([
    ...manifest.baseSeats.map((s) => s.templateSeatId),
    ...manifest.scalingRules.flatMap((r) => (r.addSeats ?? []).map((s) => s.templateSeatId)),
  ]);
  const roomIds = new Set([
    ...manifest.baseRooms.map((r) => r.templateRoomId),
    ...manifest.scalingRules.flatMap((r) => (r.addRooms ?? []).map((rm) => rm.templateRoomId)),
  ]);

  for (const seat of [...manifest.baseSeats, ...manifest.scalingRules.flatMap((r) => r.addSeats ?? [])]) {
    if (seat.primaryRoomTemplateId) {
      assert(
        roomIds.has(seat.primaryRoomTemplateId),
        `[${manifest.key}] seat ${seat.templateSeatId} primaryRoomTemplateId "${seat.primaryRoomTemplateId}" resolves to a known room`,
      );
    }
  }

  for (const edge of [...manifest.baseEdges, ...manifest.scalingRules.flatMap((r) => r.addEdges ?? [])]) {
    assert(
      seatIds.has(edge.fromSeatTemplateId) && seatIds.has(edge.toSeatTemplateId),
      `[${manifest.key}] edge ${edge.fromSeatTemplateId}->${edge.toSeatTemplateId} references known seats`,
    );
  }

  for (const rule of manifest.scalingRules) {
    try {
      assertSafeRule(rule.condition);
      console.log(`✓ [${manifest.key}] scaling rule "${rule.id}" condition is a safe JsonLogic rule`);
    } catch (error) {
      failures += 1;
      console.error(`✗ [${manifest.key}] scaling rule "${rule.id}" condition unsafe: ${(error as Error).message}`);
    }
  }
}

for (const manifest of listTemplateManifests()) {
  validateManifestIntegrity(manifest);
}

// ---------------------------------------------------------------------------
// 2. Software House scaling behavior
// ---------------------------------------------------------------------------
const softwareHouse = listTemplateManifests().find((t) => t.key === "software_house")!;

const leanPayload = composeBlueprintFromTemplate(softwareHouse, { team_size_preference: "lean" }, null);
assert(leanPayload.seats.length === 4, `software_house lean composes exactly base 4 seats (got ${leanPayload.seats.length})`);

const scaledPayload = composeBlueprintFromTemplate(
  softwareHouse,
  { team_size_preference: "scaled", needs_dedicated_devops: "yes", needs_customer_support: "yes" },
  null,
);
assert(
  // base 4 + second backend (scaled) + devops + architect (scaled) + support
  scaledPayload.seats.length === 4 + 4,
  `software_house scaled+devops+support composes 8 seats (got ${scaledPayload.seats.length})`,
);
assert(
  scaledPayload.rooms.some((r) => r.name === "Customer Support"),
  "software_house scaled+support adds the Customer Support room",
);
assert(
  scaledPayload.edges.some((e) => e.type === "escalation"),
  "software_house scaled+support adds an escalation edge",
);

// Every seat must land in at least one room.
for (const payload of [leanPayload, scaledPayload]) {
  const roomedSeatIds = new Set(payload.rooms.flatMap((r) => r.memberSeatIds));
  const orphanSeats = payload.seats.filter((s) => !roomedSeatIds.has(s.id));
  assert(orphanSeats.length === 0, `[${payload.templateKey}] every seat is a member of at least one room`);
}

// Mission text should be interpolated, not leave raw {{placeholders}}.
assert(
  !scaledPayload.seats.some((s) => /\{\{\w+\}\}/.test(s.mission)),
  "software_house mission text has no unresolved {{placeholders}}",
);

// ---------------------------------------------------------------------------
// 3. Determinism — same (manifest, answers) composes structurally identical
//    output aside from freshly minted ids.
// ---------------------------------------------------------------------------
const again = composeBlueprintFromTemplate(softwareHouse, { team_size_preference: "lean" }, null);
assert(
  canonicalStringify(stripIds(leanPayload)) === canonicalStringify(stripIds(again)),
  "software_house lean composition is structurally deterministic across runs",
);

// ---------------------------------------------------------------------------
// 4. SaaS Startup + General Ops sanity
// ---------------------------------------------------------------------------
const saas = listTemplateManifests().find((t) => t.key === "saas_startup")!;
const saasStandard = composeBlueprintFromTemplate(saas, { team_size_preference: "standard" }, null);
assert(saasStandard.seats.length === 5, `saas_startup standard composes 5 base seats (got ${saasStandard.seats.length})`);
const saasScaled = composeBlueprintFromTemplate(saas, { team_size_preference: "scaled", needs_customer_support: "yes" }, null);
assert(
  saasScaled.seats.length === 5 + 2,
  `saas_startup scaled+support composes 7 seats (got ${saasScaled.seats.length})`,
);

const generalOps = listTemplateManifests().find((t) => t.key === "general_ops")!;
const opsStandard = composeBlueprintFromTemplate(
  generalOps,
  { team_size_preference: "standard", needs_automation: "yes", primary_ops_focus: "all" },
  null,
);
assert(
  opsStandard.seats.length === 2 + 3,
  `general_ops standard+automation+all-focus composes 5 seats (got ${opsStandard.seats.length})`,
);

// ---------------------------------------------------------------------------
// 5. JsonLogic safety allowlist
// ---------------------------------------------------------------------------
try {
  assertSafeRule({ "==": [{ var: "answers.x" }, "y"] });
  console.log("✓ allowed JsonLogic rule passes assertSafeRule");
} catch {
  failures += 1;
  console.error("✗ allowed JsonLogic rule incorrectly rejected");
}

try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertSafeRule({ exec: ["rm -rf /"] } as any);
  failures += 1;
  console.error("✗ unsafe operator was NOT rejected");
} catch (error) {
  assert(error instanceof UnsafeJsonLogicRuleError, "unsafe JsonLogic operator is rejected by assertSafeRule");
}

// ---------------------------------------------------------------------------
// 6. Canonical hashing — order independence + change sensitivity
// ---------------------------------------------------------------------------
const a = { seats: [{ id: "1", roleKey: "x" }], templateKey: "t" };
const b = { templateKey: "t", seats: [{ roleKey: "x", id: "1" }] };
assert(canonicalHash(a) === canonicalHash(b), "canonicalHash is key-order independent");

const c = { templateKey: "t", seats: [{ roleKey: "y", id: "1" }] };
assert(canonicalHash(a) !== canonicalHash(c), "canonicalHash changes when payload content changes");

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? "All Workforce Studio composition tests passed." : `${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
