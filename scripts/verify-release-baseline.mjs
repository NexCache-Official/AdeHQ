/**
 * Fail CI/deploy when release baseline is not aligned.
 *
 *   npm run verify:release
 *   BUILD_INFO_URL=https://app.adehq.com/api/build-info npm run verify:release
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const root = process.cwd();

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

console.log("\n=== AdeHQ release baseline verification ===\n");

const head = sh("git rev-parse HEAD");
const branch = sh("git rev-parse --abbrev-ref HEAD");
ok(`local HEAD ${head.slice(0, 12)} on ${branch}`);

// Target commit must be pushed for deploy gates (CI / VERIFY_RELEASE_STRICT=1)
const strict =
  process.env.VERIFY_RELEASE_STRICT === "1" ||
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  Boolean(process.env.BUILD_INFO_URL);
try {
  sh("git fetch --quiet origin 2>/dev/null || true");
  const remotes = sh(`git branch -r --contains ${head} || true`);
  if (!remotes) {
    const msg = `commit ${head.slice(0, 12)} is not pushed to any origin/* ref`;
    if (strict) fail(msg);
    else console.warn(`  · WARN: ${msg}`);
  } else {
    ok("commit is pushed to origin");
  }
} catch (err) {
  if (strict) fail(`could not verify remote push state: ${err.message || err}`);
  else console.warn(`  · WARN: could not verify remote push state`);
}

const catalogSrc = readFileSync(resolve(root, "src/lib/brain/catalog/version.ts"), "utf8");
const catalogMatch = catalogSrc.match(/CATALOG_VERSION\s*=\s*"(\d+)"/);
if (!catalogMatch) fail("CATALOG_VERSION missing");
else ok(`CATALOG_VERSION=${catalogMatch[1]}`);

const manifestSrc = readFileSync(resolve(root, "src/lib/release/manifest.ts"), "utf8");
const requiredMig = manifestSrc.match(/requiredMigrationVersion:\s*"(\d+)"/)?.[1];
const expectedCatalog = manifestSrc.match(/catalogVersion:\s*(\d+)/)?.[1];
if (!requiredMig) fail("requiredMigrationVersion missing from manifest");
else ok(`required migration ${requiredMig}`);

if (catalogMatch && expectedCatalog && catalogMatch[1] !== expectedCatalog) {
  fail(`catalog mismatch runtime=${catalogMatch[1]} manifest=${expectedCatalog}`);
} else if (catalogMatch && expectedCatalog) {
  ok("catalog matches release manifest");
}

const migrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, "").slice(0, 14));
if (!migrations.includes(requiredMig)) {
  fail(`migration ${requiredMig} not present locally`);
} else {
  ok(`migration ${requiredMig} present`);
}

const seed = migrations.some(
  (m) => m.startsWith("20260716190100") || m.startsWith("20260716195000"),
);
if (!seed) fail("brain pricing/catalog seed migrations missing");
else ok("brain catalog/pricing seed migrations present");

// Snapshot / catalog presence in repo
const catalogDir = resolve(root, "src/lib/brain/catalog");
try {
  const files = readdirSync(catalogDir);
  if (!files.length) fail("brain catalog directory empty");
  else ok(`brain catalog modules present (${files.length} files)`);
} catch {
  fail("brain catalog directory missing");
}

const buildInfoUrl = process.env.BUILD_INFO_URL;
if (buildInfoUrl) {
  try {
    const res = await fetch(buildInfoUrl);
    const body = await res.json();
    if (!res.ok) {
      fail(`build-info HTTP ${res.status}: ${JSON.stringify(body.mismatches || body)}`);
    } else {
      ok(`remote build-info ok commit=${String(body.gitCommit || "").slice(0, 12)}`);
      if (
        body.gitCommit &&
        body.gitCommit !== "unknown" &&
        !head.startsWith(body.gitCommit.slice(0, 8))
      ) {
        console.warn(
          `WARN: remote commit ${body.gitCommit.slice(0, 12)} != local ${head.slice(0, 12)}`,
        );
      }
      if (Array.isArray(body.mismatches) && body.mismatches.length) {
        fail(`remote feature mismatches: ${body.mismatches.join("; ")}`);
      }
    }
  } catch (err) {
    fail(`build-info fetch failed: ${err.message || err}`);
  }
} else {
  console.log("  · BUILD_INFO_URL unset — skipping remote production check");
}

if (process.exitCode) {
  console.error("\nRelease baseline verification FAILED.\n");
  process.exit(1);
}
console.log("\nRelease baseline verification passed.\n");
