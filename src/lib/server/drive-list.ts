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
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

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

export async function listDriveContents(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    section: DriveSection | "all";
    folderId?: string | null;
    query?: string;
  },
): Promise<{
  section: DriveSection | "all";
  folderId: string | null;
  folders: DriveFolder[];
  files: WorkspaceFile[];
  artifacts: SavedArtifact[];
  evidence: BrowserEvidence[];
  exports: DriveExport[];
  breadcrumb: DriveFolder[];
}> {
  const folderId = params.folderId ?? null;
  const q = params.query?.trim().toLowerCase();

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

  const includeFiles = params.section === "all" || params.section === "files";
  const includeArtifacts = params.section === "all" || params.section === "artifacts";
  const includeEvidence = params.section === "all" || params.section === "evidence";
  const includeExports = params.section === "all" || params.section === "exports";

  const [foldersResult, filesResult, artifactsResult, evidenceResult, exportsResult] =
    await Promise.all([
      foldersQuery,
      includeFiles
        ? (() => {
            let query = client
              .from("workspace_files")
              .select("*")
              .eq("workspace_id", params.workspaceId)
              .neq("status", "failed")
              .order("created_at", { ascending: false })
              .limit(200);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            if (params.section === "files") {
              query = query.eq("drive_section", "files");
            }
            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
      includeArtifacts
        ? (() => {
            let query = client
              .from("artifacts")
              .select("*")
              .eq("workspace_id", params.workspaceId)
              .neq("status", "archived")
              .order("created_at", { ascending: false })
              .limit(200);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
      includeEvidence
        ? (() => {
            let query = client
              .from("browser_evidence")
              .select("*")
              .eq("workspace_id", params.workspaceId)
              .order("created_at", { ascending: false })
              .limit(200);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
      includeExports
        ? (() => {
            let query = client
              .from("drive_exports")
              .select("*")
              .eq("workspace_id", params.workspaceId)
              .order("created_at", { ascending: false })
              .limit(200);
            query = folderId
              ? query.eq("drive_folder_id", folderId)
              : query.is("drive_folder_id", null);
            return query;
          })()
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (foldersResult.error) throw foldersResult.error;
  if (filesResult.error) throw filesResult.error;
  if (artifactsResult.error) throw artifactsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  if (exportsResult.error) throw exportsResult.error;

  const filterName = <T extends { title?: string; displayName?: string; name?: string }>(
    items: T[],
    getName: (item: T) => string,
  ) => {
    if (!q) return items;
    return items.filter((item) => getName(item).toLowerCase().includes(q));
  };

  const folders = ((foldersResult.data ?? []) as DbRow[]).map(driveFolderFromRow);
  const files = filterName(
    ((filesResult.data ?? []) as DbRow[]).map(workspaceFileFromRow),
    (f) => f.displayName,
  );
  const allArtifacts = filterName(
    ((artifactsResult.data ?? []) as DbRow[]).map(artifactFromRow),
    (a) => a.title,
  );
  const evidence = filterName(
    ((evidenceResult.data ?? []) as DbRow[]).map(browserEvidenceFromRow),
    (e) => e.title,
  );
  const exports = filterName(
    ((exportsResult.data ?? []) as DbRow[]).map(driveExportFromRow),
    (e) => e.title,
  );

  // Binary create* jobs also write a markdown "AI source" twin. Keep those under
  // the AI notes section only so All / Exports stay focused on real files.
  const artifactIdsWithBinaryExport = new Set<string>();
  for (const item of exports) {
    for (const id of item.sourceArtifactIds ?? []) {
      if (id) artifactIdsWithBinaryExport.add(id);
    }
  }
  const artifacts =
    params.section === "artifacts"
      ? allArtifacts
      : allArtifacts.filter((artifact) => {
          const meta = artifact.metadata ?? {};
          const isBinaryCompanion =
            meta.binaryCompanion === true ||
            meta.integrationGenerated === true ||
            Boolean(meta.binaryExportExt);
          if (!isBinaryCompanion) return true;
          return !artifactIdsWithBinaryExport.has(artifact.id);
        });

  return {
    section: params.section,
    folderId,
    folders,
    files,
    artifacts,
    evidence,
    exports,
    breadcrumb,
  };
}
