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
import { DRIVE_PAGE_SIZE } from "@/lib/drive/constants";
import { demoDriveList, demoDriveQuota } from "@/lib/drive/demo-data";

export type DriveSectionCounts = {
  files: number;
  artifacts: number;
  evidence: number;
  exports: number;
};

export type DriveListResponse = {
  section: DriveSection | "all";
  folderId: string | null;
  folders: DriveFolder[];
  files: WorkspaceFile[];
  artifacts: SavedArtifact[];
  evidence: BrowserEvidence[];
  exports: DriveExport[];
  breadcrumb: DriveFolder[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  sectionCounts: DriveSectionCounts;
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
  page?: number;
  pageSize?: number;
}): Promise<DriveListResponse> {
  const headers = await authHeaders();
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.section) search.set("section", params.section);
  if (params.folderId) search.set("folderId", params.folderId);
  if (params.query?.trim()) search.set("q", params.query.trim());
  search.set("page", String(params.page ?? 1));
  search.set("pageSize", String(params.pageSize ?? DRIVE_PAGE_SIZE));

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

export type UploadProgress = {
  fileName: string;
  percent: number;
  index: number;
  total: number;
  /** Transfer = browser sending bytes; saving = server persisting to Drive. */
  phase: "transferring" | "saving";
};

function uploadFormWithProgress<T>(
  url: string,
  form: FormData,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  meta: { fileName: string; index: number; total: number },
): Promise<T> {
  return new Promise((resolve, reject) => {
    void authHeaders().then((auth) => {
      const headers = auth as Record<string, string>;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);

      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "content-type") continue;
        xhr.setRequestHeader(key, value);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (!onProgress || !event.lengthComputable) return;
        // Cap at 95% while bytes are in flight — 100% only after a 2xx response
        // so the bar does not claim success before Drive has persisted the file.
        const transferPct = Math.min(95, Math.round((event.loaded / event.total) * 95));
        onProgress({
          fileName: meta.fileName,
          index: meta.index,
          total: meta.total,
          percent: transferPct,
          phase: event.loaded >= event.total ? "saving" : "transferring",
        });
      });

      xhr.upload.addEventListener("load", () => {
        onProgress?.({
          fileName: meta.fileName,
          index: meta.index,
          total: meta.total,
          percent: 95,
          phase: "saving",
        });
      });

      xhr.addEventListener("load", () => {
        let payload: unknown = {};
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          payload = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.({
            fileName: meta.fileName,
            index: meta.index,
            total: meta.total,
            percent: 100,
            phase: "saving",
          });
          resolve(payload as T);
          return;
        }
        reject(new Error((payload as { error?: string }).error ?? "Upload failed."));
      });

      xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
      xhr.send(form);
    }).catch(reject);
  });
}

export type DriveUploadConflict = {
  originalName: string;
  displayName: string;
  existingFileId: string;
  existingDisplayName: string;
  suggestedName: string;
};

export type DriveUploadConflictResolution = "keep_both" | "replace" | "skip";

export async function checkDriveUploadConflicts(params: {
  workspaceId: string;
  folderId?: string | null;
  names: string[];
}): Promise<DriveUploadConflict[]> {
  const headers = await authHeaders();
  const res = await fetch("/api/drive/upload/conflicts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      folderId: params.folderId ?? null,
      names: params.names,
    }),
  });
  const body = await parseJson<{ conflicts: DriveUploadConflict[] }>(res);
  return body.conflicts ?? [];
}

export async function uploadToDrive(
  file: File,
  payload: {
    workspaceId: string;
    folderId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    /** Sanitized display name override (keep-both numbered name). */
    displayName?: string | null;
    /** When set, deletes this file first then uploads under the same/folder name. */
    replaceFileId?: string | null;
  },
  options?: {
    onProgress?: (progress: UploadProgress) => void;
    index?: number;
    total?: number;
  },
): Promise<WorkspaceFile> {
  const form = new FormData();
  form.set("file", file);
  form.set("workspaceId", payload.workspaceId);
  if (payload.folderId) form.set("folderId", payload.folderId);
  if (payload.roomId) form.set("roomId", payload.roomId);
  if (payload.topicId) form.set("topicId", payload.topicId);
  if (payload.displayName) form.set("displayName", payload.displayName);
  if (payload.replaceFileId) form.set("replaceFileId", payload.replaceFileId);

  const body = await uploadFormWithProgress<{ file: WorkspaceFile }>(
    "/api/drive/upload",
    form,
    options?.onProgress,
    {
      fileName: payload.displayName || file.name,
      index: options?.index ?? 1,
      total: options?.total ?? 1,
    },
  );
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
  options?: {
    onProgress?: (progress: UploadProgress) => void;
    index?: number;
    total?: number;
  },
): Promise<BrowserEvidence> {
  const form = new FormData();
  form.set("file", file);
  form.set("workspaceId", payload.workspaceId);
  if (payload.folderId) form.set("folderId", payload.folderId);
  if (payload.title) form.set("title", payload.title);
  if (payload.sourceUrl) form.set("sourceUrl", payload.sourceUrl);

  const body = await uploadFormWithProgress<{ evidence: BrowserEvidence }>(
    "/api/drive/evidence/upload",
    form,
    options?.onProgress,
    {
      fileName: file.name,
      index: options?.index ?? 1,
      total: options?.total ?? 1,
    },
  );
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
