import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrowserEvidence,
  DriveExport,
  DriveFolder,
  DriveSection,
  SavedArtifact,
  WorkspaceFile,
} from "@/lib/types";
import { artifactFromRow, workspaceFileFromRow } from "@/lib/files/records";
import { driveFolderFromRow } from "@/lib/drive/quota";
import { DRIVE_MERGE_FETCH_CAP, DRIVE_PAGE_SIZE } from "@/lib/drive/constants";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export type DriveSectionCounts = {
  files: number;
  artifacts: number;
  evidence: number;
  exports: number;
};

export type DriveListPayload = {
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

export function browserEvidenceFromRow(row: DbRow): BrowserEvidence {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    driveFolderId: row.drive_folder_id ? String(row.drive_folder_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    storageBucket: String(row.storage_bucket ?? "adehq-browser-evidence"),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type ?? "image/png"),
    sizeBytes: Number(row.size_bytes ?? 0),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    capturedAt: row.captured_at ? String(row.captured_at) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export function driveExportFromRow(row: DbRow): DriveExport {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    driveFolderId: row.drive_folder_id ? String(row.drive_folder_id) : null,
    title: String(row.title),
    exportType: row.export_type as DriveExport["exportType"],
    storageBucket: String(row.storage_bucket ?? "adehq-exports"),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    sourceArtifactIds: Array.isArray(row.source_artifact_ids)
      ? row.source_artifact_ids.map(String)
      : [],
    sourceFileIds: Array.isArray(row.source_file_ids) ? row.source_file_ids.map(String) : [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

async function buildBreadcrumb(
  client: SupabaseClient,
  workspaceId: string,
  folderId: string | null,
): Promise<DriveFolder[]> {
  if (!folderId) return [];
  const trail: DriveFolder[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const { data, error } = await client
      .from("drive_folders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", currentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) break;
    const folder = driveFolderFromRow(data as DbRow);
    trail.unshift(folder);
    currentId = folder.parentId ?? null;
  }

  return trail;
}

async function loadSectionCounts(
  client: SupabaseClient,
  workspaceId: string,
): Promise<DriveSectionCounts> {
  const [filesRes, artifactsRes, evidenceRes, exportsRes] = await Promise.all([
    client
      .from("workspace_files")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    client
      .from("artifacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .neq("status", "archived"),
    client
      .from("browser_evidence")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    client
      .from("drive_exports")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  return {
    files: filesRes.count ?? 0,
    artifacts: artifactsRes.count ?? 0,
    evidence: evidenceRes.count ?? 0,
    exports: exportsRes.count ?? 0,
  };
}

type DatedItem =
  | { type: "file"; createdAt: string; file: WorkspaceFile }
  | { type: "artifact"; createdAt: string; artifact: SavedArtifact }
  | { type: "evidence"; createdAt: string; evidence: BrowserEvidence }
  | { type: "export"; createdAt: string; export: DriveExport };

function filterByQuery<T>(
  items: T[],
  q: string | undefined,
  getName: (item: T) => string,
): T[] {
  if (!q) return items;
  return items.filter((item) => getName(item).toLowerCase().includes(q));
}

export async function listDriveContents(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    section: DriveSection | "all";
    folderId?: string | null;
    query?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<DriveListPayload> {
  const folderId = params.folderId ?? null;
  const q = params.query?.trim().toLowerCase() || undefined;
  const pageSize = Math.min(Math.max(params.pageSize ?? DRIVE_PAGE_SIZE, 12), 96);
  const page = Math.max(params.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let foldersQuery = client
    .from("drive_folders")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .order("name", { ascending: true });

  if (params.section !== "all") {
    foldersQuery = foldersQuery.eq("section", params.section);
  }

  foldersQuery = folderId
    ? foldersQuery.eq("parent_id", folderId)
    : foldersQuery.is("parent_id", null);

  const breadcrumb = await buildBreadcrumb(client, params.workspaceId, folderId);
  const sectionCounts = await loadSectionCounts(client, params.workspaceId);

  // My Drive = library files only. Artifacts stay in the dedicated Artifacts section.
  const includeFiles = params.section === "all" || params.section === "files";
  const includeArtifacts = params.section === "artifacts";
  const includeEvidence = params.section === "all" || params.section === "evidence";
  const includeExports = params.section === "all" || params.section === "exports";

  const singleType =
    params.section === "files" ||
    params.section === "artifacts" ||
    params.section === "evidence" ||
    params.section === "exports";

  const fetchLimit = singleType && !q ? pageSize : DRIVE_MERGE_FETCH_CAP;
  const fetchFrom = singleType && !q ? from : 0;
  const fetchTo = singleType && !q ? to : fetchLimit - 1;

  const [foldersResult, filesResult, artifactsResult, evidenceResult, exportsResult] =
    await Promise.all([
      foldersQuery,
      includeFiles
        ? (() => {
            let query = client
              .from("workspace_files")
              // Never select extracted_text in the list — it can be huge and is unused in the grid.
              .select(
                "id, workspace_id, room_id, topic_id, drive_folder_id, drive_section, uploaded_by_user_id, original_name, display_name, mime_type, extension, size_bytes, storage_bucket, storage_path, status, parse_status, text_preview, page_count, sheet_count, row_count, checksum, source_metadata, error_message, created_at, updated_at",
                singleType && !q ? { count: "exact" } : undefined,
              )
              .eq("workspace_id", params.workspaceId)
              .order("created_at", { ascending: false })
              .range(fetchFrom, fetchTo);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            if (params.section === "files") {
              query = query.eq("drive_section", "files");
            }
            return query;
          })()
        : Promise.resolve({ data: [], error: null, count: 0 }),
      includeArtifacts
        ? (() => {
            let query = client
              .from("artifacts")
              .select("*", singleType && !q ? { count: "exact" } : undefined)
              .eq("workspace_id", params.workspaceId)
              .neq("status", "archived")
              .order("created_at", { ascending: false })
              .range(fetchFrom, fetchTo);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null, count: 0 }),
      includeEvidence
        ? (() => {
            let query = client
              .from("browser_evidence")
              .select("*", singleType && !q ? { count: "exact" } : undefined)
              .eq("workspace_id", params.workspaceId)
              .order("created_at", { ascending: false })
              .range(fetchFrom, fetchTo);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null, count: 0 }),
      includeExports
        ? (() => {
            let query = client
              .from("drive_exports")
              .select("*", singleType && !q ? { count: "exact" } : undefined)
              .eq("workspace_id", params.workspaceId)
              .order("created_at", { ascending: false })
              .range(fetchFrom, fetchTo);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null, count: 0 }),
    ]);

  if (foldersResult.error) throw foldersResult.error;
  if (filesResult.error) throw filesResult.error;
  if (artifactsResult.error) throw artifactsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  if (exportsResult.error) throw exportsResult.error;

  const folders = filterByQuery(
    ((foldersResult.data ?? []) as DbRow[]).map(driveFolderFromRow),
    q,
    (f) => f.name,
  );
  let files = filterByQuery(
    ((filesResult.data ?? []) as DbRow[]).map(workspaceFileFromRow),
    q,
    (f) => f.displayName,
  );
  let artifacts = filterByQuery(
    ((artifactsResult.data ?? []) as DbRow[]).map(artifactFromRow),
    q,
    (a) => a.title,
  );
  let evidence = filterByQuery(
    ((evidenceResult.data ?? []) as DbRow[]).map(browserEvidenceFromRow),
    q,
    (e) => e.title,
  );
  let exports = filterByQuery(
    ((exportsResult.data ?? []) as DbRow[]).map(driveExportFromRow),
    q,
    (e) => e.title,
  );

  // Hide markdown twins of binary exports inside Artifacts when browsing All
  // (artifacts are already excluded from All; keep for exports-linked cleanup if reused).
  if (params.section !== "artifacts" && artifacts.length && exports.length) {
    const artifactIdsWithBinaryExport = new Set<string>();
    for (const item of exports) {
      for (const id of item.sourceArtifactIds ?? []) {
        if (id) artifactIdsWithBinaryExport.add(id);
      }
    }
    artifacts = artifacts.filter((artifact) => {
      const meta = artifact.metadata ?? {};
      const isBinaryCompanion =
        meta.binaryCompanion === true ||
        meta.integrationGenerated === true ||
        Boolean(meta.binaryExportExt);
      if (!isBinaryCompanion) return true;
      return !artifactIdsWithBinaryExport.has(artifact.id);
    });
  }

  // Folders stay pinned to page 1 (Google Drive-style); pagination applies to files.
  const pageFolders = page === 1 ? folders : [];
  let totalItems = 0;

  if (singleType && !q) {
    totalItems =
      params.section === "files"
        ? (filesResult.count ?? files.length)
        : params.section === "artifacts"
          ? (artifactsResult.count ?? artifacts.length)
          : params.section === "evidence"
            ? (evidenceResult.count ?? evidence.length)
            : (exportsResult.count ?? exports.length);
  } else {
    const dated: DatedItem[] = [
      ...files.map((file) => ({ type: "file" as const, createdAt: file.createdAt, file })),
      ...artifacts.map((artifact) => ({
        type: "artifact" as const,
        createdAt: artifact.createdAt,
        artifact,
      })),
      ...evidence.map((item) => ({
        type: "evidence" as const,
        createdAt: item.createdAt,
        evidence: item,
      })),
      ...exports.map((item) => ({
        type: "export" as const,
        createdAt: item.createdAt,
        export: item,
      })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

    totalItems = dated.length;
    const slice = dated.slice(from, from + pageSize);
    files = slice.filter((i) => i.type === "file").map((i) => i.file);
    artifacts = slice.filter((i) => i.type === "artifact").map((i) => i.artifact);
    evidence = slice.filter((i) => i.type === "evidence").map((i) => i.evidence);
    exports = slice.filter((i) => i.type === "export").map((i) => i.export);
  }

  return {
    section: params.section,
    folderId,
    folders: pageFolders,
    files,
    artifacts,
    evidence,
    exports,
    breadcrumb,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize) || 1),
    sectionCounts,
  };
}
