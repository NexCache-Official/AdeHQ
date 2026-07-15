"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";

export type WorkspaceUsageCapacity = {
  allowance: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  warningLevel: "ok" | "low" | "exhausted";
  resetsAt: string;
  periodStart?: string;
  periodEnd?: string;
  planSlug: string;
};

export type UsageBreakdownRow = { label: string; workHours: number };

export type WorkspaceUsageResponse = {
  capacity: WorkspaceUsageCapacity;
  weekStart: string;
  totalWorkHours: number;
  byEmployee: UsageBreakdownRow[];
  byWorkType: UsageBreakdownRow[];
};

export function useWorkspaceUsage(workspaceId: string | null) {
  const [data, setData] = useState<WorkspaceUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/usage`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load usage.");
      setData(body as WorkspaceUsageResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
