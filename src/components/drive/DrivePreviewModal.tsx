"use client";

import { MessageMarkdown } from "@/components/MessageMarkdown";
import { Button, Modal, ModalHeader } from "@/components/ui";
import type { DriveDownloadResponse } from "@/lib/drive/client";
import { driveFilePresentation } from "@/lib/drive/presentation";
import { Download } from "lucide-react";

export function DrivePreviewModal({
  preview,
  onClose,
}: {
  preview: DriveDownloadResponse | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const rawTitle =
    preview.itemType === "file"
      ? String((preview.item as { displayName?: string }).displayName ?? "File")
      : preview.itemType === "artifact"
        ? String((preview.item as { title?: string }).title ?? "Artifact")
        : preview.itemType === "evidence"
          ? String((preview.item as { title?: string }).title ?? "Evidence")
          : String((preview.item as { title?: string }).title ?? "Download");

  const mimeType = String((preview.item as { mimeType?: string }).mimeType ?? "");
  const storagePath = String((preview.item as { storagePath?: string }).storagePath ?? "");
  const extension = String((preview.item as { extension?: string }).extension ?? "");
  const artifactType =
    preview.itemType === "artifact"
      ? String((preview.item as { artifactType?: string }).artifactType ?? "")
      : undefined;
  const exportType =
    preview.itemType === "export"
      ? String((preview.item as { exportType?: string }).exportType ?? "")
      : undefined;

  const presentation = driveFilePresentation({
    itemType:
      preview.itemType === "folder"
        ? "file"
        : (preview.itemType as "file" | "export" | "artifact" | "evidence"),
    title: rawTitle,
    mimeType,
    extension,
    storagePath,
    artifactType,
    exportType,
  });

  const isImage =
    preview.itemType === "evidence" && mimeType.startsWith("image/");
  const isSpreadsheet = presentation.kind === "spreadsheet";

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader
        title={presentation.displayTitle}
        subtitle={`${presentation.typeLabel} · ${presentation.categoryLabel}`}
        onClose={onClose}
      />
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        {isImage && preview.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.signedUrl} alt={presentation.displayTitle} className="max-h-[60vh] rounded-xl border border-border" />
        ) : preview.previewText ? (
          <MessageMarkdown content={preview.previewText} />
        ) : isSpreadsheet ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm font-medium text-emerald-900">Excel spreadsheet</p>
            <p className="mt-1 text-sm text-emerald-800/90">
              This workbook cannot be previewed inline yet. Download the {presentation.typeLabel} file to open it in Excel, Google Sheets, or Numbers.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-3">
            No inline preview for this {presentation.categoryLabel.toLowerCase()}. Use download to open it locally.
          </p>
        )}
      </div>
      <div className="flex gap-2 border-t border-border px-6 py-4">
        {preview.signedUrl && (
          <a
            href={preview.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            Download {presentation.typeLabel}
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
