"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import type { DriveSection } from "@/lib/drive/constants";
import { DRIVE_SECTIONS } from "@/lib/drive/constants";
import { driveUsagePercent, formatDriveBytes } from "@/lib/drive/format";
import {
  createDriveFolder,
  deleteDriveFile,
  deleteDriveFolder,
  DRIVE_UPDATED_EVENT,
  exportArtifactToDriveClient,
  fetchDriveDownload,
  fetchDriveList,
  fetchDriveQuota,
  getDemoDriveList,
  getDemoDriveQuota,
  moveDriveItem,
  notifyDriveUpdated,
  uploadEvidenceToDrive,
  uploadToDrive,
  type DriveDownloadResponse,
  type DriveItemType,
  type DriveListResponse,
  type UploadProgress,
} from "@/lib/drive/client";
import type { SavedArtifact, WorkspaceStorageQuota } from "@/lib/types";
import { ArtifactViewerModal } from "@/components/artifacts/ArtifactViewerModal";
import {
  DriveArtifactTile,
  DriveEvidenceTile,
  DriveExportTile,
  DriveFileTile,
  DriveFolderTile,
} from "@/components/drive/DriveItemTile";
import { DrivePreviewModal } from "@/components/drive/DrivePreviewModal";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  Camera,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Grid3X3,
  HardDrive,
  LayoutList,
  Loader2,
  Search,
  Upload,
} from "lucide-react";

type ViewMode = "grid" | "list";

function sectionIcon(section: DriveSection | "all") {
  if (section === "artifacts") return FileText;
  if (section === "evidence") return Camera;
  if (section === "exports") return Download;
  return Folder;
}

