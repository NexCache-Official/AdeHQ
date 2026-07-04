import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import type { BrowserResearchProvider, BrowserResearchRun } from "./types";

export type BrowserResearchProviderConfig = {
  providerPref: BrowserResearchProvider;
  effectiveProvider: BrowserResearchProvider;
  tavilyConfigured: boolean;
  browserbaseConfigured?: boolean;
  liveEnabled?: boolean;
  liveReady?: boolean;
  fallbackReason?: string;
};

export async function fetchBrowserResearchRuns(params: {
  workspaceId: string;
  employeeId: string;
  topicId?: string;
}): Promise<{ runs: BrowserResearchRun[]; config: BrowserResearchProviderConfig | null }> {
  const search = new URLSearchParams({
    workspaceId: params.workspaceId,
    employeeId: params.employeeId,
  });
  if (params.topicId) search.set("topicId", params.topicId);

  const res = await fetch(`/api/browser-research/runs?${search.toString()}`, {
    headers: await authHeaders(),
  });
  const data = await parseJsonResponse<{
    runs?: BrowserResearchRun[];
    config?: BrowserResearchProviderConfig;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to load browser research runs.");
  }
  return { runs: data.runs ?? [], config: data.config ?? null };
}

export async function createBrowserResearchRun(params: {
  workspaceId: string;
  employeeId: string;
  query: string;
  roomId?: string;
  topicId?: string;
}): Promise<{ run: BrowserResearchRun; message?: string; config: BrowserResearchProviderConfig | null }> {
  const res = await fetch("/api/browser-research/runs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      employeeId: params.employeeId,
      query: params.query,
      roomId: params.roomId ?? null,
      topicId: params.topicId ?? null,
    }),
  });
  const data = await parseJsonResponse<{
    run?: BrowserResearchRun;
    message?: string;
    config?: BrowserResearchProviderConfig;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to run browser research.");
  }
  if (!data.run) {
    throw new Error("Browser research completed without a run payload.");
  }
  return { run: data.run, message: data.message, config: data.config ?? null };
}
