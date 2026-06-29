import type { SupabaseClient } from "@supabase/supabase-js";
import { TOOL_CATALOG } from "@/lib/demo";
import { nowISO } from "@/lib/utils";

/** Upsert global tool rows — required before workspace_tools / employee_tools inserts. */
export async function ensureToolCatalog(client: SupabaseClient): Promise<void> {
  const rows = TOOL_CATALOG.map((tool) => ({
    id: tool.id,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    status: tool.status,
    updated_at: nowISO(),
  }));

  const { error } = await client.from("tools").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
