import type { InvestorsListPayload } from "./types";
import { authHeaders } from "@/lib/api/auth-client";

function formatInvestorsClientError(message: string): string {
  return `Investor CRM: ${message}`;
}

export async function fetchInvestorsData(params: {
  workspaceId: string;
  query?: string;
}): Promise<InvestorsListPayload> {
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.query?.trim()) search.set("q", params.query.trim());

  let headers: HeadersInit;
  try {
    headers = await authHeaders();
  } catch {
    throw new Error(formatInvestorsClientError("Not signed in."));
  }

  const res = await fetch(`/api/investors?${search.toString()}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(formatInvestorsClientError(body.error ?? "Unable to load investors."));
  }
  return res.json() as Promise<InvestorsListPayload>;
}

export function investorEntityHref(type: "firm" | "contact" | "pipeline", id: string): string {
  return `/investors?${type}=${encodeURIComponent(id)}`;
}

async function patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(formatInvestorsClientError(payload.error ?? "Investor update failed."));
  }
  return res.json() as Promise<T>;
}

export async function patchInvestorPipeline(
  workspaceId: string,
  pipelineId: string,
  patch: {
    stage?: import("./types").InvestorStage;
    fitScore?: number | null;
    targetAmount?: number | null;
    currency?: string;
    notes?: string | null;
    nextFollowUpAt?: string | null;
  },
) {
  return patchJson<{ record: import("./types").InvestorPipelineRecord }>(
    `/api/investors/pipeline/${pipelineId}`,
    { workspaceId, ...patch },
  );
}

export async function createInvestorFirm(
  workspaceId: string,
  body: {
    name: string;
    website?: string;
    focus?: string;
    stageFocus?: string;
    notes?: string;
  },
) {
  const headers = await authHeaders();
  const res = await fetch("/api/investors/firms", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ workspaceId, ...body }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(formatInvestorsClientError(payload.error ?? "Unable to create firm."));
  }
  return res.json() as Promise<{ firmId: string; summary: string }>;
}
