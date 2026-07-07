"use client";

import type { DriveItemType } from "@/lib/drive/client";
import { formatDriveBytes } from "@/lib/drive/format";
import { driveFilePresentation, driveFolderPresentation } from "@/lib/drive/presentation";
import type { BrowserEvidence, DriveExport, SavedArtifact, WorkspaceFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Download, Eye, Trash2 } from "lucide-react";

type ViewMode = "grid" | "list";

export function DriveFolderTile({
  viewMode,
  name,
  dropHighlight,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onDelete,
}: {
  viewMode: ViewMode;
  name: string;
  dropHighlight?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const presentation = driveFolderPresentation(name);
  return (
    <DriveItemTileShell
      viewMode={viewMode}
      presentation={presentation}
      meta="Drop items here to organize"
      dropHighlight={dropHighlight}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onOpen={onOpen}
      onDelete={onDelete}
    />
  );
}

export function DriveFileTile({
  viewMode,
  file,
  draggable,
  onDragStart,
  onDragEnd,
  onPreview,
  onDownload,
  onDelete,
}: {
  viewMode: ViewMode;
  file: WorkspaceFile;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}) {
  const presentation = driveFilePresentation({
    itemType: "file",
    title: file.displayName,
    mimeType: file.mimeType,
    extension: file.extension,
    storagePath: file.storagePath,
  });
  return (
    <DriveItemTileShell
      viewMode={viewMode}
      presentation={presentation}
      meta={`${presentation.typeLabel} · ${formatDriveBytes(file.sizeBytes)}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onOpen={onPreview}
      onPreview={onPreview}
      onDownload={onDownload}
      onDelete={onDelete}
    />
  );
}

export function DriveArtifactTile({
  viewMode,
  artifact,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
  onPreview,
}: {
  viewMode: ViewMode;
  artifact: SavedArtifact;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onOpen: () => void;
  onPreview?: () => void;
}) {
  const contentKind =
    artifact.contentJson && typeof artifact.contentJson === "object" && "kind" in artifact.contentJson
      ? String((artifact.contentJson as { kind?: string }).kind ?? "")
      : undefined;
  const presentation = driveFilePresentation({
    itemType: "artifact",
    title: artifact.title,
    artifactType: artifact.artifactType,
    contentKind,
  });
  return (
    <DriveItemTileShell
      viewMode={viewMode}
      presentation={presentation}
      meta={`${presentation.typeLabel} · ${presentation.categoryLabel}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onOpen={onOpen}
      onPreview={onPreview}
    />
  );
}

export function DriveEvidenceTile({
  viewMode,
  item,
  draggable,
  onDragStart,
  onDragEnd,
  onPreview,
  onDownload,
}: {
  viewMode: ViewMode;
  item: BrowserEvidence;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
}) {
  const presentation = driveFilePresentation({
    itemType: "evidence",
    title: item.title,
    mimeType: item.mimeType,
    storagePath: item.storagePath,
  });
  return (
    <DriveItemTileShell
      viewMode={viewMode}
      presentation={presentation}
      meta={`${presentation.categoryLabel} · ${formatDriveBytes(item.sizeBytes)}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onOpen={onPreview}
      onPreview={onPreview}
      onDownload={onDownload}
    />
  );
}

export function DriveExportTile({
  viewMode,
  item,
  draggable,
  onDragStart,
  onDragEnd,
  onPreview,
  onDownload,
}: {
  viewMode: ViewMode;
  item: DriveExport;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
}) {
  const presentation = driveFilePresentation({
    itemType: "export",
    title: item.title,
    mimeType: item.mimeType,
    storagePath: item.storagePath,
    exportType: item.exportType,
  });
  return (
    <DriveItemTileShell
      viewMode={viewMode}
      presentation={presentation}
      meta={`${presentation.typeLabel} · ${presentation.categoryLabel} · ${formatDriveBytes(item.sizeBytes)}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onOpen={onDownload ?? onPreview}
      onPreview={onPreview}
      onDownload={onDownload}
      highlightDownload
    />
  );
}

function DriveItemTileShell({
  viewMode,
  presentation,
  meta,
  dropHighlight,
  draggable,
  highlightDownload,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onPreview,
  onDownload,
  onDelete,
}: {
  viewMode: ViewMode;
  presentation: ReturnType<typeof driveFilePresentation>;
  meta: string;
  dropHighlight?: boolean;
  draggable?: boolean;
  highlightDownload?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onOpen?: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}) {
  const Icon = presentation.icon;

  return (
    <div
      className={cn(
        "group relative rounded-2xl border bg-surface transition-all hover:border-border-2 hover:shadow-md",
        viewMode === "grid" ? "p-4" : "flex items-center gap-3 p-3",
        onOpen && "cursor-pointer",
        dropHighlight ? "border-accent bg-accent-soft/20 ring-2 ring-accent/30" : "border-border",
      )}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        onDragStart?.();
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", presentation.iconClass)}>
        <Icon className="h-5 w-5" />
        {presentation.kind === "spreadsheet" && (
          <span className="absolute -bottom-1 -right-1 rounded-md bg-emerald-600 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
            {presentation.typeLabel}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{presentation.displayTitle}</p>
          {highlightDownload && (
            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              {presentation.typeLabel}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-ink-3">{meta}</p>
      </div>
      <div
        className={cn(
          "flex gap-1",
          viewMode === "grid"
            ? "absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
            : "shrink-0 opacity-100",
        )}
      >
        {onDownload && (
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            aria-label="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
        {onPreview && (
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            aria-label="Preview"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-rose-600"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export type { DriveItemType };
