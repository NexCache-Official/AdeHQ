/**
 * Phase 1.5 — Live Supabase E2E matrix for the internal tool loop.
 *
 * Runs the full Sales employee tool chain against a real workspace using the
 * service role (bypasses HTTP auth). SKIPs cleanly when env is missing.
 *
 * Usage:
 *   npm run test:integration-loop:e2e
 *   ADEHQ_E2E_WORKSPACE_ID=<uuid> npm run test:integration-loop:e2e
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runToolCall } from "../src/lib/integrations/executor/tool-executor";
import { processIntegrationJob } from "../src/lib/integrations/jobs/worker";
import { syncEmployeeCapabilityGrants } from "../src/lib/integrations/employee-capabilities";
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
    roleKey: (sales.role_key as IntegrationEmployee["roleKey"]) ?? "sales",
    tools: toolRows,
  };
}

async function findRoom(client: SupabaseClient, workspaceId: string, employeeId: string) {
  const { data: member } = await client
    .from("room_members")
    .select("room_id")
    .eq("workspace_id", workspaceId)
    .eq("member_type", "ai")
    .eq("member_id", employeeId)
    .limit(1)
    .maybeSingle();
  if (member?.room_id) return String(member.room_id);

  const { data: room } = await client
    .from("rooms")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();
  return room?.id ? String(room.id) : null;
}

async function pollJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
  attempts = 12,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < attempts; i++) {
    const processed = await processIntegrationJob(client, workspaceId, jobId);
    if (processed?.status === "success") {
      return (processed.result as Record<string, unknown>) ?? {};
    }
    if (processed?.status === "failed") {
      throw new Error(processed.errorMessage ?? "Job failed");
    }

    const { data: row } = await client
      .from("integration_jobs")
      .select("status, result, error_message")
      .eq("workspace_id", workspaceId)
      .eq("id", jobId)
      .maybeSingle();
    if (row?.status === "success") {
      return (row.result as Record<string, unknown>) ?? {};
    }
    if (row?.status === "failed") {
      throw new Error(String(row.error_message ?? "Job failed"));
    }

    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function main() {
  loadEnvLocalIfPresent();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) skip("NEXT_PUBLIC_SUPABASE_URL not configured");
  if (!serviceKey) skip("SUPABASE_SERVICE_ROLE_KEY not configured");

  const client = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const workspaceId =
    process.env.ADEHQ_E2E_WORKSPACE_ID?.trim() ??
    (
      await client.from("workspaces").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle()
    ).data?.id;

  if (!workspaceId) skip("No workspace found — set ADEHQ_E2E_WORKSPACE_ID");

  console.log(`\nIntegration Tool Loop E2E — workspace ${workspaceId}\n`);

  // Migration guard + seed internal catalog tools if migration not applied yet
  const { error: tableCheck } = await client.from("integration_tool_runs").select("id").limit(1);
  if (
    tableCheck &&
    (tableCheck.code === "42P01" ||
      tableCheck.code === "PGRST205" ||
      tableCheck.message.includes("integration_tool_runs"))
  ) {
    skip(
      "integration_tool_runs table missing — run: npx supabase db push (migration 20260707000000_integration_tool_execution_core.sql)",
    );
  }

  const catalogTools = [
    { id: "adehq-crm", name: "AdeHQ CRM", category: "Business", description: "CRM", status: "connected" },
    { id: "adehq-email", name: "AdeHQ Email Drafts", category: "Communication", description: "Email", status: "connected" },
    { id: "adehq-tasks", name: "AdeHQ Tasks", category: "Productivity", description: "Tasks", status: "connected" },
    { id: "adehq-drive", name: "AdeHQ Drive", category: "Storage", description: "Drive", status: "connected" },
  ];
  const { error: seedToolsError } = await client.from("tools").upsert(catalogTools, { onConflict: "id" });
  if (seedToolsError && !seedToolsError.message.includes("does not exist")) {
    console.warn("[e2e] tools catalog seed warning:", seedToolsError.message);
  }

  let employee = await findSalesEmployee(client, workspaceId as string);
  if (!employee) skip("No AI employee in workspace");

  const roomId = await findRoom(client, workspaceId as string, employee.id);
  if (!roomId) skip("No room found for employee");

  // Ensure capability grants
  await syncEmployeeCapabilityGrants(client, workspaceId as string, employee.id, [
    "crm",
    "email",
    "tasks",
    "drive",
    "artifact",
  ]);

  const { data: toolsAfter } = await client
    .from("employee_tools")
    .select("tool_id, permission")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employee.id);
  employee = {
    ...employee,
    tools: (toolsAfter ?? []).map((t) => ({
      toolId: String(t.tool_id),
      name: String(t.tool_id),
      category: "Business",
      status: "connected" as const,
      permission: (t.permission as ToolAccess["permission"]) ?? "write",
    })),
  };

  const tag = `e2e-${Date.now()}`;
  const ctx = {
    client,
    workspaceId: workspaceId as string,
    employeeId: employee.id,
    employeeName: employee.name,
    roomId,
    topicId: undefined,
    agentRunId: uid("run"),
    triggerMessageId: uid("msg"),
  };

  const results: Record<string, { toolRunId?: string; objectId?: string; jobId?: string }> = {};

  async function execTool(
    key: string,
    tool: string,
    args: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    const outcome = await runToolCall(
      client,
      ctx,
      { tool, mode: "execute", args, employeeId: employee!.id, idempotencyKey },
      { employee: employee! },
    );
    check(`${key} status`, outcome.status === "success" || outcome.status === "queued", outcome.error);
    if (outcome.toolRunId) {
      const { data: run } = await client
        .from("integration_tool_runs")
        .select("status, cost_usd, work_minutes, error_message")
        .eq("workspace_id", workspaceId)
        .eq("id", outcome.toolRunId)
        .maybeSingle();
      check(`${key} tool_run row`, Boolean(run), "missing integration_tool_runs");
      if (run) {
        check(`${key} cost recorded`, run.cost_usd != null && run.work_minutes != null);
        if (outcome.status === "failed") {
          check(`${key} error_message`, Boolean(run.error_message));
        }
      }
    }
    if (outcome.status === "queued" && outcome.jobId) {
      const jobResult = await pollJob(client, workspaceId as string, outcome.jobId);
      check(`${key} async job completed`, Boolean(jobResult));
      results[key] = {
        toolRunId: outcome.toolRunId,
        objectId: jobResult?.artifactId ? String(jobResult.artifactId) : undefined,
        jobId: outcome.jobId,
      };
      return outcome;
    }
    results[key] = {
      toolRunId: outcome.toolRunId,
      objectId: outcome.output?.objectId,
    };
    return outcome;
  }

  console.log("1. Sales tool chain\n");

  const companyOutcome = await execTool("createCompany", "crm.createCompany", {
    name: `E2E Corp ${tag}`,
    domain: `${tag}.example.com`,
    industry: "Software",
  });
  const companyId = companyOutcome.output?.objectId;

  const contactOutcome = await execTool("createContact", "crm.createContact", {
    firstName: "E2E",
    lastName: `Lead ${tag}`,
    email: `${tag}@example.com`,
    companyName: `E2E Corp ${tag}`,
  });
  const contactId = contactOutcome.output?.objectId;

  await execTool("createDeal", "crm.createDeal", {
    name: `E2E Deal ${tag}`,
    amount: 4200,
    currency: "USD",
    stage: "Qualified",
    contactName: `E2E Lead ${tag}`,
    companyName: `E2E Corp ${tag}`,
  });

  await execTool("emailDraft", "email.createDraft", {
    subject: `Follow up — ${tag}`,
    body: `Hi E2E,\n\nThanks for your interest in AdeHQ.\n\nBest,\n${employee.name}`,
    recipientName: `E2E Lead ${tag}`,
    recipientEmail: `${tag}@example.com`,
  });

  await execTool("createTask", "tasks.createTask", {
    title: `Follow up E2E lead ${tag}`,
    priority: "high",
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  });

  await execTool("spreadsheet", "artifact.createSpreadsheet", {
    title: `Pipeline ${tag}`,
    columns: ["Company", "Stage", "Amount"],
    rows: [[`E2E Corp ${tag}`, "Qualified", 4200]],
  });

  await execTool("pdfReport", "artifact.createPdfReport", {
    title: `E2E Summary ${tag}`,
    summary: "Automated integration loop test report.",
    sections: [{ heading: "Highlights", body: "All tools executed in sequence." }],
  });

  console.log("\n2. CRM verification\n");

  const { data: contactRow } = await client
    .from("crm_contacts")
    .select("id, email")
    .eq("workspace_id", workspaceId)
    .ilike("email", `%${tag}%`)
    .maybeSingle();
  check("CRM contact exists", Boolean(contactRow));

  const { data: dealRow } = await client
    .from("crm_deals")
    .select("id, amount")
    .eq("workspace_id", workspaceId)
    .ilike("name", `%${tag}%`)
    .maybeSingle();
  check("CRM deal exists", Boolean(dealRow));

  console.log("\n3. Work log verification\n");

  const { data: workLogs } = await client
    .from("work_log_events")
    .select("id, action, status, tool_used")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employee.id)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(20);
  check("work log entries written", (workLogs ?? []).length > 0, `found ${workLogs?.length ?? 0}`);

  console.log("\n4. Drive / artifact verification\n");

  const artifactId = results.spreadsheet?.objectId ?? results.pdfReport?.objectId;
  if (artifactId) {
    const { data: artifact } = await client
      .from("artifacts")
      .select("id, title, status")
      .eq("workspace_id", workspaceId)
      .eq("id", artifactId)
      .maybeSingle();
    check("artifact row exists", Boolean(artifact));

    const { data: exportRow } = await client
      .from("drive_exports")
      .select("id, storage_path, size_bytes")
      .eq("workspace_id", workspaceId)
      .contains("source_artifact_ids", [artifactId])
      .maybeSingle();
    check("drive export exists", Boolean(exportRow));
  } else {
    check("artifact id captured from async job", false);
  }

  console.log("\n5. Idempotency — duplicate contact must not create second row\n");

  const dupe = await runToolCall(
    client,
    ctx,
    {
      tool: "crm.createContact",
      mode: "execute",
      args: {
        firstName: "E2E",
        lastName: `Lead ${tag}`,
        email: `${tag}@example.com`,
      },
      employeeId: employee.id,
      idempotencyKey: `e2e-idem-${tag}`,
    },
    { employee },
  );
  const { count: contactCount } = await client
    .from("crm_contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .ilike("email", `%${tag}%`);
  check("idempotent contact — single row", (contactCount ?? 0) <= 1, `count=${contactCount}`);
  check(
    "idempotent tool result",
    Boolean(
      dupe.status === "success" &&
        (dupe.output?.summary?.includes("Already done") ||
          dupe.output?.summary?.includes("reused existing")),
    ),
    dupe.output?.summary,
  );

  console.log("\n6. Permission gate — employee without CRM grant blocked\n");

  const blockedEmployee: IntegrationEmployee = {
    id: employee.id,
    name: employee.name,
    roleKey: "sales",
    tools: [],
  };
  const blocked = await runToolCall(
    client,
    ctx,
    {
      tool: "crm.createContact",
      mode: "execute",
      args: { firstName: "Blocked", lastName: "Test" },
      employeeId: employee.id,
    },
    { employee: blockedEmployee },
  );
  check("blocked without grant", blocked.status === "blocked", blocked.error);

  console.log("\n---\n");
  if (failures > 0) {
    console.error(`FAILED: ${failures} check(s) did not pass.`);
    process.exit(1);
  }
  console.log("All integration loop E2E checks passed.");
  console.log(`\nManual UI checklist (same workspace):`);
  console.log(`  • Open /crm — contact "${tag}@example.com" and deal visible`);
  console.log(`  • Open /work-log — entries with deep links`);
  console.log(`  • Open /drive — spreadsheet/PDF export`);
  console.log(`  • Open /admin/tool-runs — filter workspace ${workspaceId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