export default function DrivePage() {
  const { state, backend } = useStore();
  const workspaceId = state.workspace.id;
  const searchParams = useSearchParams();
  const [section, setSection] = useState<DriveSection | "all" | "quotas">("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriveListResponse | null>(null);
  const [quota, setQuota] = useState<WorkspaceStorageQuota | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [viewerArtifact, setViewerArtifact] = useState<SavedArtifact | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [preview, setPreview] = useState<DriveDownloadResponse | null>(null);
  const [dragItem, setDragItem] = useState<{ type: DriveItemType; id: string } | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  const activeSection = section === "quotas" ? "all" : section;

  useEffect(() => {
    const sectionParam = searchParams.get("section");
    const artifactParam = searchParams.get("artifact");
    if (artifactParam) {
      setSection("all");
    } else if (
      sectionParam === "files" ||
      sectionParam === "artifacts" ||
      sectionParam === "evidence" ||
      sectionParam === "exports" ||
      sectionParam === "all"
    ) {
      setSection(sectionParam);
    }
  }, [searchParams]);

  useEffect(() => {
    const artifactId = searchParams.get("artifact");
    if (!artifactId || !data?.artifacts.length) return;
    const artifact = data.artifacts.find((item) => item.id === artifactId);
    if (artifact) setViewerArtifact(artifact);
  }, [data?.artifacts, searchParams]);

  const load = useCallback(async () => {
    if (backend !== "supabase" && !ENABLE_DEMO_MODE) {
      setLoading(false);
      return;
    }
    if (backend !== "supabase") {
      setData(getDemoDriveList());
      setQuota(getDemoDriveQuota(workspaceId));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const list = await fetchDriveList({
        workspaceId,
        section: activeSection,
        folderId,
        query: query.trim() || undefined,
      });
      setData(list);
      try {
        const quotaResult = await fetchDriveQuota(workspaceId);
        setQuota(quotaResult);
      } catch (quotaErr) {
        console.warn("[AdeHQ drive] quota load failed", quotaErr);
        setError(
          quotaErr instanceof Error ? quotaErr.message : "Unable to load storage quota.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AdeHQ Drive.");
    } finally {
      setLoading(false);
    }
  }, [activeSection, backend, folderId, query, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(DRIVE_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(DRIVE_UPDATED_EVENT, refresh);
  }, [load]);

  const itemCount = useMemo(() => {
    if (!data) return 0;
    return (
      data.folders.length +
      data.files.length +
      data.artifacts.length +
      data.evidence.length +
      data.exports.length
    );
  }, [data]);

  const sectionCounts = useMemo(() => {
    if (!data) return null;
    return {
      files: data.files.length,
      artifacts: data.artifacts.length,
      evidence: data.evidence.length,
      exports: data.exports.length,
    };
  }, [data]);

  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    setFolderBusy(true);
    setError(null);
    try {
      const targetSection: DriveSection =
        activeSection === "all" ? "files" : activeSection;
      await createDriveFolder({
        workspaceId,
        name,
        section: targetSection,
        parentId: folderId,
      });
      setFolderModalOpen(false);
      setFolderName("");
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create folder.");
    } finally {
      setFolderBusy(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || backend !== "supabase") return;
    const fileList = Array.from(files);
    setUploadBusy(true);
    setUploadProgress(null);
    setError(null);
    try {
      for (const [index, file] of fileList.entries()) {
        const progressMeta = {
          index: index + 1,
          total: fileList.length,
          onProgress: (progress: UploadProgress) => setUploadProgress(progress),
        };
        if (section === "evidence" || activeSection === "evidence") {
          await uploadEvidenceToDrive(file, { workspaceId, folderId }, progressMeta);
        } else {
          await uploadToDrive(file, { workspaceId, folderId }, progressMeta);
        }
      }
      try {
        setQuota(await fetchDriveQuota(workspaceId));
      } catch {
        // list refresh below will still run
      }
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    }
  };

  const handlePreview = async (type: DriveItemType, id: string) => {
    if (backend !== "supabase") return;
    setError(null);
    try {
      const result = await fetchDriveDownload(workspaceId, type, id);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview item.");
    }
  };

  const handleDownload = async (type: DriveItemType, id: string) => {
    if (backend !== "supabase") return;
    setError(null);
    try {
      const result = await fetchDriveDownload(workspaceId, type, id);
      if (result.signedUrl) {
        window.open(result.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        setError("No download URL available for this item.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download item.");
    }
  };

  const handleMoveItem = async (itemType: DriveItemType, itemId: string, targetFolderId: string | null) => {
    if (backend !== "supabase") return;
    setError(null);
    try {
      await moveDriveItem({ workspaceId, itemType, itemId, folderId: targetFolderId });
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move item.");
    }
  };

  const handleExportArtifact = async () => {
    if (!viewerArtifact || backend !== "supabase") return;
    setExportBusy(true);
    setError(null);
    try {
      const result = await exportArtifactToDriveClient({
        workspaceId,
        artifactId: viewerArtifact.id,
        folderId,
      });
      if (result.signedUrl) window.open(result.signedUrl, "_blank");
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!window.confirm("Delete this folder? It must be empty first.")) return;
    setError(null);
    try {
      await deleteDriveFolder(id, workspaceId);
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete folder.");
    }
  };

  const handleDeleteFile = async (id: string) => {
    if (!window.confirm("Delete this file permanently?")) return;
    setError(null);
    try {
      await deleteDriveFile(id);
      notifyDriveUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete file.");
    }
  };

  const usagePct = quota ? driveUsagePercent(quota.usedBytes, quota.maxWorkspaceBytes) : 0;

  return (
    <PageContainer wide className="pb-10">
      <PageHeader
        title="AdeHQ Drive"
        subtitle="Files, spreadsheets, artifacts, and evidence — organized with clear file types and one-click downloads."
        icon={<HardDrive className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <input
              ref={evidenceInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={uploadBusy || section === "quotas" || backend !== "supabase"}
              onClick={() => {
                if (section === "evidence" || activeSection === "evidence") {
                  evidenceInputRef.current?.click();
                } else {
                  fileInputRef.current?.click();
                }
              }}
            >
              {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={section === "quotas"}
              onClick={() => setFolderModalOpen(true)}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </Button>
          </div>
        }
      />

      {uploadProgress && (
        <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              Uploading {uploadProgress.fileName}
              {uploadProgress.total > 1
                ? ` (${uploadProgress.index} of ${uploadProgress.total})`
                : ""}
            </p>
            <span className="text-xs text-ink-3">{uploadProgress.percent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {quota && (
        <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Storage quota</p>
              <p className="text-xs text-ink-3">
                {formatDriveBytes(quota.usedBytes)} of {formatDriveBytes(quota.maxWorkspaceBytes)} used ·{" "}
                {quota.planTier} plan · max {formatDriveBytes(quota.maxFileBytes)} per file
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-ink-2">
              {usagePct}% full
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                usagePct >= 90 ? "bg-rose-500" : usagePct >= 70 ? "bg-amber-500" : "bg-accent",
              )}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-56">
          <nav className="space-y-1 rounded-2xl border border-border bg-surface p-2">
            {[...DRIVE_SECTIONS, { id: "quotas" as const, label: "Quotas" }].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  if (item.id !== section) setFolderId(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  section === item.id
                    ? "bg-accent-soft text-accent-d font-medium"
                    : "text-ink-2 hover:bg-muted hover:text-ink",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {item.id === "quotas" ? (
                    <HardDrive className="h-4 w-4 shrink-0" />
                  ) : item.id === "exports" ? (
                    <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  ) : (
                    (() => {
                      const Icon = sectionIcon(item.id);
                      return <Icon className="h-4 w-4 shrink-0" />;
                    })()
                  )}
                  <span className="truncate">{item.label}</span>
                </span>
                {sectionCounts && item.id in sectionCounts && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-ink-3">
                    {sectionCounts[item.id as keyof typeof sectionCounts]}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {section === "quotas" ? (
            <QuotaPanel quota={quota} />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search in Drive"
                    className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
                  />
                </div>
                <div className="flex rounded-xl border border-border bg-surface p-0.5">
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg p-2",
                      viewMode === "grid" ? "bg-muted text-ink" : "text-ink-3",
                    )}
                    onClick={() => setViewMode("grid")}
                    aria-label="Grid view"
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg p-2",
                      viewMode === "list" ? "bg-muted text-ink" : "text-ink-3",
                    )}
                    onClick={() => setViewMode("list")}
                    aria-label="List view"
                  >
                    <LayoutList className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {data && data.breadcrumb.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-ink-2">
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-ink"
                    onClick={() => setFolderId(null)}
                  >
                    My Drive
                  </button>
                  {data.breadcrumb.map((folder) => (
                    <span key={folder.id} className="flex items-center gap-1">
                      <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
                      <button
                        type="button"
                        className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-ink"
                        onClick={() => setFolderId(folder.id)}
                      >
                        {folder.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {error && (
                <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </p>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-20 text-sm text-ink-3">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading Drive…
                </div>
              ) : itemCount === 0 ? (
                <EmptyState
                  icon={HardDrive}
                  title="This folder is empty"
                  description="Upload files or create folders to organize your workspace knowledge."
                />
              ) : (
                <DriveItemsGrid
                  data={data!}
                  viewMode={viewMode}
                  dragItem={dragItem}
                  dropTargetFolderId={dropTargetFolderId}
                  onDragStart={(type, id) => setDragItem({ type, id })}
                  onDragEnd={() => {
                    setDragItem(null);
                    setDropTargetFolderId(null);
                  }}
                  onDropOnFolder={(folderId) => {
                    if (dragItem) void handleMoveItem(dragItem.type, dragItem.id, folderId);
                    setDragItem(null);
                    setDropTargetFolderId(null);
                  }}
                  onFolderDragEnter={setDropTargetFolderId}
                  onOpenFolder={setFolderId}
                  onDeleteFolder={handleDeleteFolder}
                  onDeleteFile={handleDeleteFile}
                  onOpenArtifact={setViewerArtifact}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={folderModalOpen} onClose={() => setFolderModalOpen(false)}>
        <ModalHeader title="New folder" onClose={() => setFolderModalOpen(false)} />
        <div className="space-y-4 p-4">
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Folder name"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateFolder();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFolderModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={folderBusy || !folderName.trim()} onClick={() => void handleCreateFolder()}>
              {folderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create folder
            </Button>
          </div>
        </div>
      </Modal>

      {viewerArtifact && (
        <ArtifactViewerModal
          artifact={viewerArtifact}
          onClose={() => setViewerArtifact(null)}
          onExportToDrive={backend === "supabase" ? () => void handleExportArtifact() : undefined}
          exportBusy={exportBusy}
        />
      )}

      <DrivePreviewModal preview={preview} onClose={() => setPreview(null)} />
    </PageContainer>
  );
}

function QuotaPanel({ quota }: { quota: WorkspaceStorageQuota | null }) {
  if (!quota) return null;
  const pct = driveUsagePercent(quota.usedBytes, quota.maxWorkspaceBytes);
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">Workspace quotas</h2>
      <p className="mt-1 text-sm text-ink-3">
        AdeHQ enforces app-level limits on top of Supabase bucket settings. Supabase project limits apply separately.
      </p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Plan</dt>
          <dd className="mt-1 text-lg font-semibold capitalize text-ink">{quota.planTier}</dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Workspace storage</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {formatDriveBytes(quota.usedBytes)} / {formatDriveBytes(quota.maxWorkspaceBytes)}
          </dd>
          <dd className="text-xs text-ink-3">{pct}% used</dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Max file size</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">{formatDriveBytes(quota.maxFileBytes)}</dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Per-file limit</dt>
          <dd className="mt-1 text-sm text-ink-2">
            Up to {formatDriveBytes(quota.maxFileBytes)} per upload on your {quota.planTier} plan
          </dd>
        </div>
      </dl>
    </div>
  );
}

function DriveItemsGrid({
  data,
  viewMode,
  dragItem,
  dropTargetFolderId,
  onDragStart,
  onDragEnd,
  onDropOnFolder,
  onFolderDragEnter,
  onOpenFolder,
  onDeleteFolder,
  onDeleteFile,
  onOpenArtifact,
  onPreview,
  onDownload,
}: {
  data: DriveListResponse;
  viewMode: ViewMode;
  dragItem: { type: DriveItemType; id: string } | null;
  dropTargetFolderId: string | null;
  onDragStart: (type: DriveItemType, id: string) => void;
  onDragEnd: () => void;
  onDropOnFolder: (folderId: string) => void;
  onFolderDragEnter: (folderId: string | null) => void;
  onOpenFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onOpenArtifact: (artifact: SavedArtifact) => void;
  onPreview: (type: DriveItemType, id: string) => void;
  onDownload: (type: DriveItemType, id: string) => void;
}) {
  const gridClass =
    viewMode === "grid"
      ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      : "flex flex-col gap-2";

  return (
    <div className={gridClass}>
      {data.folders.map((folder) => (
        <DriveFolderTile
          key={folder.id}
          viewMode={viewMode}
          name={folder.name}
          dropHighlight={dropTargetFolderId === folder.id}
          onDragOver={(e) => {
            if (!dragItem) return;
            e.preventDefault();
            onFolderDragEnter(folder.id);
          }}
          onDragLeave={() => onFolderDragEnter(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (dragItem) onDropOnFolder(folder.id);
          }}
          onOpen={() => onOpenFolder(folder.id)}
          onDelete={() => void onDeleteFolder(folder.id)}
        />
      ))}
      {data.files.map((file) => (
        <DriveFileTile
          key={file.id}
          viewMode={viewMode}
          file={file}
          draggable
          onDragStart={() => onDragStart("file", file.id)}
          onDragEnd={onDragEnd}
          onPreview={() => onPreview("file", file.id)}
          onDownload={() => onDownload("file", file.id)}
          onDelete={() => void onDeleteFile(file.id)}
        />
      ))}
      {data.artifacts.map((artifact) => (
        <DriveArtifactTile
          key={artifact.id}
          viewMode={viewMode}
          artifact={artifact}
          draggable
          onDragStart={() => onDragStart("artifact", artifact.id)}
          onDragEnd={onDragEnd}
          onOpen={() => onOpenArtifact(artifact)}
          onPreview={() => onPreview("artifact", artifact.id)}
        />
      ))}
      {data.evidence.map((item) => (
        <DriveEvidenceTile
          key={item.id}
          viewMode={viewMode}
          item={item}
          draggable
          onDragStart={() => onDragStart("evidence", item.id)}
          onDragEnd={onDragEnd}
          onPreview={() => onPreview("evidence", item.id)}
          onDownload={() => onDownload("evidence", item.id)}
        />
      ))}
      {data.exports.map((item) => (
        <DriveExportTile
          key={item.id}
          viewMode={viewMode}
          item={item}
          draggable
          onDragStart={() => onDragStart("export", item.id)}
          onDragEnd={onDragEnd}
          onPreview={() => onPreview("export", item.id)}
          onDownload={() => onDownload("export", item.id)}
        />
      ))}
    </div>
  );
}
