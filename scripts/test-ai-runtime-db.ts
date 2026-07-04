/**
 * V19.9.0b — AI work unit DB helper smoke test.
 * SKIPs cleanly when Supabase service role is unavailable.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  cancelAiWorkUnit,
  completeAiWorkUnit,
  createAiWorkUnit,
  getAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";

function skip(reason: string) {
  console.log(`SKIPPED: ${reason}`);
  process.exit(0);
}

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
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

async function main() {
  loadEnvLocalIfPresent();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) skip("NEXT_PUBLIC_SUPABASE_URL not configured");
  if (!serviceKey) skip("SUPABASE_SERVICE_ROLE_KEY not configured");

  const client = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: workspace, error: wsError } = await client
    .from("workspaces")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (wsError) {
    if (
      wsError.message.includes("ai_work_units") ||
      wsError.code === "42P01"
    ) {
      skip("Database tables not ready — apply migration 20260705120000_ai_runtime_v2_foundation.sql");
    }
    throw wsError;
  }

  if (!workspace?.id) skip("No workspace found to test against");

  const workspaceId = workspace!.id as string;
  console.log(`Testing ai_work_units against workspace ${workspaceId}\n`);

  const created = await createAiWorkUnit(client, {
    workspaceId,
    workType: "runtime_db_smoke_test",
    capability: "classification",
    objective: "V19.9.0b work unit helper smoke test",
    metadata: { test: true, slice: "V19.9.0b" },
  });
  console.log(`Created work unit: ${created.id} (${created.status})`);

  const running = await startAiWorkUnit(client, workspaceId, created.id, {
    providerRoute: "mock",
    providerName: "mock",
    modelId: "mock-balanced",
    runtimeMode: "balanced",
  });
  console.log(`Started work unit: ${running.status}`);

  const completed = await completeAiWorkUnit(client, workspaceId, created.id, {
    actualCostUsd: 0,
    actualWorkMinutes: 1,
  });
  console.log(`Completed work unit: ${completed.status}`);

  const fetched = await getAiWorkUnit(client, workspaceId, created.id);
  if (!fetched || fetched.status !== "completed") {
    throw new Error("Expected completed work unit on fetch");
  }

  // Cleanup — mark cancelled so smoke tests do not accumulate noise
  await cancelAiWorkUnit(client, workspaceId, created.id, "smoke test cleanup");

  console.log("\nPASS  test-ai-runtime-db");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("ai_work_units table is not available")) {
    skip(msg);
  }
  console.error(`FAIL  test-ai-runtime-db\n      ${msg}`);
  process.exitCode = 1;
});
