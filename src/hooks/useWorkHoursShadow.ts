"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkHoursShadowSummary,
  type WorkHoursShadowSummary,
  WorkHoursShadowFetchError,
} from "@/lib/work-hours/client";

export type UseWorkHoursShadowState = {
  data: WorkHoursShadowSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export function useWorkHoursShadow(
  workspaceId: string | undefined,
  weekStart?: string,
): UseWorkHoursShadowState {
  const [data, setData] = useState<WorkHoursShadowSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!workspaceId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const summary = await fetchWorkHoursShadowSummary(workspaceId, { weekStart });
      setData(summary);
    } catch (err) {
      const message =
        err instanceof WorkHoursShadowFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to load shadow Work Hours.";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, weekStart]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
