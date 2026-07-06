import type { SupabaseClient } from "@supabase/supabase-js";

export type IncidentRow = {
  id: string;
  title: string;
  incidentType: string;
  status: string;
  severity: string;
  affectedSystems: string[];
  publicMessage: string | null;
  internalNotes: string | null;
  ownerAdminId: string | null;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
};

function mapRow(row: Record<string, unknown>): IncidentRow {
  return {
    id: String(row.id),
    title: String(row.title),
    incidentType: String(row.incident_type),
    status: String(row.status),
    severity: String(row.severity),
    affectedSystems: Array.isArray(row.affected_systems)
      ? (row.affected_systems as string[])
      : [],
    publicMessage: row.public_message ? String(row.public_message) : null,
    internalNotes: row.internal_notes ? String(row.internal_notes) : null,
    ownerAdminId: row.owner_admin_id ? String(row.owner_admin_id) : null,
    startedAt: String(row.started_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function listIncidents(
  client: SupabaseClient,
  status?: string | null,
): Promise<IncidentRow[]> {
  let query = client
    .from("platform_incidents")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);
  if (status?.trim()) query = query.eq("status", status.trim());
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function getOpenIncidentCount(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("platform_incidents")
    .select("*", { count: "exact", head: true })
    .in("status", ["open", "investigating", "mitigated"]);
  if (error) throw error;
  return count ?? 0;
}
