/**
 * AdeHQ Control — platform admin guard smoke tests (no live DB required).
 */
import { hasPlatformPermission, permissionsForRole } from "../src/lib/admin/permissions";
import { AUDIT_ACTION_META } from "../src/lib/admin/audit";
import { ADMIN_METRIC_DEFINITIONS } from "../src/lib/admin/metrics/definitions";
import { DEFAULT_ADMIN_PRIVACY_LEVELS } from "../src/lib/admin/privacy";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main() {
  await run("super_admin has all permissions", () => {
    const perms = permissionsForRole("super_admin");
    assert(perms.includes("models.write"), "super_admin should include models.write");
    assert(perms.includes("billing.write"), "super_admin should include billing.write");
  });

  await run("readonly_admin cannot write", () => {
    assert(!hasPlatformPermission("readonly_admin", "flags.write"), "readonly cannot write flags");
    assert(hasPlatformPermission("readonly_admin", "audit.read"), "readonly can read audit");
  });

  await run("ops_admin can manage models and flags", () => {
    assert(hasPlatformPermission("ops_admin", "models.write"), "ops can write models");
    assert(hasPlatformPermission("ops_admin", "maintenance.write"), "ops can write maintenance");
    assert(!hasPlatformPermission("ops_admin", "billing.write"), "ops cannot write billing");
  });

  await run("audit actions have severity metadata", () => {
    assert(
      AUDIT_ACTION_META.maintenance_toggle_changed?.severity === "critical",
      "maintenance toggle is critical",
    );
    assert(
      AUDIT_ACTION_META.model_endpoint_disabled?.requiresReason === true,
      "disable endpoint requires reason",
    );
  });

  await run("metric definitions include privacy levels", () => {
    assert(ADMIN_METRIC_DEFINITIONS.ai_cost != null, "ai_cost defined");
    assert(
      ADMIN_METRIC_DEFINITIONS.ai_cost.privacyLevel === "public_operational",
      "ai_cost is public_operational",
    );
  });

  await run("default privacy levels exclude restricted content", () => {
    assert(
      !DEFAULT_ADMIN_PRIVACY_LEVELS.includes("restricted_content"),
      "restricted_content not in default",
    );
  });

  console.log("\nAll platform admin guard tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
