import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, daysAgoIso, effectiveCostUsd } from "./helpers";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  workspaceCount: number;
  costUsd30d: number;
};

export async function listUsers(
  client: SupabaseClient,
  search: string | null,
  limit = 100,
): Promise<AdminUserRow[]> {
  let profilesQuery = client
    .from("profiles")
    .select("id, name, email, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    profilesQuery = profilesQuery.or(`email.ilike.${term},name.ilike.${term}`);
  }

  const [profilesRes, membersRes, workspacesRes, usageRes] = await Promise.all([
    profilesQuery,
    client
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("status", "active")
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, owner_id, plan").limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_usage_events")
      .select("workspace_id, estimated_cost_usd, actual_cost_usd, created_at")
      .gte("created_at", daysAgoIso(30))
      .limit(AGGREGATION_ROW_LIMIT),
  ]);

  for (const res of [profilesRes, membersRes, workspacesRes, usageRes]) {
    if (res.error) throw res.error;
  }

  const membershipsByUser = new Map<string, string[]>();
  for (const row of membersRes.data ?? []) {
    const list = membershipsByUser.get(row.user_id) ?? [];
    list.push(row.workspace_id);
    membershipsByUser.set(row.user_id, list);
  }

  const workspaceById = new Map(
    (workspacesRes.data ?? []).map((w) => [w.id, w]),
  );

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

  return (profilesRes.data ?? []).map((profile) => {
    const workspaceIds = membershipsByUser.get(profile.id) ?? [];
    const ownedWorkspace = (workspacesRes.data ?? []).find(
      (w) => w.owner_id === profile.id,
    );
    let costUsd = 0;
    let lastActive: string | null = null;
    for (const workspaceId of workspaceIds) {
      costUsd += costByWorkspace.get(workspaceId) ?? 0;
      const at = lastActiveByWorkspace.get(workspaceId);
      if (at && (!lastActive || at > lastActive)) lastActive = at;
    }
    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      createdAt: profile.created_at,
      lastActiveAt: lastActive,
      plan: ownedWorkspace?.plan ?? workspaceById.get(workspaceIds[0] ?? "")?.plan ?? null,
      workspaceCount: workspaceIds.length,
      costUsd30d: Math.round(costUsd * 10000) / 10000,
    };
  });
}
