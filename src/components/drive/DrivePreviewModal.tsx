"use client";

import { MessageMarkdown } from "@/components/MessageMarkdown";
import { Button, Modal, ModalHeader } from "@/components/ui";
import type { DriveDownloadResponse } from "@/lib/drive/client";

export function DrivePreviewModal({
  preview,
  onClose,
}: {
  preview: DriveDownloadResponse | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  const title =
    preview.itemType === "file"
      ? String((preview.item as { displayName?: string }).displayName ?? "File")
      : preview.itemType === "artifact"
        ? String((preview.item as { title?: string }).title ?? "Artifact")
        : preview.itemType === "evidence"
          ? String((preview.item as { title?: string }).title ?? "Evidence")
          : String((preview.item as { title?: string }).title ?? "Export");

  const isImage =
    preview.itemType === "evidence" &&
    String((preview.item as { mimeType?: string }).mimeType ?? "").startsWith("image/");

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={title} subtitle="Preview" onClose={onClose} />
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        {isImage && preview.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.signedUrl} alt={title} className="max-h-[60vh] rounded-xl border border-border" />
        ) : preview.previewText ? (
          <MessageMarkdown content={preview.previewText} />
        ) : (
          <p className="text-sm text-ink-3">No inline preview available for this item.</p>
        )}
      </div>
      <div className="flex gap-2 border-t border-border px-6 py-4">
        {preview.signedUrl && (
          <a
            href={preview.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-muted"
          >
            Open / download
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
