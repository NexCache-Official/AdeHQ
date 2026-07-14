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
  labelId?: string | null;
}): Promise<ThreadPageDTO> {
  const headers = await authHeaders();
  const search = new URLSearchParams({
    workspaceId: params.workspaceId,
    folder: params.folder,
  });
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.labelId) search.set("label", params.labelId);
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
  humanId?: string | null;
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

export async function postInternalNoteReq(params: {
  workspaceId: string;
  threadId: string;
  text: string;
}): Promise<{ message: import("./types").MessageDTO }> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/notes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    },
  );
  return parseJson(res);
}

export async function fetchAttachmentUrl(params: {
  workspaceId: string;
  attachmentId: string;
}): Promise<{ url: string; filename: string | null }> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/inbox/attachments/${encodeURIComponent(params.attachmentId)}?${search}`,
    { headers },
  );
  return parseJson(res);
}

export async function fetchInboxBrief(workspaceId: string): Promise<{
  greeting: string;
  mailboxAddress: string;
  stats: {
    unread: number;
    needsApproval: number;
    highPriority: number;
    assignedToMe: number;
  };
}> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/brief?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers, cache: "no-store" },
  );
  return parseJson(res);
}

export async function fetchInboxUnreadCount(workspaceId: string): Promise<number> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/unread-count?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers, cache: "no-store" },
  );
  const body = await parseJson<{ count: number }>(res);
  return body.count ?? 0;
}

export async function fetchMailboxMembers(workspaceId: string): Promise<
  Array<{ id: string; name: string; email: string | null; role: string }>
> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/mailbox/members?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers, cache: "no-store" },
  );
  const body = await parseJson<{ members: Array<{ id: string; name: string; email: string | null; role: string }> }>(
    res,
  );
  return body.members;
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

function newClientActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function postWorkAction<T>(
  threadId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers = await authHeaders();
  const clientActionId =
    typeof body.clientActionId === "string" && body.clientActionId
      ? body.clientActionId
      : newClientActionId();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(threadId)}/work/${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...body,
        clientActionId,
      }),
    },
  );
  return parseJson(res);
}

export { newClientActionId };

export async function fetchThreadWorkContext(params: {
  workspaceId: string;
  threadId: string;
}): Promise<{
  workContext: {
    subject: string;
    keyPoints: string[];
    excerpt: string;
    inboxDeepLink: string;
    sourceSnapshotAt: string;
  };
  linkedWork: Array<{
    edgeId: string;
    relationType: string;
    objectType: string;
    objectId: string;
    title: string;
    href: string | null;
    stale: boolean;
    provenance: {
      sourceSnapshotAt: string;
    } | null;
    meta?: Record<string, unknown>;
  }>;
  recommendedAction: {
    kind: "create_task" | "start_room" | "save_memory" | "none";
    label: string;
    detail: string;
  };
  dealId: string | null;
  contactId: string | null;
  keyPointSuggestions: string[];
  crm: {
    contact: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      companyName: string | null;
      companyId: string | null;
    } | null;
    deal: {
      id: string;
      name: string;
      stageName: string;
      amount: number | null;
      status: string;
    } | null;
    suggestedContact: { email: string; name: string | null } | null;
    openFollowUps: Array<{
      taskId: string;
      title: string;
      dueDate: string | null;
      status: string;
    }>;
  };
}> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/context?${search}`,
    { headers, cache: "no-store" },
  );
  return parseJson(res);
}

export async function inboxStartRoom(params: {
  workspaceId: string;
  threadId: string;
  roomName?: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "start-room", params);
}

export async function inboxLinkRoom(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  seedBridge?: boolean;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "link-room", params);
}

export async function inboxLinkTopic(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  topicId?: string;
  topicTitle?: string;
}) {
  return postWorkAction(params.threadId, "link-topic", params);
}

export async function inboxCreateTask(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  topicId?: string;
  title: string;
  description?: string;
  assigneeEmployeeId?: string | null;
}) {
  return postWorkAction(params.threadId, "create-task", params);
}

export async function inboxAskEmployee(params: {
  workspaceId: string;
  threadId: string;
  employeeId: string;
  target: "dm" | "room";
  roomId?: string;
  topicId?: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "ask-employee", params);
}

export async function inboxCreateProposal(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  topicId?: string;
  title?: string;
}) {
  return postWorkAction(params.threadId, "create-proposal", params);
}

export async function inboxPrepareProposal(params: {
  workspaceId: string;
  threadId: string;
  employeeId: string;
  roomId: string;
  topicId?: string;
  artifactId?: string;
}) {
  return postWorkAction(params.threadId, "prepare-proposal", params);
}

export async function inboxSaveDecision(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  topicId?: string;
  decisionStatement: string;
  rationale: string;
  ownerName?: string;
  decisionDate?: string;
  alternatives?: string;
  consequences?: string;
}) {
  return postWorkAction(params.threadId, "save-decision", params);
}

export async function inboxAttachDeal(params: {
  workspaceId: string;
  threadId: string;
  dealId: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "attach-deal", params);
}

export async function inboxAttachContact(params: {
  workspaceId: string;
  threadId: string;
  contactId: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "attach-contact", params);
}

export async function inboxCreateContact(params: {
  workspaceId: string;
  threadId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "create-contact", params);
}

export async function inboxDetachContact(params: {
  workspaceId: string;
  threadId: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "detach-contact", params);
}

export async function inboxCreateFollowUp(params: {
  workspaceId: string;
  threadId: string;
  roomId: string;
  topicId?: string;
  title: string;
  dueDate: string;
  description?: string;
  clientActionId?: string;
}) {
  return postWorkAction(params.threadId, "create-follow-up", params);
}

export async function fetchInboxLabels(params: { workspaceId: string }) {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  const res = await fetch(`/api/inbox/labels?${search}`, {
    headers,
    cache: "no-store",
  });
  return parseJson(res) as Promise<{
    labels: Array<{ id: string; name: string; color: string | null }>;
  }>;
}

export async function setThreadLabels(params: {
  workspaceId: string;
  threadId: string;
  labelIds: string[];
}) {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/inbox/threads/${encodeURIComponent(params.threadId)}/labels`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        labelIds: params.labelIds,
      }),
    },
  );
  return parseJson(res);
}

export async function createInboxLabel(params: {
  workspaceId: string;
  name: string;
  color?: string | null;
}) {
  const headers = await authHeaders();
  const res = await fetch("/api/inbox/labels", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  return parseJson(res) as Promise<{
    label: { id: string; name: string; color: string | null };
  }>;
}

export async function inboxSaveMemory(params: {
  workspaceId: string;
  threadId: string;
  title: string;
  content: string;
  roomId?: string | null;
}) {
  return postWorkAction(params.threadId, "memory", params);
}

export async function inboxUnlinkWork(params: {
  workspaceId: string;
  threadId: string;
  edgeId: string;
}) {
  return postWorkAction(params.threadId, "unlink", params);
}
