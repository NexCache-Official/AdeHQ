"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchWorkHoursCalibrationReport,
  WorkHoursCalibrationFetchError,
} from "@/lib/work-hours/client";
import type { WorkHoursCalibrationReport } from "@/lib/ai/work-hours/calibration";

export function useWorkHoursCalibration(
  workspaceId: string | undefined,
  weekStart?: string,
  enabled = true,
) {
  const [data, setData] = useState<WorkHoursCalibrationReport | null>(null);
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
      const report = await fetchWorkHoursCalibrationReport(workspaceId, { weekStart });
      setData(report);
    } catch (err) {
      const message =
        err instanceof WorkHoursCalibrationFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to load calibration report.";
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
