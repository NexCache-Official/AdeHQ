type DbRow = Record<string, unknown>;

/** Resolve room id from a database row. */
export function roomIdFromRow(row: DbRow): string {
  return String(row.room_id ?? "");
}
