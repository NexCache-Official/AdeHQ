/**
 * Integration Layer — Tool Execution Core smoke tests (no live DB required).
 * Exercises the deterministic pure logic: registry, arg validation, preview
 * building, permission gates, cost hooks, and idempotency-key determinism.
 */
import { getToolDefinition, listToolDefinitions } from "../src/lib/integrations/registry/tool-definitions";
import {
  checkEmployeeToolGrant,
  resolveHumanIntegrationPermissions,
  canResolveApprovals,
} from "../src/lib/integrations/permissions";
import { estimateToolRunCost } from "../src/lib/integrations/cost";
import { buildIdempotencyKey, canonicalJson } from "../src/lib/integrations/tool-runs";
import { suggestedCapabilityToolIds } from "../src/lib/integrations/registry/prefab-toolsets";
import { buildIntegrationToolsPrompt } from "../src/lib/integrations/prompt";
import type { ToolAccess } from "../src/lib/types";
import type { IntegrationEmployee } from "../src/lib/integrations/types";

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

function grant(toolId: string, permission: ToolAccess["permission"]): ToolAccess {
  return { toolId, name: toolId, category: "Business", status: "connected", permission };
}

function salesEmployee(tools: ToolAccess[]): IntegrationEmployee {
  return { id: "emp-sales", name: "Nova Sales", roleKey: "sales", tools };
}

// ---------------------------------------------------------------------------

run("registry exposes the Sales slice tools", () => {
  for (const name of [
    "crm.createContact",
    "crm.createCompany",
    "crm.createDeal",
    "crm.updateDealStage",
    "crm.listContacts",
    "crm.listDeals",
    "email.createDraft",
    "tasks.createTask",
  ]) {
    assert(getToolDefinition(name) !== null, `missing tool ${name}`);
  }
  assert(getToolDefinition("crm.deleteEverything") === null, "unknown tool must be null");
});

run("arg schemas reject bad input and accept good input", () => {
  const contact = getToolDefinition("crm.createContact")!;
  assert(!contact.argsSchema.safeParse({}).success, "empty contact args must fail");
  assert(
    contact.argsSchema.safeParse({ firstName: "Neil", companyName: "Acme" }).success,
    "valid contact args must pass",
  );
  const deal = getToolDefinition("crm.createDeal")!;
  assert(!deal.argsSchema.safeParse({ amount: -5 }).success, "negative amount + no name must fail");
  assert(deal.argsSchema.safeParse({ name: "Acme deal", amount: 5000 }).success, "valid deal must pass");
});

run("preview builds human-readable cards with currency formatting", () => {
  const deal = getToolDefinition("crm.createDeal")!;
  const preview = deal.buildPreview({ name: "Acme — annual", amount: 5000, currency: "GBP", stage: "Qualified" });
  assert(preview.title.includes("Acme"), "title mentions the deal");
  assert(preview.risk === "medium", "deal is medium risk");
  const amountField = preview.fields.find((f) => f.label === "Amount");
  assert(!!amountField && amountField.value.includes("5,000"), "amount formatted with separators");
});

run("approval policy: internal writes execute, reads none, drafts none", () => {
  assert(getToolDefinition("crm.createDeal")!.approval === "none", "internal deal creation runs immediately");
  assert(getToolDefinition("crm.listContacts")!.approval === "none", "reads need no approval");
  assert(getToolDefinition("crm.listContacts")!.readOnly, "listContacts is read-only");
  assert(getToolDefinition("email.createDraft")!.approval === "none", "drafts run immediately");
});

run("employee grant gate: no grant blocks, read grant blocks writes, write allows", () => {
  const contactTool = getToolDefinition("crm.createContact")!;
  const listTool = getToolDefinition("crm.listContacts")!;

  const noGrant = salesEmployee([]);
  assert(!checkEmployeeToolGrant(noGrant, contactTool).granted, "no grant must block");

  const readOnly = salesEmployee([grant("adehq-crm", "read")]);
  assert(!checkEmployeeToolGrant(readOnly, contactTool).granted, "read grant must block write tool");
  assert(checkEmployeeToolGrant(readOnly, listTool).granted, "read grant allows read-only tool");

  const writeGrant = salesEmployee([grant("adehq-crm", "write")]);
  assert(checkEmployeeToolGrant(writeGrant, contactTool).granted, "write grant allows write tool");

  const noneGrant = salesEmployee([grant("adehq-crm", "none")]);
  assert(!checkEmployeeToolGrant(noneGrant, listTool).granted, "permission none must block");
});

