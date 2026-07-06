import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, daysAgoIso, effectiveCostUsd } from "./helpers";

export type AdminWorkspaceRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  ownerEmail: string | null;
  memberCount: number;
  employeeCount: number;
  roomCount: number;
  costUsd7d: number;
  browserRuns7d: number;
  storageUsedBytes: number;
  createdAt: string;
  lastActiveAt: string | null;
};

export async function listWorkspaces(
  client: SupabaseClient,
  search: string | null,
  limit = 100,
): Promise<AdminWorkspaceRow[]> {
  let workspacesQuery = client
    .from("workspaces")
    .select("id, name, plan, status, owner_id, workspace_mode, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (search?.trim()) {
    workspacesQuery = workspacesQuery.ilike("name", `%${search.trim()}%`);
  }

  const since7d = daysAgoIso(7);

  const [workspacesRes, membersRes, employeesRes, roomsRes, usageRes, browserRes, storageRes] =
    await Promise.all([
      workspacesQuery,
      client
        .from("workspace_members")
        .select("workspace_id")
        .eq("status", "active")
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("ai_employees")
        .select("workspace_id")
        .eq("is_system_employee", false)
        .limit(AGGREGATION_ROW_LIMIT),
      client.from("rooms").select("workspace_id").limit(AGGREGATION_ROW_LIMIT),
      client
        .from("ai_usage_events")
        .select("workspace_id, estimated_cost_usd, actual_cost_usd, created_at")
        .gte("created_at", since7d)
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("browser_research_runs")
        .select("workspace_id")
        .gte("created_at", since7d)
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("workspace_storage_quotas")
        .select("workspace_id, used_bytes")
        .limit(AGGREGATION_ROW_LIMIT),
    ]);

  for (const res of [workspacesRes, membersRes, employeesRes, roomsRes, usageRes, browserRes, storageRes]) {
    if (res.error) throw res.error;
  }

  const workspaces = workspacesRes.data ?? [];

  const ownerIds = [...new Set(workspaces.map((w) => w.owner_id))];
  const ownersRes = ownerIds.length
    ? await client.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [], error: null };
  if (ownersRes.error) throw ownersRes.error;
  const ownerEmailById = new Map((ownersRes.data ?? []).map((p) => [p.id, p.email]));

  const countBy = (rows: { workspace_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.workspace_id, (map.get(row.workspace_id) ?? 0) + 1);
    }
    return map;
  };

  const memberCounts = countBy(membersRes.data);
  const employeeCounts = countBy(employeesRes.data);
  const roomCounts = countBy(roomsRes.data);
  const browserCounts = countBy(browserRes.data);

  const costByWorkspace = new Map<string, number>();
  const lastActiveByWorkspace = new Map<string, string>();
  for (const event of usageRes.data ?? []) {
    costByWorkspace.set(
      event.workspace_id,
      (costByWorkspace.get(event.workspace_id) ?? 0) + effectiveCostUsd(event),
    );
    const existing = lastActiveByWorkspace.get(event.workspace_id);
    if (!existing || event.created_at > existing) {
      lastActiveByWorkspace.set(event.workspace_id, event.created_at);
    }
  }

  const storageByWorkspace = new Map(
    (storageRes.data ?? []).map((row) => [row.workspace_id, Number(row.used_bytes ?? 0)]),
  );

  return workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    status: workspace.status ?? "active",
    ownerEmail: ownerEmailById.get(workspace.owner_id) ?? null,
    memberCount: memberCounts.get(workspace.id) ?? 0,
    employeeCount: employeeCounts.get(workspace.id) ?? 0,
    roomCount: roomCounts.get(workspace.id) ?? 0,
    costUsd7d: Math.round((costByWorkspace.get(workspace.id) ?? 0) * 10000) / 10000,
    browserRuns7d: browserCounts.get(workspace.id) ?? 0,
    storageUsedBytes: storageByWorkspace.get(workspace.id) ?? 0,
    createdAt: workspace.created_at,
    lastActiveAt: lastActiveByWorkspace.get(workspace.id) ?? null,
  }));
}
