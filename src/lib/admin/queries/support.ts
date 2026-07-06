import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, daysAgoIso, effectiveCostUsd } from "./helpers";

export type SupportSearchResult = {
  users: { id: string; email: string; name: string }[];
  workspaces: { id: string; name: string; plan: string; ownerEmail: string | null }[];
};

export type SupportDetail = {
  user: { id: string; email: string; name: string; createdAt: string } | null;
  workspaces: {
    id: string;
    name: string;
    plan: string;
    status: string;
    costUsd30d: number;
    failedRuns30d: number;
  }[];
  flags: Record<string, unknown>;
};

export async function searchSupport(
  client: SupabaseClient,
  query: string,
): Promise<SupportSearchResult> {
  const term = query.trim();
  if (!term) return { users: [], workspaces: [] };

  const [usersRes, workspacesRes] = await Promise.all([
    client
      .from("profiles")
      .select("id, email, name")
      .or(`email.ilike.%${term}%,name.ilike.%${term}%`)
      .limit(10),
    client.from("workspaces").select("id, name, plan, owner_id").ilike("name", `%${term}%`).limit(10),
  ]);

  if (usersRes.error) throw usersRes.error;
  if (workspacesRes.error) throw workspacesRes.error;

  const ownerIds = [...new Set((workspacesRes.data ?? []).map((w) => w.owner_id))];
  const ownersRes = ownerIds.length
    ? await client.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [], error: null };
  if (ownersRes.error) throw ownersRes.error;
  const emailById = new Map((ownersRes.data ?? []).map((p) => [p.id, p.email]));

  return {
    users: usersRes.data ?? [],
    workspaces: (workspacesRes.data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      plan: w.plan,
      ownerEmail: emailById.get(w.owner_id) ?? null,
    })),
  };
}

export async function getSupportDetail(
  client: SupabaseClient,
  userId: string,
): Promise<SupportDetail> {
  const since = daysAgoIso(30);

  const [profileRes, membersRes, flagsRes] = await Promise.all([
    client.from("profiles").select("id, email, name, created_at").eq("id", userId).maybeSingle(),
    client
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("status", "active"),
    client.from("platform_feature_flags").select("key, value").eq("scope", "global"),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (membersRes.error) throw membersRes.error;
  if (flagsRes.error) throw flagsRes.error;

  const workspaceIds = (membersRes.data ?? []).map((m) => m.workspace_id);
  const workspacesRes = workspaceIds.length
    ? await client
        .from("workspaces")
        .select("id, name, plan, status")
        .in("id", workspaceIds)
    : { data: [], error: null };
  if (workspacesRes.error) throw workspacesRes.error;

  const usageRes = workspaceIds.length
    ? await client
        .from("ai_usage_events")
        .select("workspace_id, status, estimated_cost_usd, actual_cost_usd")
        .in("workspace_id", workspaceIds)
        .gte("created_at", since)
        .limit(AGGREGATION_ROW_LIMIT)
    : { data: [], error: null };
  if (usageRes.error) throw usageRes.error;

  const costByWs = new Map<string, number>();
  const failedByWs = new Map<string, number>();
  for (const e of usageRes.data ?? []) {
    costByWs.set(e.workspace_id, (costByWs.get(e.workspace_id) ?? 0) + effectiveCostUsd(e));
    if (e.status === "failed" || e.status === "blocked") {
      failedByWs.set(e.workspace_id, (failedByWs.get(e.workspace_id) ?? 0) + 1);
    }
  }

  const flags: Record<string, unknown> = {};
  for (const row of flagsRes.data ?? []) flags[row.key] = row.value;

  return {
    user: profileRes.data
      ? {
          id: profileRes.data.id,
          email: profileRes.data.email,
          name: profileRes.data.name,
          createdAt: profileRes.data.created_at,
        }
      : null,
    workspaces: (workspacesRes.data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      plan: w.plan,
      status: w.status ?? "active",
      costUsd30d: Math.round((costByWs.get(w.id) ?? 0) * 100) / 100,
      failedRuns30d: failedByWs.get(w.id) ?? 0,
    })),
    flags,
  };
}
