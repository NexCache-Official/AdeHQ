import { authHeaders } from "@/lib/api/auth-client";
import type { WorkspaceWorkMinutesSummary } from "@/lib/ai/work-hours/ledger";
import type { WorkHoursCalibrationReport } from "@/lib/ai/work-hours/calibration";
import type { WorkHoursReadinessAudit } from "@/lib/ai/work-hours/readiness";
import type { SoftCapSimulationSummary } from "@/lib/ai/work-hours/soft-cap-simulation";

export type WorkHoursShadowSummary = WorkspaceWorkMinutesSummary;

export class WorkHoursShadowFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkHoursShadowFetchError";
    this.status = status;
  }
}

export async function fetchWorkHoursShadowSummary(
  workspaceId: string,
  options: {
    weekStart?: string;
    headers?: HeadersInit;
  } = {},
): Promise<WorkHoursShadowSummary> {
  const params = new URLSearchParams({ workspaceId });
  if (options.weekStart?.trim()) {
    params.set("weekStart", options.weekStart.trim());
  }

  const headers = options.headers ?? (await authHeaders());
  const response = await fetch(`/api/work-hours/shadow?${params.toString()}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Unable to load shadow Work Hours.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error?.trim()) message = payload.error.trim();
    } catch {
      /* ignore */
    }
    throw new WorkHoursShadowFetchError(message, response.status);
  }

  return (await response.json()) as WorkHoursShadowSummary;
}

export class WorkHoursCalibrationFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkHoursCalibrationFetchError";
    this.status = status;
  }
}

export async function fetchWorkHoursCalibrationReport(
  workspaceId: string,
  options: {
    weekStart?: string;
    headers?: HeadersInit;
  } = {},
): Promise<WorkHoursCalibrationReport> {
  const params = new URLSearchParams({ workspaceId });
  if (options.weekStart?.trim()) {
    params.set("weekStart", options.weekStart.trim());
  }

  const headers = options.headers ?? (await authHeaders());
  const response = await fetch(`/api/work-hours/calibration?${params.toString()}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Unable to load calibration report.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error?.trim()) message = payload.error.trim();
    } catch {
      /* ignore */
    }
    throw new WorkHoursCalibrationFetchError(message, response.status);
  }

  return (await response.json()) as WorkHoursCalibrationReport;
}

export class WorkHoursReadinessFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkHoursReadinessFetchError";
    this.status = status;
  }
}

export async function fetchWorkHoursReadinessAudit(
  workspaceId: string,
  options: {
    weekStart?: string;
    headers?: HeadersInit;
  } = {},
): Promise<WorkHoursReadinessAudit> {
  const params = new URLSearchParams({ workspaceId });
  if (options.weekStart?.trim()) {
    params.set("weekStart", options.weekStart.trim());
  }

  const headers = options.headers ?? (await authHeaders());
  const response = await fetch(`/api/work-hours/readiness?${params.toString()}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Unable to load readiness audit.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error?.trim()) message = payload.error.trim();
    } catch {
      /* ignore */
    }
    throw new WorkHoursReadinessFetchError(message, response.status);
  }

  return (await response.json()) as WorkHoursReadinessAudit;
}

export class WorkHoursSoftCapSimulationFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkHoursSoftCapSimulationFetchError";
    this.status = status;
  }
}

export async function fetchWorkHoursSoftCapSimulationSummary(
  workspaceId: string,
  options: {
    weekStart?: string;
    headers?: HeadersInit;
  } = {},
): Promise<SoftCapSimulationSummary> {
  const params = new URLSearchParams({ workspaceId });
  if (options.weekStart?.trim()) {
    params.set("weekStart", options.weekStart.trim());
  }

  const headers = options.headers ?? (await authHeaders());
  const response = await fetch(`/api/work-hours/simulation?${params.toString()}`, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Unable to load soft-cap simulation.";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error?.trim()) message = payload.error.trim();
    } catch {
      /* ignore */
    }
    throw new WorkHoursSoftCapSimulationFetchError(message, response.status);
  }

  return (await response.json()) as SoftCapSimulationSummary;
}
