import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import type { RoomMessage } from "@/lib/types";
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

export async function fetchBrowserResearchRun(params: {
  workspaceId: string;
  runId: string;
}): Promise<{ run: BrowserResearchRun; chatReply: RoomMessage | null }> {
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/browser-research/runs/${params.runId}?${search.toString()}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
  const data = await parseJsonResponse<{
    run?: BrowserResearchRun;
    chatReply?: RoomMessage | null;
    error?: string;
  }>(res);
  if (!res.ok || !data.run) {
    throw new Error(data.error ?? "Failed to load research run.");
  }
  return { run: data.run, chatReply: data.chatReply ?? null };
}

export function upsertBrowserResearchRun(
  runs: BrowserResearchRun[],
  run: BrowserResearchRun,
): BrowserResearchRun[] {
  const next = [...runs.filter((item) => item.id !== run.id), run];
  return sortBrowserResearchRuns(next);
}

export function isActiveBrowserResearchRun(run: BrowserResearchRun): boolean {
  return run.status === "created" || run.status === "planning" || run.status === "running";
}

export async function createBrowserResearchRun(params: {
  workspaceId: string;
  employeeId: string;
  query: string;
  roomId?: string;
  topicId?: string;
  triggerMessageId?: string;
}): Promise<{
  run: BrowserResearchRun;
  chatReply: RoomMessage | null;
  message?: string;
  config: BrowserResearchProviderConfig | null;
  async?: boolean;
  resolvedQuery?: string;
}> {
  const res = await fetch("/api/browser-research/runs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      employeeId: params.employeeId,
      query: params.query,
      roomId: params.roomId ?? null,
      topicId: params.topicId ?? null,
      triggerMessageId: params.triggerMessageId ?? null,
    }),
  });
  const data = await parseJsonResponse<{
    run?: BrowserResearchRun;
    chatReply?: RoomMessage | null;
    message?: string;
    config?: BrowserResearchProviderConfig;
    async?: boolean;
    resolvedQuery?: string;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to run browser research.");
  }
  if (!data.run) {
    throw new Error("Browser research completed without a run payload.");
  }
  return {
    run: data.run,
    chatReply: data.chatReply ?? null,
    message: data.message,
    config: data.config ?? null,
    async: data.async,
    resolvedQuery: data.resolvedQuery,
  };
}

export function sortBrowserResearchRuns(runs: BrowserResearchRun[]): BrowserResearchRun[] {
  return [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
