import { authHeaders } from "@/lib/api/auth-client";
import type { CalendarListPayload } from "./types";

export async function fetchCalendarData(params: {
  workspaceId: string;
  query?: string;
}): Promise<CalendarListPayload> {
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.query?.trim()) search.set("q", params.query.trim());

  let headers: HeadersInit;
  try {
    headers = await authHeaders();
  } catch {
    throw new Error("Not signed in.");
  }

  const res = await fetch(`/api/calendar?${search.toString()}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Unable to load calendar.");
  }
  return res.json() as Promise<CalendarListPayload>;
}

export function calendarEntityHref(type: "campaign" | "post", id: string): string {
  return `/calendar?${type}=${encodeURIComponent(id)}`;
}
