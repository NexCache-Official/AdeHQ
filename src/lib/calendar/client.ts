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
    throw new Error(payload.error ?? "Calendar update failed.");
  }
  return res.json() as Promise<T>;
}

export async function patchCalendarPost(
  workspaceId: string,
  postId: string,
  patch: {
    scheduledAt?: string | null;
    status?: import("./types").ContentPostStatus;
    title?: string;
    platform?: import("./types").ContentPlatform;
  },
) {
  return patchJson<{ post: import("./types").ContentPost }>(
    `/api/calendar/posts/${postId}`,
    { workspaceId, ...patch },
  );
}
