/**
 * WH overage → offline policy helpers.
 *   npm run test:workforce-wh-offline
 */
import { checkWorkspaceAiCapacity, applyCostToPeriod } from "../src/lib/billing/usage/periods";
import {
  setWorkforceOffline,
  restoreWorkforceFromOffline,
  setWorkforceOfflineIncludingWorking,
} from "../src/lib/billing/usage/workforce-capacity";
import { effectiveEmployeeStatus } from "../src/lib/maya-employee";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`  ✓ ${name}`);
}

function main() {
  console.log("\n=== WH offline policy ===\n");

  check("checkWorkspaceAiCapacity export", typeof checkWorkspaceAiCapacity === "function");
  check("applyCostToPeriod export", typeof applyCostToPeriod === "function");
  check("setWorkforceOffline export", typeof setWorkforceOffline === "function");
  check("restoreWorkforceFromOffline export", typeof restoreWorkforceFromOffline === "function");
  check(
    "setWorkforceOfflineIncludingWorking export",
    typeof setWorkforceOfflineIncludingWorking === "function",
  );

  check(
    "Maya offline when persisted offline",
    effectiveEmployeeStatus({
      id: "emp-maya",
      systemEmployeeKey: "maya_recruiting_manager",
      status: "offline",
    }) === "offline",
  );
  check(
    "idle displays as online when capacity available",
    effectiveEmployeeStatus({
      id: "emp-1",
      status: "idle",
    }) === "online",
  );

  console.log("\nAll WH offline policy checks passed.\n");
}

main();
