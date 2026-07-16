"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Loader2,
  Presentation,
} from "lucide-react";
import { fetchDriveDownload, type DriveItemType } from "@/lib/drive/client";
import {
  chatFilePreviewKind,
  cleanChatFileTitle,
  type ChatFilePreviewKind,
} from "@/lib/chat/file-preview-kind";
import {
  parsePptxSlides,
  type PptxSlidePreview,
} from "@/lib/drive/parse-pptx-preview";
import { cn } from "@/lib/utils";
import { MessageMarkdown } from "@/components/MessageMarkdown";

const MAX_CHAT_PPTX_SLIDES = 4;

const MAX_PREVIEW_ROWS = 8;
const MAX_PREVIEW_COLS = 10;

type SheetPreview = {
  sheetName: string;
  headers: string[];
  rows: string[][];
};

export type ChatFileMiniViewerProps = {
  workspaceId: string;
  title: string;
  /** Prefer export for AI binaries; file for uploads; artifact as fallback. */
  source: { type: DriveItemType; id: string };
  /** Optional second source for markdown/text preview (usually the artifact). */
  previewSource?: { type: DriveItemType; id: string };
  extension?: string;
  mimeType?: string;
  toolName?: string;
  driveHref?: string;
  className?: string;
};

function kindIcon(kind: ChatFilePreviewKind) {
  if (kind === "spreadsheet") return FileSpreadsheet;
  if (kind === "presentation") return Presentation;
  if (kind === "video") return Film;
  return FileText;
}

function kindLabel(kind: ChatFilePreviewKind, extension?: string): string {
  const ext = extension?.toUpperCase();
  switch (kind) {
    case "spreadsheet":
      return ext ? `Spreadsheet · ${ext}` : "Spreadsheet";
    case "pdf":
      return "PDF";
    case "document":
      return ext ? `Document · ${ext}` : "Document";
    case "presentation":
      return ext ? `Presentation · ${ext}` : "Presentation";
    case "image":
      return "Image";
    case "video":
      return ext ? `Video · ${ext}` : "Video";
    default:
      return ext ?? "File";
  }
}

async function arrayBufferFromUrl(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Unable to download file for preview.");
  return res.arrayBuffer();
}

async function parseSpreadsheet(buffer: ArrayBuffer): Promise<SheetPreview | null> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as Array<Array<string | number | boolean | null>>;
  if (!matrix.length) return { sheetName, headers: [], rows: [] };

  const width = Math.min(
    MAX_PREVIEW_COLS,
    Math.max(...matrix.map((row) => row.length), 1),
  );
  const headers = (matrix[0] ?? []).slice(0, width).map((cell) => String(cell ?? ""));
  const rows = matrix
    .slice(1, MAX_PREVIEW_ROWS + 1)
    .map((row) =>
      Array.from({ length: width }, (_, i) => String(row[i] ?? "")),
    );
  return { sheetName, headers, rows };
}

async function parseDocxHtml(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  return result.value?.trim() ?? "";
}

