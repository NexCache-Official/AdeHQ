"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageMarkdown } from "@/components/MessageMarkdown";
import { Button, Modal, ModalHeader } from "@/components/ui";
import type { DriveDownloadResponse } from "@/lib/drive/client";
import { driveFilePresentation } from "@/lib/drive/presentation";
import { formatDriveBytes } from "@/lib/drive/format";
import { Download, ExternalLink, Loader2 } from "lucide-react";

const MAX_ROWS = 40;
const MAX_COLS = 16;

type SheetPreview = {
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  rows: string[][];
};

function officeEmbedUrl(signedUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
}

async function parseSpreadsheet(buffer: ArrayBuffer): Promise<SheetPreview | null> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const sheetName = sheetNames[0];
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as Array<Array<string | number | boolean | null>>;
  if (!matrix.length) return { sheetName, sheetNames, headers: [], rows: [] };
  const width = Math.min(MAX_COLS, Math.max(...matrix.map((row) => row.length), 1));
  const headers = (matrix[0] ?? []).slice(0, width).map((cell) => String(cell ?? ""));
  const rows = matrix.slice(1, MAX_ROWS + 1).map((row) =>
    Array.from({ length: width }, (_, i) => String(row[i] ?? "")),
  );
  return { sheetName, sheetNames, headers, rows };
}

async function parseDocxHtml(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  return result.value?.trim() ?? "";
}

export function DrivePreviewModal({
  preview,
  onClose,
}: {
  preview: DriveDownloadResponse | null;
  onClose: () => void;
}) {
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [sheet, setSheet] = useState<SheetPreview | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [officeEmbedFailed, setOfficeEmbedFailed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const meta = useMemo(() => {
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
    const sizeBytes = Number((preview.item as { sizeBytes?: number }).sizeBytes ?? 0);
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

    return { rawTitle, mimeType, sizeBytes, presentation };
  }, [preview]);

  const isOffice =
    meta?.presentation.kind === "spreadsheet" ||
    meta?.presentation.kind === "document" ||
    meta?.presentation.kind === "presentation";
  const canOfficeEmbed =
    Boolean(preview?.signedUrl) &&
    Boolean(isOffice) &&
    !officeEmbedFailed &&
    /^https:\/\//i.test(preview?.signedUrl ?? "");

  useEffect(() => {
    setSheet(null);
    setDocxHtml(null);
    setOfficeEmbedFailed(false);
    setLocalError(null);
    if (!preview?.signedUrl || !meta) return;

    // Prefer Office Online for Word/PPTX; always load local sheet table as primary for Excel.
    const kind = meta.presentation.kind;
    if (kind !== "spreadsheet" && kind !== "document") return;
    if (kind === "document" && canOfficeEmbed) return;

    let cancelled = false;
    const run = async () => {
      setLoadingLocal(true);
      try {
        const res = await fetch(preview.signedUrl!);
        if (!res.ok) throw new Error("Could not load file bytes for preview.");
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        if (kind === "spreadsheet") setSheet(await parseSpreadsheet(buffer));
        else setDocxHtml(await parseDocxHtml(buffer));
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : "Preview failed.");
        }
      } finally {
        if (!cancelled) setLoadingLocal(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [preview, meta, canOfficeEmbed]);

  if (!preview || !meta) return null;

  const { mimeType, sizeBytes, presentation } = meta;
  const isImage =
    (preview.itemType === "evidence" || preview.itemType === "file") &&
    mimeType.startsWith("image/");
  const subtitle = [
    presentation.typeLabel,
    presentation.categoryLabel,
    sizeBytes > 0 ? formatDriveBytes(sizeBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal open onClose={onClose} size="xl">
      <ModalHeader
        title={presentation.displayTitle}
        subtitle={subtitle}
        onClose={onClose}
      />
      <div className="max-h-[75vh] overflow-hidden bg-muted/30">
        {isImage && preview.signedUrl ? (
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.signedUrl}
              alt={presentation.displayTitle}
              className="max-h-[65vh] rounded-xl border border-border bg-white shadow-sm"
            />
          </div>
        ) : presentation.kind === "pdf" && preview.signedUrl ? (
          <iframe
            title={presentation.displayTitle}
            src={`${preview.signedUrl}#toolbar=1&navpanes=0`}
            className="h-[70vh] w-full bg-white"
          />
        ) : presentation.kind === "spreadsheet" && sheet ? (
          <div className="max-h-[70vh] overflow-auto bg-white">
            <table className="min-w-full border-collapse text-left text-xs">
              {sheet.headers.length > 0 && (
                <thead className="sticky top-0 z-10 bg-emerald-100">
                  <tr>
                    {sheet.headers.map((header, i) => (
                      <th
                        key={`${header}-${i}`}
                        className="whitespace-nowrap border-b border-emerald-200 px-3 py-2 font-semibold text-emerald-950"
                      >
                        {header || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri} className="odd:bg-white even:bg-emerald-50/50">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="max-w-[14rem] truncate border-b border-emerald-100 px-3 py-1.5 text-ink"
                        title={cell}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-3 py-2 text-[11px] text-ink-3">
              Showing first {Math.min(MAX_ROWS, sheet.rows.length)} data rows
              {sheet.sheetName ? ` · ${sheet.sheetName}` : ""}
              {sheet.sheetNames.length > 1 ? ` (${sheet.sheetNames.length} sheets)` : ""}
            </p>
          </div>
        ) : canOfficeEmbed && preview.signedUrl ? (
          <div className="relative h-[70vh] w-full bg-white">
            <iframe
              title={presentation.displayTitle}
              src={officeEmbedUrl(preview.signedUrl)}
              className="h-full w-full"
            />
            <p className="absolute bottom-2 left-3 rounded-md bg-white/90 px-2 py-1 text-[10px] text-ink-3 shadow-sm">
              Preview via Microsoft Office Online ·{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setOfficeEmbedFailed(true)}
              >
                use built-in preview
              </button>
            </p>
          </div>
        ) : loadingLocal ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading preview…
          </div>
        ) : presentation.kind === "document" && docxHtml ? (
          <div
            className="prose prose-sm max-h-[70vh] max-w-none overflow-y-auto bg-white px-8 py-6"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        ) : preview.previewText ? (
          <div className="max-h-[70vh] overflow-y-auto bg-white px-6 py-5">
            <MessageMarkdown content={preview.previewText} />
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-ink-3">
            {localError ??
              `No inline preview for this ${presentation.categoryLabel.toLowerCase()}. Download to open it locally.`}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
        {preview.signedUrl && (
          <>
            <a
              href={preview.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              Download {presentation.typeLabel}
            </a>
            {isOffice && (
              <a
                href={officeEmbedUrl(preview.signedUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Office Online
              </a>
            )}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
