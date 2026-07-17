/**
 * PR-17.5 unit tests — retry taxonomy, idempotency, circuit breaker, build info.
 */
import { decideRetry } from "../src/lib/brain/reliability/retry-policy";
import { buildStepIdempotencyKey } from "../src/lib/brain/reliability/idempotency";
import {
  getRouteHealth,
  isRouteCircuitOpen,
  recordRouteSample,
} from "../src/lib/brain/reliability/circuit-breaker";
import { getBuildInformation } from "../src/lib/release/build-information";
import { RELEASE_MANIFEST } from "../src/lib/release/manifest";
import { CATALOG_VERSION } from "../src/lib/brain/catalog/version";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-17.5 Brain reliability foundation ===\n");

check(
  "permission denial never retries",
  decideRetry("permission", 0).action === "fail",
);
check(
  "transient provider retries once then fallback",
  decideRetry("transient_provider", 0).action === "retry" &&
    decideRetry("transient_provider", 1).action === "fallback",
);
check(
  "internal errors do not charge user",
  decideRetry("internal_application", 0).action === "fail" &&
    (decideRetry("internal_application", 0) as { chargeUser: boolean }).chargeUser === false,
);

const keyA = buildStepIdempotencyKey({
  workspaceId: "ws",
  brainRunId: "brun_1",
  capability: "search",
  employeeId: "emp_a",
  logicalStepKey: "web:acme",
});
const keyB = buildStepIdempotencyKey({
  workspaceId: "ws",
  brainRunId: "brun_1",
  capability: "search",
  employeeId: "emp_a",
  logicalStepKey: "web:acme",
});
const keyC = buildStepIdempotencyKey({
  workspaceId: "ws",
  brainRunId: "brun_1",
  capability: "search",
  employeeId: "emp_a",
  logicalStepKey: "web:other",
});
check("idempotency key stable", keyA === keyB);
check("idempotency key differs by logical step", keyA !== keyC);

const route = `test_route_${Date.now()}`;
for (let i = 0; i < 10; i++) {
  recordRouteSample(route, {
    ok: false,
    timedOut: true,
    schemaFailed: false,
    latencyMs: 5000,
  });
}
check("circuit opens on sustained timeouts", isRouteCircuitOpen(route));
check("route health exposes timeout rate", getRouteHealth(route).recentTimeoutRate > 0.5);

const info = getBuildInformation({ migrationVersion: RELEASE_MANIFEST.requiredMigrationVersion });
check("catalog version matches manifest", info.catalogVersion === RELEASE_MANIFEST.catalogVersion);
check(
  "runtime catalog string parses",
  Number(CATALOG_VERSION) === RELEASE_MANIFEST.catalogVersion,
);
check("voice/steward expected off in baseline", !info.release.expectedFeatures.voiceV1 && !info.release.expectedFeatures.stewardV1);

console.log(`\n${failed ? `Failed: ${failed}` : "All reliability foundation checks passed."}\n`);
process.exit(failed ? 1 : 0);
