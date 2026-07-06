/**
 * Integration chat path E2E — verifies tool calls produce visible receipt artifacts
 * and that memory curator suppresses transactional activity logs.
 *
 * Usage:
 *   npm run test:integration-chat:e2e
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { executeEmployeeToolCalls } from "../src/lib/integrations/manager";
import { mergeToolOutcomeArtifacts } from "../src/lib/integrations/tool-outcome-artifacts";
import {
  filterMemorySuggestions,
  isDurableMemorySuggestion,
} from "../src/lib/memory/curator";
import { ensureDefaultEmployeeToolGrants } from "../src/lib/integrations/permissions";
import type { IntegrationEmployee } from "../src/lib/integrations/types";
import type { ToolAccess } from "../src/lib/types";
import { uid } from "../src/lib/utils";

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function skip(reason: string): never {
  console.log(`SKIPPED: ${reason}`);
  process.exit(0);
}

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function findSalesEmployee(
  client: SupabaseClient,
  workspaceId: string,
): Promise<IntegrationEmployee | null> {
  const { data: employees, error } = await client
    .from("ai_employees")
    .select("id, name, role_key")
    .eq("workspace_id", workspaceId);
  if (error) throw error;

  const sales =
    employees?.find((e) => e.role_key === "sales") ??
    employees?.find((e) => String(e.name).toLowerCase().includes("sales")) ??
    employees?.[0];
  if (!sales) return null;

  const { data: tools } = await client
    .from("employee_tools")
    .select("tool_id, status, permission, last_used_at")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", sales.id);

  const toolRows: ToolAccess[] = (tools ?? []).map((t) => ({
    toolId: String(t.tool_id),
    name: String(t.tool_id),
    category: "Business",
    status: "connected",
    permission: (t.permission as ToolAccess["permission"]) ?? "write",
    lastUsedAt: t.last_used_at ? String(t.last_used_at) : undefined,
  }));

  return {
    id: String(sales.id),
    name: String(sales.name),
    roleKey: sales.role_key as IntegrationEmployee["roleKey"],
    tools: toolRows,
  };
}

async function main() {
  loadEnvLocalIfPresent();

  console.log("\n=== Memory curator (unit) ===");
  check(
    "suppresses CRM setup activity log",
    !isDurableMemorySuggestion({
      text: "GreenEdge Robotics CRM setup started: company created, contact added, deal in preview",
    }),
  );
  check(
    "allows durable account context",
    isDurableMemorySuggestion({
      text: "GreenEdge Robotics is a target account for Shubham's robotic lawnmower sales pipeline.",
    }),
  );
  check(
    "filterMemorySuggestions removes transactional items",
    filterMemorySuggestions([
      { text: "Created contact Praveen and deal for GreenEdge" },
      { text: "Shubham prefers concise, direct sales outreach tone." },
    ]).length === 1,
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.ADEHQ_E2E_WORKSPACE_ID;

  if (!url || !serviceKey) {
    skip("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!workspaceId) {
    skip("Missing ADEHQ_E2E_WORKSPACE_ID — set in .env.local for live chat tool path test");
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  let employee = await findSalesEmployee(client, workspaceId);
  if (!employee) skip("No AI employee found in workspace");

  employee = await ensureDefaultEmployeeToolGrants(client, workspaceId, employee);

  const { data: room } = await client
    .from("rooms")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", "%dm%")
    .limit(1)
    .maybeSingle();

  const roomId = room?.id ? String(room.id) : uid("room");
  const topicId = uid("topic");
  const triggerMessageId = uid("msg");

  console.log("\n=== GreenEdge tool chain (executeEmployeeToolCalls) ===");

  const toolCalls = [
    {
      tool: "crm.createCompany",
      mode: "execute" as const,
      args: { name: "GreenEdge Robotics E2E Test" },
    },
    {
      tool: "crm.createContact",
      mode: "execute" as const,
      args: { firstName: "Praveen", companyName: "GreenEdge Robotics E2E Test" },
    },
    {
      tool: "crm.createDeal",
      mode: "execute" as const,
      args: {
        name: "GreenEdge — pilot",
        amount: 5000,
        currency: "GBP",
        stage: "Qualified",
        contactName: "Praveen",
        companyName: "GreenEdge Robotics E2E Test",
      },
    },
    {
      tool: "email.createDraft",
      mode: "execute" as const,
      args: {
        subject: "Quick intro — GreenEdge Robotics",
        body: "Hi Praveen,\n\nReaching out about GreenEdge Robotics…",
        recipientName: "Praveen",
        recipientOrganization: "GreenEdge Robotics E2E Test",
      },
    },
    {
      tool: "tasks.createTask",
      mode: "execute" as const,
      args: {
        title: "Follow up with Praveen if no reply in 3 days",
        description: "GreenEdge Robotics outreach follow-up",
      },
    },
    {
      tool: "artifact.createSpreadsheet",
      mode: "execute" as const,
      args: {
        title: "GreenEdge pipeline summary",
        columns: ["Company", "Contact", "Stage", "Amount"],
        rows: [["GreenEdge Robotics E2E Test", "Praveen", "Qualified", 5000]],
      },
    },
  ];

  const outcome = await executeEmployeeToolCalls(client, {
    workspaceId,
    employee,
    roomId,
    topicId,
    triggerMessageId,
    toolCalls,
  });

  const artifacts = mergeToolOutcomeArtifacts(
    outcome.results,
    outcome.messageArtifacts,
  );

  const types = artifacts.map((a) => a.type);
  const toolResults = artifacts.filter((a) => a.type === "tool_result");
  const crmCards = artifacts.filter((a) => a.type.startsWith("crm_"));

  check("all tool calls returned results", outcome.results.length === toolCalls.length);
  check(
    "company tool succeeded",
    outcome.results.some((r) => r.tool === "crm.createCompany" && r.status === "success"),
  );
  check(
    "deal tool succeeded (execute, not preview)",
    outcome.results.some((r) => r.tool === "crm.createDeal" && r.status === "success"),
  );
  check(
    "spreadsheet queued or succeeded",
    outcome.results.some(
      (r) =>
        r.tool === "artifact.createSpreadsheet" &&
        (r.status === "queued" || r.status === "success"),
    ),
  );
  check("CRM inline cards present", crmCards.length >= 2, `got ${crmCards.length}`);
  check(
    "task or email receipt cards present",
    toolResults.some((a) => a.meta?.toolStatus === "success"),
    `tool_result types: ${toolResults.map((a) => a.label).join("; ")}`,
  );
  check(
    "queued spreadsheet receipt when async",
    outcome.results.some((r) => r.tool === "artifact.createSpreadsheet" && r.status === "queued")
      ? toolResults.some((a) => a.meta?.toolStatus === "queued")
      : true,
  );

  const { count: toolRunCount } = await client
    .from("integration_tool_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("trigger_message_id", triggerMessageId);

  check("integration_tool_runs rows written", (toolRunCount ?? 0) >= toolCalls.length - 1);

  console.log("\n=== Receipt artifact labels ===");
  for (const a of artifacts) {
    console.log(`  · [${a.type}] ${a.label}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll integration chat path checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
