/**
 * Phase 1.5 — Permission, idempotency, and grant-gate tests (no live DB).
 */
import {
  checkEmployeeToolGrant,
  resolveHumanIntegrationPermissions,
  canResolveApprovals,
} from "../src/lib/integrations/permissions";
import { buildIdempotencyKey } from "../src/lib/integrations/tool-runs";
import { getToolDefinition } from "../src/lib/integrations/registry/tool-definitions";
import type { IntegrationEmployee } from "../src/lib/integrations/types";
import type { ToolAccess } from "../src/lib/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let failures = 0;
function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function grant(toolId: string, permission: ToolAccess["permission"]): ToolAccess {
  return { toolId, name: toolId, category: "Business", status: "connected", permission };
}

function employee(tools: ToolAccess[]): IntegrationEmployee {
  return { id: "emp-1", name: "Test", roleKey: "sales", tools };
}

run("member cannot approve integrations", () => {
  const perms = resolveHumanIntegrationPermissions("member");
  assert(!canResolveApprovals("member"), "member should not approve");
  assert(perms.requestViaAi, "member can request via AI");
});

run("guest cannot request via AI", () => {
  const perms = resolveHumanIntegrationPermissions("guest");
  assert(!perms.requestViaAi, "guest blocked");
});

run("manager can approve", () => {
  assert(canResolveApprovals("manager"), "manager ok");
});

run("employee without adehq-crm cannot write CRM", () => {
  const tool = getToolDefinition("crm.createContact")!;
  const result = checkEmployeeToolGrant(employee([]), tool);
  assert(!result.granted, "no grant");
});

run("employee with write grant can create contact", () => {
  const tool = getToolDefinition("crm.createContact")!;
  const result = checkEmployeeToolGrant(employee([grant("adehq-crm", "write")]), tool);
  assert(result.granted, "write grant");
});

run("read-only grant blocks CRM writes", () => {
  const tool = getToolDefinition("crm.createDeal")!;
  const result = checkEmployeeToolGrant(employee([grant("adehq-crm", "read")]), tool);
  assert(!result.granted, "read only");
});

run("artifact tools require drive grant", () => {
  const tool = getToolDefinition("artifact.createSpreadsheet")!;
  const blocked = checkEmployeeToolGrant(employee([grant("adehq-crm", "write")]), tool);
  assert(!blocked.granted, "crm grant does not cover artifacts");
  const ok = checkEmployeeToolGrant(employee([grant("adehq-drive", "write")]), tool);
  assert(ok.granted, "drive grant covers artifacts");
});

run("idempotency keys stable across arg order", () => {
  const a = buildIdempotencyKey({
    scope: "scope-1",
    tool: "crm.createContact",
    args: { firstName: "A", lastName: "B" },
  });
  const b = buildIdempotencyKey({
    scope: "scope-1",
    tool: "crm.createContact",
    args: { lastName: "B", firstName: "A" },
  });
  assert(a === b, "keys must match");
});

run("different scope yields different idempotency key", () => {
  const a = buildIdempotencyKey({
    scope: "scope-1",
    tool: "crm.createContact",
    args: { firstName: "A" },
  });
  const b = buildIdempotencyKey({
    scope: "scope-2",
    tool: "crm.createContact",
    args: { firstName: "A" },
  });
  assert(a !== b, "scopes differ");
});

if (failures > 0) {
  console.error(`\n${failures} permission test(s) failed.`);
  process.exit(1);
}
console.log("\nAll permission/idempotency tests passed.");
