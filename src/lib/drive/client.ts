import { authHeaders } from "@/lib/api/auth-client";
import type {
  BrowserEvidence,
  DriveExport,
  DriveFolder,
  SavedArtifact,
  WorkspaceFile,
  WorkspaceStorageQuota,
} from "@/lib/types";
import type { DriveSection } from "@/lib/drive/constants";
import { demoDriveList, demoDriveQuota } from "@/lib/drive/demo-data";

export type DriveListResponse = {
  section: DriveSection | "all";
  folderId: string | null;
  folders: DriveFolder[];
  files: WorkspaceFile[];
  artifacts: SavedArtifact[];
  evidence: BrowserEvidence[];
  exports: DriveExport[];
  breadcrumb: DriveFolder[];
};

export type DriveDownloadResponse = {
  itemType: string;
  item: unknown;
  signedUrl: string | null;
  previewText?: string | null;
};

export type DriveItemType = "file" | "artifact" | "evidence" | "export";

async function parseJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string }).error ?? "Drive request failed.");
  }
  return payload as T;
}

export async function fetchDriveList(params: {
  workspaceId: string;
  section?: DriveSection | "all";
  folderId?: string | null;
  query?: string;
}): Promise<DriveListResponse> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.section) search.set("section", params.section);
  if (params.folderId) search.set("folderId", params.folderId);
  if (params.query?.trim()) search.set("q", params.query.trim());

  const res = await fetch(`/api/drive?${search.toString()}`, { headers });
  return parseJson(res);
}

export async function fetchDriveQuota(workspaceId: string): Promise<WorkspaceStorageQuota> {
  const headers = await authHeaders();
  const res = await fetch(`/api/drive/quota?workspaceId=${encodeURIComponent(workspaceId)}`, { headers });
  const payload = await parseJson<{ quota: WorkspaceStorageQuota }>(res);
  return payload.quota;
}

export async function createDriveFolder(payload: {
  workspaceId: string;
  name: string;
  section: DriveSection;
  parentId?: string | null;
}): Promise<DriveFolder> {
  const headers = await authHeaders();
  const res = await fetch("/api/drive/folders", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await parseJson<{ folder: DriveFolder }>(res);
  return body.folder;
}

export async function deleteDriveFolder(folderId: string, workspaceId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/drive/folders/${folderId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "DELETE", headers },
  );
  await parseJson(res);
}

export async function moveDriveItem(payload: {
  workspaceId: string;
  itemType: DriveItemType;
  itemId: string;
  folderId: string | null;
}): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch("/api/drive/move", {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  await parseJson(res);
}

export async function fetchDriveDownload(
  workspaceId: string,
  type: DriveItemType,
  id: string,
): Promise<DriveDownloadResponse> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId, type, id });
  const res = await fetch(`/api/drive/download?${search.toString()}`, { headers });
  return parseJson(res);
}

export async function exportArtifactToDriveClient(payload: {
  workspaceId: string;
  artifactId: string;
  folderId?: string | null;
}): Promise<{ exportId: string; signedUrl: string | null }> {
  const headers = await authHeaders();
  const res = await fetch("/api/drive/export", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function uploadToDrive(
  file: File,
  payload: {
    workspaceId: string;
    folderId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
  },
): Promise<WorkspaceFile> {
  const auth = (await authHeaders()) as Record<string, string>;
  const { "Content-Type": _contentType, ...headers } = auth;
  const form = new FormData();
  form.set("file", file);
  form.set("workspaceId", payload.workspaceId);
  if (payload.folderId) form.set("folderId", payload.folderId);
  if (payload.roomId) form.set("roomId", payload.roomId);
  if (payload.topicId) form.set("topicId", payload.topicId);

  const res = await fetch("/api/drive/upload", { method: "POST", headers, body: form });
  const body = await parseJson<{ file: WorkspaceFile }>(res);
  return body.file;
}

export async function uploadEvidenceToDrive(
  file: File,
  payload: {
    workspaceId: string;
    folderId?: string | null;
    title?: string;
    sourceUrl?: string;
  },
): Promise<BrowserEvidence> {
  const auth = (await authHeaders()) as Record<string, string>;
  const { "Content-Type": _contentType, ...headers } = auth;
  const form = new FormData();
  form.set("file", file);
  form.set("workspaceId", payload.workspaceId);
  if (payload.folderId) form.set("folderId", payload.folderId);
  if (payload.title) form.set("title", payload.title);
  if (payload.sourceUrl) form.set("sourceUrl", payload.sourceUrl);

  const res = await fetch("/api/drive/evidence/upload", { method: "POST", headers, body: form });
  const body = await parseJson<{ evidence: BrowserEvidence }>(res);
  return body.evidence;
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const auth = (await authHeaders()) as Record<string, string>;
  const { "Content-Type": _contentType, ...headers } = auth;
  const res = await fetch(`/api/files/${fileId}`, { method: "DELETE", headers });
  await parseJson(res);
}

export function getDemoDriveList(): DriveListResponse {
  return demoDriveList();
}

export function getDemoDriveQuota(workspaceId: string): WorkspaceStorageQuota {
  return demoDriveQuota(workspaceId);
}

export const DRIVE_UPDATED_EVENT = "adehq:drive-updated";

export function notifyDriveUpdated(): void {
  window.dispatchEvent(new CustomEvent(DRIVE_UPDATED_EVENT));
}
