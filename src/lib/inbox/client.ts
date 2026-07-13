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
  const res = await fetch(`/api/inbox/threads?${search}`, {
    headers,
    cache: "no-store",
  });
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
    { headers, cache: "no-store" },
  );
  return parseJson(res);
}

export async function fetchDrafts(workspaceId: string): Promise<DraftDTO[]> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/drafts?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers, cache: "no-store" },
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
  htmlBody?: string | null;
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
  htmlBody?: string | null;
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
  htmlBody?: string;
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
}): Promise<SendResultDTO> {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/send", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  return parseJson(res);
}

export async function cancelSendReq(params: {
  workspaceId: string;
  outboxId: string;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/outbox/${encodeURIComponent(params.outboxId)}/cancel`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    },
  );
  await parseJson(res);
}

export async function flushOutboxReq(params: {
  workspaceId: string;
  outboxId: string;
  force?: boolean;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/outbox/${encodeURIComponent(params.outboxId)}/flush`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        force: params.force ?? true,
      }),
    },
  );
  await parseJson(res);
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

export async function assignThreadReq(params: {
  workspaceId: string;
  threadId: string;
  employeeId?: string | null;
  clear?: boolean;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/assign`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    },
  );
  await parseJson(res);
}

export async function requestAiDraftReq(params: {
  workspaceId: string;
  threadId: string;
  employeeId?: string;
  draftId?: string | null;
  rewriteType?: "shorter" | "warmer" | "persuasive" | null;
}): Promise<{ jobId: string }> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/draft`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ...params, requestId: crypto.randomUUID() }),
    },
  );
  return parseJson(res);
}

export async function dismissSuggestionReq(params: {
  workspaceId: string;
  threadId: string;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/suggestion/dismiss`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    },
  );
  await parseJson(res);
}

export async function requestApprovalReq(params: {
  workspaceId: string;
  draftId: string;
}): Promise<{
  approvalId: string;
  expiresAt: string;
  envelope: { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string };
}> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/drafts/${encodeURIComponent(params.draftId)}/approvals`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    },
  );
  return parseJson(res);
}

export async function decideApprovalReq(params: {
  workspaceId: string;
  approvalId: string;
  decision: "approve" | "reject";
  reason?: string;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/approvals/${encodeURIComponent(params.approvalId)}/decide`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    },
  );
  await parseJson(res);
}

export async function cancelAiDraftReq(params: {
  workspaceId: string;
  threadId: string;
  jobId?: string;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/draft/cancel`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        jobId: params.jobId,
      }),
    },
  );
  await parseJson(res);
}

export async function fetchDraftVersions(params: {
  workspaceId: string;
  draftId: string;
}): Promise<{ versions: Array<{ id: string; versionNumber: number; createdAt: string }> }> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/inbox/drafts/${encodeURIComponent(params.draftId)}/versions?${search}`,
    { headers, cache: "no-store" },
  );
  return parseJson(res);
}

export async function fetchMailboxSettings(workspaceId: string): Promise<{
  assistanceMode: string;
  labels: Record<string, { label: string; helper: string }>;
  consent: string;
  assignThreshold: number;
  approvalTtlHours: number;
}> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/mailbox/settings?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers, cache: "no-store" },
  );
  return parseJson(res);
}

export async function updateMailboxSettings(params: {
  workspaceId: string;
  assistanceMode?: string;
  assignThreshold?: number;
  approvalTtlHours?: number;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/mailbox/settings", {
    method: "PATCH",
    headers,
    body: JSON.stringify(params),
  });
  await parseJson(res);
}
