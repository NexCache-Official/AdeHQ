"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import type { DriveSection } from "@/lib/drive/constants";
import { DRIVE_PAGE_SIZE, DRIVE_SECTIONS } from "@/lib/drive/constants";
import { driveUsagePercent, formatDriveBytes } from "@/lib/drive/format";
import {
  checkDriveUploadConflicts,
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
  type DriveUploadConflict,
  type DriveUploadConflictResolution,
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
import { ResizablePane } from "@/components/layout/ResizablePane";
import { PANE_PRESETS } from "@/lib/layout/pane-prefs";
import { cn } from "@/lib/utils";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Folder,
  FolderPlus,
  Grid3X3,
  HardDrive,
  LayoutList,
  Loader2,
  Package,
  Search,
  Upload,
} from "lucide-react";

type ViewMode = "grid" | "list";

function sectionIcon(section: DriveSection | "all") {
  if (section === "artifacts") return Package;
  if (section === "evidence") return Camera;
  if (section === "exports") return FileSpreadsheet;
  if (section === "files") return Upload;
  return Folder;
}

export default function DrivePage() {
  const { state, backend } = useStore();
  const workspaceId = state.workspace.id;
  const searchParams = useSearchParams();
  const [section, setSection] = useState<DriveSection | "all" | "quotas">("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
  const [uploadConflicts, setUploadConflicts] = useState<DriveUploadConflict[]>([]);
  const [conflictIndex, setConflictIndex] = useState(0);
  const [applyConflictToRest, setApplyConflictToRest] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  /** Ignore stale list responses when section/upload triggers overlapping loads. */
  const loadSeqRef = useRef(0);
  const pendingUploadRef = useRef<{
    files: File[];
    listSection: DriveSection | "all";
    uploadingEvidence: boolean;
    /** Keyed by upload slot index so two files with the same name stay distinct. */
    resolutions: Map<
      number,
      { resolution: DriveUploadConflictResolution; conflict: DriveUploadConflict }
    >;
    conflictSlots: Array<{ fileIndex: number; conflict: DriveUploadConflict }>;
  } | null>(null);

  const activeSection = section === "quotas" ? "all" : section;

  useEffect(() => {
    const sectionParam = searchParams.get("section");
    const artifactParam = searchParams.get("artifact");
    const exportParam = searchParams.get("export");
    if (exportParam) {
      setSection("exports");
    } else if (artifactParam) {
      setSection("artifacts");
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

  const load = useCallback(async (overrides?: {
    section?: DriveSection | "all";
    folderId?: string | null;
    page?: number;
    query?: string;
  }) => {
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

    const seq = ++loadSeqRef.current;
    const sectionToLoad = overrides?.section ?? activeSection;
    const folderToLoad = overrides?.folderId !== undefined ? overrides.folderId : folderId;
    const pageToLoad = overrides?.page ?? page;
    const queryToLoad = overrides?.query !== undefined ? overrides.query : query;

    setLoading(true);
    setError(null);
    try {
      // Bound the request so a hung API never leaves the page on
      // "Loading Drive…" forever (seen in SaaS CEO E2E).
      const list = await Promise.race([
        fetchDriveList({
          workspaceId,
          section: sectionToLoad,
          folderId: folderToLoad,
          query: queryToLoad.trim() || undefined,
          page: pageToLoad,
          pageSize: DRIVE_PAGE_SIZE,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Drive is taking too long to load. Try again.")),
            25_000,
          );
        }),
      ]);
      if (seq !== loadSeqRef.current) return;
      setData(list);
      try {
        const quotaResult = await fetchDriveQuota(workspaceId);
        if (seq !== loadSeqRef.current) return;
        setQuota(quotaResult);
      } catch (quotaErr) {
        console.warn("[AdeHQ drive] quota load failed", quotaErr);
        if (seq !== loadSeqRef.current) return;
        setError(
          quotaErr instanceof Error ? quotaErr.message : "Unable to load storage quota.",
        );
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load AdeHQ Drive.");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [activeSection, backend, folderId, page, query, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [activeSection, folderId, query]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(DRIVE_UPDATED_EVENT, refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(DRIVE_UPDATED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  const sectionCounts = data?.sectionCounts ?? null;
  const totalPages = data?.totalPages ?? 1;
  const totalItems = data?.totalItems ?? 0;
  const rangeStart = totalItems === 0 ? 0 : (page - 1) * DRIVE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * DRIVE_PAGE_SIZE, totalItems);

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

  const runUploadBatch = async (params: {
    files: File[];
    listSection: DriveSection | "all";
    uploadingEvidence: boolean;
    resolutions: Map<
      number,
      { resolution: DriveUploadConflictResolution; conflict: DriveUploadConflict }
    >;
  }) => {
    setUploadBusy(true);
    setUploadProgress(null);
    setError(null);
    let uploadedCount = 0;
    let skippedCount = 0;
    const failures: string[] = [];
    const slots = params.files
      .map((file, fileIndex) => ({ file, fileIndex, decision: params.resolutions.get(fileIndex) }))
      .filter((slot) => {
        if (slot.decision?.resolution === "skip") {
          skippedCount += 1;
          return false;
        }
        return true;
      });

    try {
      for (const [index, slot] of slots.entries()) {
        const { file, decision } = slot;
        const progressMeta = {
          index: index + 1,
          total: slots.length,
          onProgress: (progress: UploadProgress) => setUploadProgress(progress),
        };
        try {
          if (params.uploadingEvidence) {
            await uploadEvidenceToDrive(file, { workspaceId, folderId }, progressMeta);
          } else if (decision?.resolution === "replace") {
            await uploadToDrive(
              file,
              {
                workspaceId,
                folderId,
                replaceFileId: decision.conflict.existingFileId,
                displayName: decision.conflict.displayName,
              },
              progressMeta,
            );
          } else if (decision?.resolution === "keep_both") {
            await uploadToDrive(
              file,
              {
                workspaceId,
                folderId,
                displayName: decision.conflict.suggestedName,
              },
              progressMeta,
            );
          } else {
            await uploadToDrive(file, { workspaceId, folderId }, progressMeta);
          }
          uploadedCount += 1;
        } catch (err) {
          failures.push(
            `${file.name}: ${err instanceof Error ? err.message : "Upload failed."}`,
          );
        }
      }
      if (uploadedCount > 0) {
        setPage(1);
        await load({
          section: params.listSection,
          folderId,
          page: 1,
          query: query.trim(),
        });
      }
      const notes: string[] = [];
      if (failures.length) {
        notes.push(
          uploadedCount > 0
            ? `${uploadedCount} uploaded. ${failures.length} failed — ${failures[0]}`
            : failures.length === 1
              ? failures[0]
              : `${failures.length} uploads failed — ${failures[0]}`,
        );
      } else if (skippedCount > 0 && uploadedCount > 0) {
        notes.push(`${uploadedCount} uploaded. ${skippedCount} skipped.`);
      } else if (skippedCount > 0 && uploadedCount === 0) {
        notes.push(skippedCount === 1 ? "Upload skipped." : `${skippedCount} uploads skipped.`);
      }
      if (notes.length) setError(notes.join(" "));
    } finally {
      setUploadBusy(false);
      setUploadProgress(null);
      pendingUploadRef.current = null;
      setUploadConflicts([]);
      setConflictIndex(0);
      setApplyConflictToRest(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || backend !== "supabase") return;
    const fileList = Array.from(files);
    setError(null);

    const uploadingEvidence = section === "evidence" || activeSection === "evidence";
    const listSection: DriveSection | "all" = uploadingEvidence
      ? "evidence"
      : activeSection === "all"
        ? "all"
        : "files";
    if (!uploadingEvidence && activeSection !== "files" && activeSection !== "all") {
      setSection("files");
    }

    // Evidence uploads keep the previous path (no name collision UX yet).
    if (uploadingEvidence) {
      await runUploadBatch({
        files: fileList,
        listSection,
        uploadingEvidence: true,
        resolutions: new Map(),
      });
      return;
    }

    setUploadBusy(true);
    try {
      const conflicts = await checkDriveUploadConflicts({
        workspaceId,
        folderId,
        names: fileList.map((file) => file.name),
      });
      if (!conflicts.length) {
        await runUploadBatch({
          files: fileList,
          listSection,
          uploadingEvidence: false,
          resolutions: new Map(),
        });
        return;
      }

      // Pair each conflict to the first unused file slot with that original name.
      const usedSlots = new Set<number>();
      const conflictSlots: Array<{ fileIndex: number; conflict: DriveUploadConflict }> = [];
      for (const conflict of conflicts) {
        const fileIndex = fileList.findIndex(
          (file, index) => file.name === conflict.originalName && !usedSlots.has(index),
        );
        if (fileIndex < 0) continue;
        usedSlots.add(fileIndex);
        conflictSlots.push({ fileIndex, conflict });
      }

      pendingUploadRef.current = {
        files: fileList,
        listSection,
        uploadingEvidence: false,
        resolutions: new Map(),
        conflictSlots,
      };
      setUploadConflicts(conflictSlots.map((slot) => slot.conflict));
      setConflictIndex(0);
      setApplyConflictToRest(false);
      setUploadBusy(false);
    } catch (err) {
      setUploadBusy(false);
      setError(err instanceof Error ? err.message : "Could not check for duplicate files.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resolveUploadConflict = (resolution: DriveUploadConflictResolution) => {
    const pending = pendingUploadRef.current;
    if (!pending || !pending.conflictSlots.length) return;

    const remaining = pending.conflictSlots.slice(conflictIndex);
    const applyTo = applyConflictToRest ? remaining : remaining.slice(0, 1);
    for (const slot of applyTo) {
      pending.resolutions.set(slot.fileIndex, {
        resolution,
        conflict: slot.conflict,
      });
    }

    const nextIndex = conflictIndex + applyTo.length;
    if (nextIndex >= pending.conflictSlots.length) {
      const batch = {
        files: pending.files,
        listSection: pending.listSection,
        uploadingEvidence: pending.uploadingEvidence,
        resolutions: pending.resolutions,
      };
      setUploadConflicts([]);
      void runUploadBatch(batch);
      return;
    }
    setConflictIndex(nextIndex);
    setApplyConflictToRest(false);
  };

  const cancelUploadConflicts = () => {
    pendingUploadRef.current = null;
    setUploadConflicts([]);
    setConflictIndex(0);
    setApplyConflictToRest(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePreview = async (type: DriveItemType, id: string) => {
    if (backend !== "supabase") return;
    setError(null);
    setViewerArtifact(null);
    try {
      const result = await fetchDriveDownload(workspaceId, type, id);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview item.");
    }
  };

  // Deep links: prefer binary exports over markdown AI-source twins.
  useEffect(() => {
    if (backend !== "supabase" || !data) return;
    const exportId = searchParams.get("export");
    const artifactId = searchParams.get("artifact");

    const openExport = (id: string) => {
      setViewerArtifact(null);
      void handlePreview("export", id);
    };

    if (exportId) {
      const item = data.exports.find((entry) => entry.id === exportId);
      if (item) openExport(item.id);
      return;
    }

    if (!artifactId) return;

    const linkedExport = data.exports.find(
      (entry) =>
        entry.sourceArtifactIds?.includes(artifactId) ||
        String(entry.metadata?.sourceArtifactId ?? "") === artifactId,
    );
    if (linkedExport) {
      openExport(linkedExport.id);
      return;
    }

    const artifact = data.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    const binaryExportId = artifact.metadata?.binaryExportId;
    if (typeof binaryExportId === "string") {
      const byMeta = data.exports.find((entry) => entry.id === binaryExportId);
      if (byMeta) {
        openExport(byMeta.id);
        return;
      }
    }
    setViewerArtifact(artifact);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link once list is ready
  }, [backend, data, searchParams, workspaceId]);

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
              {uploadProgress.phase === "saving" ? "Saving" : "Uploading"} {uploadProgress.fileName}
              {uploadProgress.total > 1
                ? ` (${uploadProgress.index} of ${uploadProgress.total})`
                : ""}
            </p>
            <span className="text-xs text-ink-3">
              {uploadProgress.phase === "saving" && uploadProgress.percent < 100
                ? "Saving to Drive…"
                : `${uploadProgress.percent}%`}
            </span>
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
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
              <span className="truncate">
                {formatDriveBytes(quota.usedBytes)} of {formatDriveBytes(quota.maxWorkspaceBytes)} used
              </span>
              <span className="shrink-0 font-medium text-ink-2">{usagePct}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  usagePct >= 90 ? "bg-rose-500" : usagePct >= 70 ? "bg-amber-500" : "bg-accent",
                )}
                style={{ width: `${Math.max(usagePct, quota.usedBytes > 0 ? 1 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <ResizablePane
          id={PANE_PRESETS.driveNav.id}
          side="left"
          limits={PANE_PRESETS.driveNav}
          fluidBelowLg
          className="lg:min-h-[420px]"
          collapsedLabel="Drive"
        >
          <aside className="h-full w-full min-w-0">
            <nav className="min-w-0 space-y-3 overflow-hidden rounded-xl border border-border bg-surface p-2">
              <div className="space-y-0.5">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                  Library
                </p>
                {DRIVE_SECTIONS.filter((item) => item.group === "library").map((item) => {
                  const Icon = sectionIcon(item.id);
                  const count =
                    item.id === "all"
                      ? sectionCounts
                        ? sectionCounts.files + sectionCounts.exports + sectionCounts.evidence
                        : null
                      : sectionCounts && item.id in sectionCounts
                        ? sectionCounts[item.id as keyof typeof sectionCounts]
                        : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSection(item.id);
                        if (item.id !== section) setFolderId(null);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                        section === item.id
                          ? "bg-accent-soft font-medium text-accent-d"
                          : "text-ink-2 hover:bg-muted hover:text-ink",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {count != null && (
                        <span className="shrink-0 text-[10px] tabular-nums text-ink-3">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-0.5 border-t border-border pt-2">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                  AI workspace
                </p>
                {DRIVE_SECTIONS.filter((item) => item.group === "ai").map((item) => {
                  const Icon = sectionIcon(item.id);
                  const count = sectionCounts?.artifacts ?? null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSection(item.id);
                        if (item.id !== section) setFolderId(null);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                        section === item.id
                          ? "bg-accent-soft font-medium text-accent-d"
                          : "text-ink-2 hover:bg-muted hover:text-ink",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {count != null && (
                        <span className="shrink-0 text-[10px] tabular-nums text-ink-3">{count}</span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSection("quotas")}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                    section === "quotas"
                      ? "bg-accent-soft font-medium text-accent-d"
                      : "text-ink-2 hover:bg-muted hover:text-ink",
                  )}
                >
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Storage</span>
                </button>
              </div>
            </nav>
          </aside>
        </ResizablePane>

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
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <p className="min-w-0 flex-1">{error}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => void load()}
                  >
                    Retry
                  </Button>
                </div>
              )}

              {section === "artifacts" && (
                <p className="mb-3 text-[12px] text-ink-3">
                  AI-generated notes and drafts live here — separate from My Drive uploads and binary exports.
                </p>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-20 text-sm text-ink-3">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading Drive…
                </div>
              ) : !data || itemCount === 0 ? (
                error ? (
                  <p className="py-12 text-center text-sm text-ink-3">
                    Couldn’t load Drive files. Use Retry above.
                  </p>
                ) : (
                  <EmptyState
                    icon={section === "artifacts" ? Package : HardDrive}
                    title={section === "artifacts" ? "No artifacts yet" : "This folder is empty"}
                    description={
                      section === "artifacts"
                        ? "When AI employees save notes, email drafts, and briefs, they show up here in a compact list."
                        : "Upload files or create folders to organize your workspace knowledge."
                    }
                  />
                )
              ) : (
                <>
                  <DriveItemsGrid
                    data={data}
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
                    onOpenArtifact={(artifact) => {
                      setPreview(null);
                      setViewerArtifact(artifact);
                    }}
                    onPreview={handlePreview}
                    onDownload={handleDownload}
                  />
                  {totalPages > 1 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[12px] text-ink-3">
                      <span>
                        Showing {rangeStart}–{rangeEnd} of {totalItems}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={page <= 1 || loading}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <span className="px-2 tabular-nums text-ink-2">
                          {page} / {totalPages}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={page >= totalPages || loading}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
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

      <Modal
        open={uploadConflicts.length > 0}
        onClose={cancelUploadConflicts}
        size="md"
      >
        <ModalHeader
          title="File already exists"
          subtitle={
            uploadConflicts.length > 1
              ? `Conflict ${conflictIndex + 1} of ${uploadConflicts.length}`
              : "Choose how to continue"
          }
          onClose={cancelUploadConflicts}
        />
        {uploadConflicts[conflictIndex] ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-ink-2">
              <span className="font-medium text-ink">
                {uploadConflicts[conflictIndex].existingDisplayName}
              </span>{" "}
              {uploadConflicts[conflictIndex].existingFileId
                ? "is already in this folder."
                : "appears more than once in this upload."}
            </p>
            <p className="text-sm text-ink-3">
              Keep both will upload as{" "}
              <span className="font-medium text-ink">
                {uploadConflicts[conflictIndex].suggestedName}
              </span>
              .
            </p>
            {uploadConflicts.length - conflictIndex > 1 ? (
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={applyConflictToRest}
                  onChange={(e) => setApplyConflictToRest(e.target.checked)}
                  className="rounded border-border"
                />
                Apply this choice to the remaining{" "}
                {uploadConflicts.length - conflictIndex - 1} conflict
                {uploadConflicts.length - conflictIndex - 1 === 1 ? "" : "s"}
              </label>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={cancelUploadConflicts}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => resolveUploadConflict("skip")}>
                Skip
              </Button>
              {uploadConflicts[conflictIndex].existingFileId ? (
                <Button variant="secondary" onClick={() => resolveUploadConflict("replace")}>
                  Replace
                </Button>
              ) : null}
              <Button onClick={() => resolveUploadConflict("keep_both")}>
                Keep both
              </Button>
            </div>
          </div>
        ) : null}
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
  const b = quota.breakdown;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">Workspace storage</h2>
      <p className="mt-1 text-sm text-ink-3">
        Live totals from Supabase Storage (uploads, AI exports, and evidence). Recalculated whenever you open Drive.
      </p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Plan</dt>
          <dd className="mt-1 text-lg font-semibold capitalize text-ink">{quota.planTier}</dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Total used</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {formatDriveBytes(quota.usedBytes)} / {formatDriveBytes(quota.maxWorkspaceBytes)}
          </dd>
          <dd className="text-xs text-ink-3">
            {pct}% used
            {b ? ` · ${b.totalFiles} files` : ""}
          </dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">AI exports (xlsx/pdf/docx/pptx)</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {b ? `${b.exports.count} · ${formatDriveBytes(b.exports.bytes)}` : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Uploads</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {b ? `${b.uploads.count} · ${formatDriveBytes(b.uploads.bytes)}` : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Evidence / screenshots</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {b ? `${b.evidence.count} · ${formatDriveBytes(b.evidence.bytes)}` : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-border-2 bg-muted/40 p-4">
          <dt className="text-xs uppercase tracking-wide text-ink-3">Max file size</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">{formatDriveBytes(quota.maxFileBytes)}</dd>
          <dd className="text-xs text-ink-3">Per upload on your {quota.planTier} plan</dd>
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
      ? "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      : "flex flex-col divide-y divide-border rounded-lg border border-border bg-surface";

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
