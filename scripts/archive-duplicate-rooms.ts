/**
 * Archive duplicate active project rooms (e.g. "Sales Outreach" + "Sales Outreach 2").
 *
 * Usage:
 *   WORKSPACE_ID=<uuid> npx tsx -r dotenv/config scripts/archive-duplicate-rooms.ts dotenv_config_path=.env.local
 *   # or all workspaces:
 *   npx tsx -r dotenv/config scripts/archive-duplicate-rooms.ts dotenv_config_path=.env.local
 */
import { createClient } from "@supabase/supabase-js";

function normalizeBaseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+\d+$/, "");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  const workspaceFilter = process.env.WORKSPACE_ID?.trim() || null;
  const client = createClient(url, key, { auth: { persistSession: false } });

  let roomsQuery = client
    .from("rooms")
    .select("workspace_id, id, name, created_at")
    .eq("kind", "room")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (workspaceFilter) roomsQuery = roomsQuery.eq("workspace_id", workspaceFilter);

  const { data: rooms, error } = await roomsQuery;
  if (error) throw error;
  if (!rooms?.length) {
    console.log("No active project rooms found.");
    return;
  }

  const byKey = new Map<string, typeof rooms>();
  for (const room of rooms) {
    const key = `${room.workspace_id}::${normalizeBaseName(String(room.name))}`;
    const list = byKey.get(key) ?? [];
    list.push(room);
    byKey.set(key, list);
  }

  const toArchive: { workspace_id: string; id: string; name: string; keep: string }[] = [];

  for (const [, group] of byKey) {
    if (group.length < 2) continue;

    const scored = await Promise.all(
      group.map(async (room) => {
        const [{ count: messageCount }, { count: defaultRefs }] = await Promise.all([
          client
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", room.workspace_id)
            .eq("room_id", room.id),
          client
            .from("ai_employees")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", room.workspace_id)
            .eq("default_room_id", room.id),
        ]);
        return {
          room,
          messageCount: messageCount ?? 0,
          defaultRefs: defaultRefs ?? 0,
        };
      }),
    );

    scored.sort((a, b) => {
      if (b.defaultRefs !== a.defaultRefs) return b.defaultRefs - a.defaultRefs;
      if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
      return String(a.room.created_at).localeCompare(String(b.room.created_at));
    });

    const keep = scored[0]!.room;
    for (const entry of scored.slice(1)) {
      toArchive.push({
        workspace_id: String(entry.room.workspace_id),
        id: String(entry.room.id),
        name: String(entry.room.name),
        keep: String(keep.id),
      });
    }
  }

  if (!toArchive.length) {
    console.log("No duplicate room groups found.");
    return;
  }

  console.log(`Archiving ${toArchive.length} duplicate room(s):`);
  for (const row of toArchive) {
    console.log(`  - ${row.name} (${row.id}) → keep ${row.keep}`);
    const { error: updateError } = await client
      .from("rooms")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("workspace_id", row.workspace_id)
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
