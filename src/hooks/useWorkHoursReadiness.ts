"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkHoursReadinessAudit,
  WorkHoursReadinessFetchError,
} from "@/lib/work-hours/client";
import type { WorkHoursReadinessAudit } from "@/lib/ai/work-hours/readiness";

export function useWorkHoursReadiness(
  workspaceId: string | undefined,
  weekStart?: string,
  enabled = true,
) {
  const [data, setData] = useState<WorkHoursReadinessAudit | null>(null);
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
      const audit = await fetchWorkHoursReadinessAudit(workspaceId, { weekStart });
      setData(audit);
    } catch (err) {
      const message =
        err instanceof WorkHoursReadinessFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to load readiness audit.";
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
