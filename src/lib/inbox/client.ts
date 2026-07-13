/**
 * Browser client for the Slice B inbox API.
 */

import { authHeaders } from "@/lib/api/auth-client";
import type {
  DraftDTO,
  InboxFolder,
  InboxMailboxResponse,
  SendResultDTO,
  ThreadDetailDTO,
  ThreadPageDTO,
} from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string }).error ?? "Inbox request failed.");
  }
  return payload as T;
}

export async function fetchMailbox(workspaceId: string): Promise<InboxMailboxResponse> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/mailbox?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers },
  );
  return parseJson(res);
}

export async function checkAvailability(params: {
  workspaceId: string;
  localPart: string;
}): Promise<{ available: boolean; address?: string; reason: string | null }> {
  const headers = await authHeaders();
  const search = new URLSearchParams({
    workspaceId: params.workspaceId,
    localPart: params.localPart,
  });
  const res = await fetch(`/api/inbox/mailboxes/availability?${search}`, { headers });
  return parseJson(res);
}

export async function claimMailbox(params: {
  workspaceId: string;
  localPart: string;
  displayName?: string;
}): Promise<{ ok: true; mailboxId: string; address: string }> {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/mailboxes/claim", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  return parseJson(res);
}

export async function fetchThreads(params: {
  workspaceId: string;
  folder: InboxFolder;
  cursor?: string | null;
  limit?: number;
}): Promise<ThreadPageDTO> {
  const headers = await authHeaders();
  const search = new URLSearchParams({
    workspaceId: params.workspaceId,
    folder: params.folder,
  });
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const res = await fetch(`/api/inbox/threads?${search}`, { headers });
  return parseJson(res);
}

export async function fetchThread(params: {
  workspaceId: string;
  threadId: string;
}): Promise<ThreadDetailDTO> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}?${search}`,
    { headers },
  );
  return parseJson(res);
}

export async function fetchDrafts(workspaceId: string): Promise<DraftDTO[]> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/drafts?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers },
  );
  const body = await parseJson<{ drafts: DraftDTO[] }>(res);
  return body.drafts;
}

export async function createDraftReq(params: {
  workspaceId: string;
  threadId?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  textBody?: string | null;
}): Promise<DraftDTO> {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/drafts", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  const body = await parseJson<{ draft: DraftDTO }>(res);
  return body.draft;
}

export async function updateDraftReq(params: {
  draftId: string;
  workspaceId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  textBody?: string | null;
}): Promise<DraftDTO> {
  const headers = await authHeaders();
  const res = await fetch(`/api/inbox/drafts/${encodeURIComponent(params.draftId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(params),
  });
  const body = await parseJson<{ draft: DraftDTO }>(res);
  return body.draft;
}

export async function discardDraftReq(params: {
  draftId: string;
  workspaceId: string;
}): Promise<void> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/inbox/drafts/${encodeURIComponent(params.draftId)}?${search}`,
    { method: "DELETE", headers },
  );
  await parseJson(res);
}

export async function sendEmailReq(params: {
  workspaceId: string;
  clientSendId: string;
  draftId?: string | null;
  threadId?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): Promise<SendResultDTO> {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/send", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  return parseJson(res);
}

type ThreadAction = "archive" | "unarchive" | "read" | "unread" | "spam";

export async function threadAction(params: {
  workspaceId: string;
  threadId: string;
  action: ThreadAction;
  spam?: boolean;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/${params.action}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: params.workspaceId, spam: params.spam }),
    },
  );
  await parseJson(res);
}