run("human role gates: members draft/request, cannot approve; managers+ approve", () => {
  assert(resolveHumanIntegrationPermissions("member").requestViaAi, "members can request via AI");
  assert(!resolveHumanIntegrationPermissions("member").approveExternalActions, "members cannot approve");
  assert(!canResolveApprovals("member"), "members cannot resolve approvals");
  assert(canResolveApprovals("manager"), "managers can resolve approvals");
  assert(canResolveApprovals("admin"), "admins can resolve approvals");
  assert(canResolveApprovals("owner"), "owners can resolve approvals");
  assert(!resolveHumanIntegrationPermissions("guest").requestViaAi, "guests are read-only");
  assert(resolveHumanIntegrationPermissions("owner").integrationsAdmin, "owners are integrations admins");
  assert(!resolveHumanIntegrationPermissions("manager").integrationsAdmin, "managers are not integrations admins");
});

run("cost hooks: preview is free, execute records table values", () => {
  assert(estimateToolRunCost("crm.createContact", "preview").costUsd === 0, "preview is free");
  assert(estimateToolRunCost("crm.createContact", "preview").workMinutes === 0, "preview 0 minutes");
  const draft = estimateToolRunCost("email.createDraft", "execute");
  assert(draft.workMinutes >= 0, "draft records work minutes >= 0");
  const unknown = estimateToolRunCost("crm.mystery", "execute");
  assert(unknown.costUsd === 0 && unknown.workMinutes === 0, "unknown tool defaults to zero");
});

run("idempotency keys are deterministic and order-insensitive on args", () => {
  const a = buildIdempotencyKey({ scope: "approval:x", tool: "crm.createDeal", args: { name: "A", amount: 5000 } });
  const b = buildIdempotencyKey({ scope: "approval:x", tool: "crm.createDeal", args: { amount: 5000, name: "A" } });
  assert(a === b, "key must be stable regardless of arg key order");
  const c = buildIdempotencyKey({ scope: "approval:x", tool: "crm.createDeal", args: { name: "B", amount: 5000 } });
  assert(a !== c, "different args must produce a different key");
  const d = buildIdempotencyKey({ scope: "approval:y", tool: "crm.createDeal", args: { name: "A", amount: 5000 } });
  assert(a !== d, "different scope must produce a different key");
});

run("canonicalJson sorts keys and drops undefined", () => {
  assert(canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}', "keys sorted");
  assert(canonicalJson({ a: undefined, b: 1 }) === '{"b":1}', "undefined dropped");
  assert(canonicalJson([3, 1, 2]) === "[3,1,2]", "array order preserved");
});

run("prefab toolsets suggest CRM+email+tasks for sales", () => {
  const ids = suggestedCapabilityToolIds("sales");
  assert(ids.includes("adehq-crm"), "sales gets CRM");
  assert(ids.includes("adehq-email"), "sales gets email");
  assert(ids.includes("adehq-tasks"), "sales gets tasks");
  assert(suggestedCapabilityToolIds("recruiting_manager").length === 0, "Maya gets no business tools");
});

run("prompt block lists granted tools and falls back to prefab", () => {
  const withGrant = buildIntegrationToolsPrompt(salesEmployee([grant("adehq-crm", "write")]));
  assert(withGrant.includes("crm.createDeal"), "granted CRM tools appear in prompt");
  assert(!withGrant.includes("email.createDraft"), "ungranted email tool omitted");

  const noGrant = buildIntegrationToolsPrompt(salesEmployee([]));
  assert(noGrant.includes("crm.createContact"), "no-grant sales falls back to prefab CRM");
  assert(noGrant.includes("email.createDraft"), "no-grant sales falls back to prefab email");

  const maya = buildIntegrationToolsPrompt({ id: "maya", name: "Maya", roleKey: "recruiting_manager", tools: [] });
  assert(maya === "", "Maya with no tools gets an empty block");
});

run("all registered tools have prompt usage docs and preview builders", () => {
  for (const tool of listToolDefinitions()) {
    assert(tool.promptUsage.length > 0, `${tool.name} missing promptUsage`);
    assert(typeof tool.buildPreview === "function", `${tool.name} missing buildPreview`);
    assert(tool.name.includes("."), `${tool.name} must be namespaced`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Tool Execution Core logic tests passed.");
