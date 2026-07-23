import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, parseRange, rangeStart, type AdminRange } from "./helpers";

export type VoiceEconomicsSummary = {
  range: AdminRange;
  metrics: {
    internalCogsUsd: number;
    platformAbsorbedUsd: number;
    customerChargedUsd: number;
    customerWorkHours: number;
    liveCallMinutes: number;
    calls: number;
  };
  byPlan: VoiceEconomicsBreakdown[];
  byWorkspace: VoiceEconomicsBreakdown[];
  byCapability: VoiceEconomicsBreakdown[];
};

export type VoiceEconomicsBreakdown = {
  key: string;
  label: string;
  internalCogsUsd: number;
  platformAbsorbedUsd: number;
  customerChargedUsd: number;
  customerWorkHours: number;
  liveCallMinutes: number;
  events: number;
};

type VoiceLedgerRow = {
  workspace_id: string;
  call_id: string | null;
  plan_slug: string;
  capability: string;
  internal_cost_usd: number | string;
  platform_absorbed_usd: number | string;
  customer_charged_usd: number | string;
  customer_charged_wh: number | string;
  quantity: number | string;
  unit: string;
};

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function aggregate(
  rows: VoiceLedgerRow[],
  keyOf: (row: VoiceLedgerRow) => string,
  labelOf: (key: string) => string = (key) => key,
): VoiceEconomicsBreakdown[] {
  const groups = new Map<string, VoiceEconomicsBreakdown>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = groups.get(key) ?? {
      key,
      label: labelOf(key),
      internalCogsUsd: 0,
      platformAbsorbedUsd: 0,
      customerChargedUsd: 0,
      customerWorkHours: 0,
      liveCallMinutes: 0,
      events: 0,
    };
    current.internalCogsUsd += Number(row.internal_cost_usd ?? 0);
    current.platformAbsorbedUsd += Number(row.platform_absorbed_usd ?? 0);
    current.customerChargedUsd += Number(row.customer_charged_usd ?? 0);
    current.customerWorkHours += Number(row.customer_charged_wh ?? 0);
    if (row.capability === "live_call_minutes" && row.unit === "minutes") {
      current.liveCallMinutes += Number(row.quantity ?? 0);
    }
    current.events += 1;
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      internalCogsUsd: round(row.internalCogsUsd),
      platformAbsorbedUsd: round(row.platformAbsorbedUsd),
      customerChargedUsd: round(row.customerChargedUsd),
      customerWorkHours: round(row.customerWorkHours),
      liveCallMinutes: round(row.liveCallMinutes, 4),
    }))
    .sort((a, b) => b.internalCogsUsd - a.internalCogsUsd || b.liveCallMinutes - a.liveCallMinutes);
}

export async function getVoiceEconomicsSummary(
  client: SupabaseClient,
  rawRange: string | null,
): Promise<VoiceEconomicsSummary> {
  const range = parseRange(rawRange, "30d");
  const since = rangeStart(range);
  const [{ data, error }, { data: workspaces, error: workspaceError }] =
    await Promise.all([
      client
        .from("voice_usage_ledger")
        .select(
          "workspace_id, call_id, plan_slug, capability, internal_cost_usd, platform_absorbed_usd, customer_charged_usd, customer_charged_wh, quantity, unit",
        )
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(AGGREGATION_ROW_LIMIT),
      client.from("workspaces").select("id, name").limit(AGGREGATION_ROW_LIMIT),
    ]);
  if (error) throw error;
  if (workspaceError) throw workspaceError;
  const rows = (data ?? []) as VoiceLedgerRow[];
  const names = new Map(
    (workspaces ?? []).map((workspace) => [
      String(workspace.id),
      String(workspace.name ?? "Workspace"),
    ]),
  );
  const calls = new Set(rows.map((row) => row.call_id).filter(Boolean)).size;
  const total = aggregate(rows, () => "total")[0];
  return {
    range,
    metrics: {
      internalCogsUsd: total?.internalCogsUsd ?? 0,
      platformAbsorbedUsd: total?.platformAbsorbedUsd ?? 0,
      customerChargedUsd: total?.customerChargedUsd ?? 0,
      customerWorkHours: total?.customerWorkHours ?? 0,
      liveCallMinutes: total?.liveCallMinutes ?? 0,
      calls,
    },
    byPlan: aggregate(rows, (row) => row.plan_slug),
    byWorkspace: aggregate(
      rows,
      (row) => row.workspace_id,
      (key) => names.get(key) ?? "Workspace",
    ).slice(0, 100),
    byCapability: aggregate(rows, (row) => row.capability),
  };
}
