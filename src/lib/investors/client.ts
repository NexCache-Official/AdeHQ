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
