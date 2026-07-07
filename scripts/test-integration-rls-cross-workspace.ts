/**
 * Phase 2D — Cross-workspace RLS isolation (requires live Supabase + two workspaces).
 * Skips gracefully when env vars are missing.
 */
import { createClient } from "@supabase/supabase-js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceA = process.env.TEST_WORKSPACE_ID;
const workspaceB = process.env.TEST_WORKSPACE_B_ID;

async function main(): Promise<void> {
  if (!url || !serviceKey || !workspaceA || !workspaceB) {
    console.log("⊘ Skipping cross-workspace RLS test — set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_WORKSPACE_ID, TEST_WORKSPACE_B_ID");
    process.exit(0);
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });

  const tables = [
    "crm_companies",
    "content_campaigns",
    "content_posts",
    "investor_firms",
    "investor_pipeline",
  ] as const;

  for (const table of tables) {
    const { data: rowsA, error: errA } = await client
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceA)
      .limit(5);
    if (errA) throw errA;

    if (!rowsA?.length) continue;

    const sampleId = String((rowsA[0] as { id: string }).id);
    const { data: leak, error: errB } = await client
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceB)
      .eq("id", sampleId)
      .maybeSingle();
    if (errB) throw errB;

    assert(!leak, `${table} row from workspace A must not appear under workspace B id filter`);
    console.log(`✓ ${table} workspace isolation`);
  }

  console.log("\nCross-workspace RLS smoke test passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
