type DbRow = Record<string, unknown>;

/** Resolve room id from a row after channels→rooms renames (supports legacy column). */
export function roomIdFromRow(row: DbRow): string {
  return String(row.room_id ?? row.channel_id ?? "");
}