export function ChatFileMiniViewer({
  workspaceId,
  title,
  source,
  previewSource,
  extension,
  mimeType,
  toolName,
  driveHref,
  className,
}: ChatFileMiniViewerProps) {
  const kind = chatFilePreviewKind({ extension, mimeType, toolName, fileName: title });
  const displayTitle = cleanChatFileTitle(title);
  const Icon = kindIcon(kind);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetPreview | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [pptxSlides, setPptxSlides] = useState<PptxSlidePreview[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const run = async () => {
      setLoading(true);
      setError(null);
      setSignedUrl(null);
      setPdfObjectUrl(null);
      setPreviewText(null);
      setSheet(null);
      setPptxSlides(null);
      setDocxHtml(null);

      try {
        const primary = await fetchDriveDownload(workspaceId, source.type, source.id);
        if (cancelled) return;

        let url = primary.signedUrl;
        let text = primary.previewText ?? null;

        if (previewSource && (!text || previewSource.id !== source.id)) {
          try {
            const secondary = await fetchDriveDownload(
              workspaceId,
              previewSource.type,
              previewSource.id,
            );
            if (!cancelled) {
              text = secondary.previewText ?? text;
              if (!url) url = secondary.signedUrl;
            }
          } catch {
            // preview source is optional
          }
        }

        if (cancelled) return;
        setSignedUrl(url);
        setPreviewText(text);

        if (
          url &&
          (kind === "spreadsheet" ||
            kind === "document" ||
            kind === "pdf" ||
            kind === "presentation")
        ) {
          try {
            const buffer = await arrayBufferFromUrl(url);
            if (cancelled) return;
            if (kind === "spreadsheet") {
              setSheet(await parseSpreadsheet(buffer));
            } else if (kind === "pdf") {
              // Blob URLs render more reliably than cross-origin signed URLs in iframes.
              const blob = new Blob([buffer], { type: "application/pdf" });
              objectUrl = URL.createObjectURL(blob);
              setPdfObjectUrl(objectUrl);
            } else if (kind === "presentation") {
              const slides = await parsePptxSlides(buffer);
              setPptxSlides(slides.slice(0, MAX_CHAT_PPTX_SLIDES));
            } else if (extension?.toLowerCase() === "docx" || mimeType?.includes("word")) {
              setDocxHtml(await parseDocxHtml(buffer));
            }
          } catch {
            // fall through to markdown / empty preview
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Preview unavailable.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, source.type, source.id, previewSource?.type, previewSource?.id, kind, extension, mimeType]);

  const body = (() => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 px-3 py-6 text-xs text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading preview…
        </div>
      );
    }

    if (kind === "spreadsheet" && sheet && (sheet.headers.length || sheet.rows.length)) {
      return (
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-left text-[11px]">
            {sheet.headers.length > 0 && (
              <thead>
                <tr className="bg-emerald-100/70">
                  {sheet.headers.map((header, i) => (
                    <th
                      key={`${header}-${i}`}
                      className="whitespace-nowrap border-b border-emerald-200/80 px-2.5 py-1.5 font-semibold text-emerald-950"
                    >
                      {header || `Col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {sheet.rows.map((row, ri) => (
                <tr key={ri} className="odd:bg-white even:bg-emerald-50/40">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="max-w-[10rem] truncate border-b border-emerald-100/80 px-2.5 py-1 text-emerald-950/90"
                      title={cell}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.rows.length >= MAX_PREVIEW_ROWS && (
            <p className="border-t border-emerald-100 px-3 py-1.5 text-[10px] text-emerald-900/70">
              Showing first {MAX_PREVIEW_ROWS} rows
              {sheet.sheetName ? ` · ${sheet.sheetName}` : ""}
            </p>
          )}
        </div>
      );
    }

    if (kind === "pdf" && pdfObjectUrl) {
      return (
        <iframe
          title={displayTitle}
          src={`${pdfObjectUrl}#toolbar=0&navpanes=0`}
          className="h-56 w-full bg-white"
        />
      );
    }

    if (kind === "document" && docxHtml) {
      return (
        <div
          className="prose prose-sm max-h-56 overflow-y-auto px-3 py-2 text-ink [&_p]:my-1.5 [&_table]:text-xs"
          dangerouslySetInnerHTML={{ __html: docxHtml }}
        />
      );
    }

    if (kind === "image" && signedUrl) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={signedUrl} alt={displayTitle} className="max-h-56 w-full object-contain bg-white" />;
    }

    if (kind === "video" && signedUrl) {
      return (
        <video
          src={signedUrl}
          controls
          playsInline
          preload="metadata"
          className="max-h-64 w-full bg-black object-contain"
        >
          <track kind="captions" />
        </video>
      );
    }

    if (kind === "presentation" && pptxSlides && pptxSlides.length > 0) {
      return (
        <div className="max-h-56 space-y-2 overflow-y-auto px-3 py-2">
          {pptxSlides.map((slide) => (
            <div key={slide.index} className="rounded-lg border border-emerald-100 bg-white px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-900/60">
                Slide {slide.index}
              </div>
              <div className="truncate text-xs font-semibold text-emerald-950">{slide.title}</div>
              {slide.lines[0] ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-emerald-900/80">{slide.lines[0]}</p>
              ) : null}
            </div>
          ))}
          <p className="text-[10px] text-emerald-900/60">Text preview · open in Drive for full deck</p>
        </div>
      );
    }

    // Presentations: never fall through to the markdown twin (looks like a .md deck).
    if (kind === "presentation") {
      return (
        <div className="px-3 py-5 text-center text-xs text-ink-3">
          Slide deck ready — use Download or Drive to open the PowerPoint.
        </div>
      );
    }

    // Markdown twin for sheets/docs/PDFs when binary preview is unavailable.
    if (previewText && (kind === "spreadsheet" || kind === "document" || kind === "pdf" || kind === "other")) {
      return (
        <div className="max-h-56 overflow-y-auto px-3 py-2">
          {kind === "pdf" ? (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Report outline
            </p>
          ) : null}
          <MessageMarkdown content={previewText.slice(0, 6000)} />
        </div>
      );
    }

    if (error) {
      return <div className="px-3 py-4 text-xs text-rose-700">{error}</div>;
    }

    return (
      <div className="px-3 py-5 text-center text-xs text-ink-3">
        Preview unavailable — open in Drive or download the file.
      </div>
    );
  })();

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/70 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2.5 border-b border-emerald-200/80 px-3 py-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-800 shadow-sm">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-emerald-950">{displayTitle}</div>
          <div className="text-[11px] text-emerald-900/75">{kindLabel(kind, extension)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-emerald-900 hover:bg-white/80"
              title="Download"
            >
              <Download className="h-3 w-3" />
              Download
            </a>
          )}
          {driveHref && (
            <Link
              href={driveHref}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-emerald-900 hover:bg-white/80"
            >
              Drive
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="bg-white/70">{body}</div>
    </div>
  );
}
