"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkHoursSoftCapSimulationSummary,
  WorkHoursSoftCapSimulationFetchError,
} from "@/lib/work-hours/client";
import type { SoftCapSimulationSummary } from "@/lib/ai/work-hours/soft-cap-simulation";

export function useWorkHoursSoftCapSimulation(
  workspaceId: string | undefined,
  weekStart?: string,
  enabled = true,
) {
  const [data, setData] = useState<SoftCapSimulationSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId && enabled));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!workspaceId || !enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const summary = await fetchWorkHoursSoftCapSimulationSummary(workspaceId, { weekStart });
      setData(summary);
    } catch (err) {
      const message =
        err instanceof WorkHoursSoftCapSimulationFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to load soft-cap simulation.";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, weekStart, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
