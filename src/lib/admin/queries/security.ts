import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, daysAgoIso, effectiveCostUsd } from "./helpers";

export type SecuritySummary = {
  highCostFreeWorkspaces: { workspaceId: string; name: string; costUsd30d: number }[];
  disabledWorkspaces: number;
  recentRiskEvents: {
    id: string;
    riskType: string;
    severity: string;
    description: string;
    createdAt: string;
  }[];
  auditAnomalies: number;
};

export async function getSecuritySummary(client: SupabaseClient): Promise<SecuritySummary> {
  const since = daysAgoIso(30);

  const [workspacesRes, usageRes, disabledCount, riskRes, auditRes] = await Promise.all([
    client.from("workspaces").select("id, name, plan, status").limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_usage_events")
      .select("workspace_id, estimated_cost_usd, actual_cost_usd")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .eq("status", "disabled"),
    client
      .from("platform_risk_events")
      .select("id, risk_type, severity, description, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(20),
    client
      .from("platform_admin_audit_logs")
      .select("id")
      .in("severity", ["high", "critical"])
      .gte("created_at", daysAgoIso(7))
      .limit(100),
  ]);

  for (const res of [workspacesRes, usageRes, riskRes, auditRes]) {
    if (res.error) throw res.error;
  }
  if (disabledCount.error) throw disabledCount.error;

  const workspaceById = new Map((workspacesRes.data ?? []).map((w) => [w.id, w]));
  const costByWorkspace = new Map<string, number>();
  for (const event of usageRes.data ?? []) {
    costByWorkspace.set(
      event.workspace_id,
      (costByWorkspace.get(event.workspace_id) ?? 0) + effectiveCostUsd(event),
    );
  }

  const highCostFreeWorkspaces = [...costByWorkspace.entries()]
    .filter(([id, cost]) => {
      const ws = workspaceById.get(id);
      return ws && (ws.plan === "founder" || ws.plan === "free") && cost > 5;
    })
    .map(([id, cost]) => ({
      workspaceId: id,
      name: workspaceById.get(id)?.name ?? id,
      costUsd30d: Math.round(cost * 100) / 100,
    }))
    .sort((a, b) => b.costUsd30d - a.costUsd30d)
    .slice(0, 10);

  return {
    highCostFreeWorkspaces,
    disabledWorkspaces: disabledCount.count ?? 0,
    recentRiskEvents: (riskRes.data ?? []).map((row) => ({
      id: row.id,
      riskType: row.risk_type,
      severity: row.severity,
      description: row.description,
      createdAt: row.created_at,
    })),
    auditAnomalies: auditRes.data?.length ?? 0,
  };
}
