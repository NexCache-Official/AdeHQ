/**
 * Tool arg repair tests — no DB required.
 *
 * Usage:
 *   npx tsx scripts/test-coerce-tool-args.ts
 */

import { coerceToolCall } from "../src/lib/integrations/coerce-tool-args";
import {
  createToolHydrationState,
  hydrateToolCallArgs,
  observeToolCallResult,
} from "../src/lib/integrations/hydrate-tool-args";
import { getToolDefinition } from "../src/lib/integrations/registry/tool-definitions";
import type { ToolCallResult } from "../src/lib/integrations/types";

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

run("lifts flat root fields into args", () => {
  const call = coerceToolCall("crm.createCompany", {
    tool: "crm.createCompany",
    mode: "execute",
    name: "GreenEdge Robotics",
  });
  assert(call.args.name === "GreenEdge Robotics", "name should be lifted");
  assert(getToolDefinition(call.tool)!.argsSchema.safeParse(call.args).success, "schema should pass");
});

run("maps snake_case aliases and splits contact names", () => {
  const call = coerceToolCall("crm.createContact", {
    tool: "crm.createContact",
    args: { full_name: "Praveen Kumar", company_name: "GreenEdge Robotics" },
  });
  assert(call.args.firstName === "Praveen", "firstName alias/split missing");
  assert(call.args.lastName === "Kumar", "lastName split missing");
  assert(call.args.companyName === "GreenEdge Robotics", "company alias missing");
  assert(getToolDefinition(call.tool)!.argsSchema.safeParse(call.args).success, "schema should pass");
});

run("coerces money strings and spreadsheet JSON", () => {
  const deal = coerceToolCall("crm.createDeal", {
    tool: "crm.createDeal",
    args: { company_name: "GreenEdge Robotics", amount: "£5,000", stage: "qualified" },
  });
  assert(deal.args.amount === 5000, "amount should be numeric");
  assert(deal.args.currency === "GBP", "currency should be GBP");
  assert(deal.args.stage === "Qualified", "stage should be title-cased");

  const sheet = coerceToolCall("artifact.createSpreadsheet", {
    tool: "artifact.createSpreadsheet",
    args: {
      title: "Pipeline",
      columns: "Company, Contact, Amount",
      rows: '[["GreenEdge Robotics","Praveen",5000]]',
    },
  });
  assert(Array.isArray(sheet.args.columns), "columns should be array");
  assert(Array.isArray(sheet.args.rows), "rows should be array");
  assert(getToolDefinition(sheet.tool)!.argsSchema.safeParse(sheet.args).success, "sheet schema should pass");
});

run("hydrates the GreenEdge six-tool bundle from empty args", () => {
  const userMessage =
    "Create a company called GreenEdge Robotics, add Praveen as the contact, log a £5,000 qualified deal, draft an outreach email, create a follow-up task, and make a spreadsheet summary.";
  const state = createToolHydrationState(userMessage);
  const tools = [
    "crm.createCompany",
    "crm.createContact",
    "crm.createDeal",
    "email.createDraft",
    "tasks.createTask",
    "artifact.createSpreadsheet",
  ];

  for (const tool of tools) {
    const args = hydrateToolCallArgs(tool, {}, { userMessage, state });
    const parsed = getToolDefinition(tool)!.argsSchema.safeParse(args);
    assert(parsed.success, `${tool} should hydrate into valid args`);
    const result: ToolCallResult = {
      status: tool === "artifact.createSpreadsheet" ? "queued" : "success",
      tool,
      mode: "execute",
      costUsd: 0,
      workMinutes: 0,
      output: { summary: "ok", payload: args },
      messageArtifacts: [],
    };
    observeToolCallResult(tool, args, result, state);
  }

  assert(state.companyName === "GreenEdge Robotics", "company should be retained");
  assert(state.contactName === "Praveen", "contact should be retained");
  assert(state.amount === 5000, "amount should be retained");
});

run("hydrates Calendar and document artifacts", () => {
  const userMessage = "Create a campaign called July launch and make a short launch deck.";
  const state = createToolHydrationState(userMessage);
  const campaign = hydrateToolCallArgs("calendar.createCampaign", {}, { userMessage, state });
  assert(getToolDefinition("calendar.createCampaign")!.argsSchema.safeParse(campaign).success, "campaign valid");
  const deck = hydrateToolCallArgs("artifact.createPresentation", {}, { userMessage, state });
  assert(getToolDefinition("artifact.createPresentation")!.argsSchema.safeParse(deck).success, "deck valid");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}

console.log("\nAll tool arg repair tests passed.");
