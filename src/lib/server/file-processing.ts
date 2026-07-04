import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { fileExtension, sanitizeFileName } from "@/lib/files/sanitize-file-name";

export { sanitizeFileName, fileExtension };

export type FileChunkDraft = {
  chunkIndex: number;
  content: string;
  contentPreview: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  sheetName?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  tokenEstimate: number;
  metadata?: Record<string, unknown>;
};

export type ParsedFileResult = {
  status: "ready" | "failed";
  parseStatus: "parsed" | "no_text" | "failed";
  extractedText: string | null;
  textPreview: string | null;
  chunks: FileChunkDraft[];
  pageCount?: number | null;
  sheetCount?: number | null;
  rowCount?: number | null;
  sourceMetadata: Record<string, unknown>;
  errorMessage?: string | null;
};

export const WORKSPACE_FILE_BUCKET = "adehq-files";
/** Legacy uploads before AdeHQ Drive may still use this bucket. */
export const LEGACY_WORKSPACE_FILE_BUCKET = "workspace-files";
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Upper bound on extracted text persisted to the DB, to keep rows and prompt costs sane. */
export const MAX_STORED_TEXT_CHARS = 200_000;
const MAX_TABULAR_ROWS = 2000;
const CSV_ROWS_PER_CHUNK = 80;
const XLSX_ROWS_PER_CHUNK = 60;
const TARGET_WORDS = 1100;
const OVERLAP_WORDS = 120;

/** Turn a raw parser/library error into a clear, non-technical message for users. */
function friendlyParseError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("password") || lower.includes("encrypt")) {
    return "This file is password-protected or encrypted. Remove the protection and upload it again.";
  }
  if (
    lower.includes("corrupt") ||
    lower.includes("central directory") ||
    lower.includes("end of central") ||
    lower.includes("zip") ||
    lower.includes("not a valid") ||
    lower.includes("invalid") ||
    lower.includes("unexpected end") ||
    lower.includes("bad")
  ) {
    return "This file appears to be corrupted or unreadable. Try re-saving or re-exporting it, then upload again.";
  }
  return "We couldn't read this file. Try re-saving or re-exporting it, then upload again.";
}

/** Cap the extracted text stored in the DB and reflected in the UI preview. */
function boundStoredText(text: string | null): string | null {
  if (!text) return text;
  if (text.length <= MAX_STORED_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_STORED_TEXT_CHARS).trim()}\n\n[Truncated — file exceeds the ${Math.round(
    MAX_STORED_TEXT_CHARS / 1000,
  )}k character limit for stored text.]`;
}

const MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: ["application/msword"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: ["application/vnd.ms-excel"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  txt: ["text/plain", "application/octet-stream"],
  md: ["text/markdown", "text/plain", "application/octet-stream"],
};

export function fileChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateUploadType(fileName: string, mimeType: string): {
  ok: true;
  extension: string;
  mimeType: string;
} | {
  ok: false;
  error: string;
} {
  const extension = fileExtension(fileName);
  const allowed = MIME_BY_EXTENSION[extension];
  if (!allowed) {
    return { ok: false, error: "Unsupported file type. Upload PDF, DOCX, XLSX, CSV, TXT, or MD." };
  }
  const normalizedMime = mimeType || "application/octet-stream";
  if (!allowed.includes(normalizedMime) && normalizedMime !== "application/octet-stream") {
    return { ok: false, error: "This file type does not match the selected file extension." };
  }
  return { ok: true, extension, mimeType: normalizedMime };
}

function compactWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function preview(text: string, max = 500): string {
  const cleaned = compactWhitespace(text).replace(/\s+/g, " ");
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.35);
}

function chunkText(
  text: string,
  baseMeta: Partial<FileChunkDraft> = {},
  startIndex = 0,
): FileChunkDraft[] {
  const words = compactWhitespace(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const chunks: FileChunkDraft[] = [];
  let offset = 0;
  while (offset < words.length) {
    const slice = words.slice(offset, offset + TARGET_WORDS);
    const content = slice.join(" ");
    chunks.push({
      chunkIndex: startIndex + chunks.length,
      content,
      contentPreview: preview(content, 280),
      pageStart: baseMeta.pageStart ?? null,
      pageEnd: baseMeta.pageEnd ?? baseMeta.pageStart ?? null,
      sheetName: baseMeta.sheetName ?? null,
      rowStart: baseMeta.rowStart ?? null,
      rowEnd: baseMeta.rowEnd ?? null,
      tokenEstimate: estimateTokens(content),
      metadata: baseMeta.metadata,
    });
    if (offset + TARGET_WORDS >= words.length) break;
    offset += TARGET_WORDS - OVERLAP_WORDS;
  }
  return chunks;
}

function markdownTable(headers: string[], rows: unknown[][]): string {
  const safeHeaders = headers.map((header, index) => String(header || `Column ${index + 1}`));
  const headerLine = `| ${safeHeaders.join(" | ")} |`;
  const separator = `| ${safeHeaders.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${safeHeaders.map((_, i) => String(row[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [headerLine, separator, ...body].join("\n");
}

async function parsePdf(buffer: Buffer): Promise<ParsedFileResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ pageJoiner: "\n\n" });
    const pages = result.pages ?? [];
    const pageTexts = pages.map((page: { text?: string; num?: number }) => ({
      pageNumber: Number(page.num ?? 1),
      text: compactWhitespace(page.text ?? ""),
    }));
    const extractedText = compactWhitespace(pageTexts.map((page) => page.text).join("\n\n"));

    if (!extractedText) {
      return {
        status: "ready",
        parseStatus: "no_text",
        extractedText: null,
        textPreview: "No extractable text found.",
        chunks: [],
        pageCount: result.total ?? pages.length,
        sourceMetadata: { parser: "pdf-parse", noOcr: true },
        errorMessage: "No extractable text found. This may be a scanned or image-only PDF.",
      };
    }

    let chunkIndex = 0;
    const chunks = pageTexts.flatMap((page) => {
      const pageChunks = chunkText(
        page.text,
        { pageStart: page.pageNumber, pageEnd: page.pageNumber, metadata: { source: "pdf_page" } },
        chunkIndex,
      );
      chunkIndex += pageChunks.length;
      return pageChunks;
    });

    return {
      status: "ready",
      parseStatus: "parsed",
      extractedText,
      textPreview: preview(extractedText),
      chunks,
      pageCount: result.total ?? pages.length,
      sourceMetadata: { parser: "pdf-parse", noOcr: true },
    };
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(buffer: Buffer): Promise<ParsedFileResult> {
  const result = await mammoth.extractRawText({ buffer });
  const extractedText = compactWhitespace(result.value ?? "");
  if (!extractedText) {
    return {
      status: "ready",
      parseStatus: "no_text",
      extractedText: null,
      textPreview: "No extractable text found.",
      chunks: [],
      sourceMetadata: { parser: "mammoth", messages: result.messages ?? [] },
      errorMessage: "No extractable text found.",
    };
  }
  return {
    status: "ready",
    parseStatus: "parsed",
    extractedText,
    textPreview: preview(extractedText),
    chunks: chunkText(extractedText, { metadata: { source: "docx_text" } }),
    sourceMetadata: { parser: "mammoth", messages: result.messages ?? [] },
  };
}

function parseText(buffer: Buffer, extension: string): ParsedFileResult {
  const extractedText = compactWhitespace(buffer.toString("utf8"));
  if (!extractedText) {
    return {
      status: "ready",
      parseStatus: "no_text",
      extractedText: null,
      textPreview: "No extractable text found.",
      chunks: [],
      sourceMetadata: { parser: "raw_text", extension },
      errorMessage: "No extractable text found.",
    };
  }
  return {
    status: "ready",
    parseStatus: "parsed",
    extractedText,
    textPreview: preview(extractedText),
    chunks: chunkText(extractedText, { metadata: { source: extension === "md" ? "markdown" : "text" } }),
    sourceMetadata: { parser: "raw_text", extension },
  };
}

function parseCsvFile(buffer: Buffer): ParsedFileResult {
  const text = buffer.toString("utf8");
  let records: unknown[][];
  try {
    records = parseCsv(text, {
      bom: true,
      relaxColumnCount: true,
      relaxQuotes: true,
      skipEmptyLines: true,
    }) as unknown[][];
  } catch {
    return {
      status: "failed",
      parseStatus: "failed",
      extractedText: null,
      textPreview: null,
      chunks: [],
      sourceMetadata: { parser: "csv-parse" },
      errorMessage: "We couldn't read this CSV. Check the delimiter and encoding, then upload again.",
    };
  }
  const headers = (records[0] ?? []).map((cell) => String(cell || ""));
  const rows = records.slice(1, MAX_TABULAR_ROWS + 1);
  const truncated = records.length - 1 > MAX_TABULAR_ROWS;
  const chunks: FileChunkDraft[] = [];

  for (let offset = 0; offset < rows.length; offset += CSV_ROWS_PER_CHUNK) {
    const rowSlice = rows.slice(offset, offset + CSV_ROWS_PER_CHUNK);
    const content = markdownTable(headers, rowSlice);
    chunks.push({
      chunkIndex: chunks.length,
      content,
      contentPreview: preview(content, 280),
      rowStart: offset + 2,
      rowEnd: offset + rowSlice.length + 1,
      tokenEstimate: estimateTokens(content),
      metadata: { source: "csv_rows", truncated },
    });
  }

  const extractedText = compactWhitespace(chunks.map((chunk) => chunk.content).join("\n\n"));
  return {
    status: "ready",
    parseStatus: extractedText ? "parsed" : "no_text",
    extractedText: extractedText || null,
    textPreview: extractedText ? preview(extractedText) : "No extractable text found.",
    chunks,
    rowCount: records.length ? records.length - 1 : 0,
    sourceMetadata: { parser: "csv-parse", headers, truncated, extractedRows: rows.length },
    errorMessage: extractedText ? null : "No extractable text found.",
  };
}

function parseXlsx(buffer: Buffer): ParsedFileResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const chunks: FileChunkDraft[] = [];
  let totalRows = 0;
  let truncated = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const headers = (rows[0] ?? []).map((cell) => String(cell || ""));
    const dataRows = rows.slice(1);
    totalRows += dataRows.length;
    const limitedRows = dataRows.slice(0, MAX_TABULAR_ROWS);
    truncated = truncated || dataRows.length > MAX_TABULAR_ROWS;

    for (let offset = 0; offset < limitedRows.length; offset += XLSX_ROWS_PER_CHUNK) {
      const rowSlice = limitedRows.slice(offset, offset + XLSX_ROWS_PER_CHUNK);
      const content = `Sheet: ${sheetName}\n\n${markdownTable(headers, rowSlice)}`;
      chunks.push({
        chunkIndex: chunks.length,
        content,
        contentPreview: preview(content, 280),
        sheetName,
        rowStart: offset + 2,
        rowEnd: offset + rowSlice.length + 1,
        tokenEstimate: estimateTokens(content),
        metadata: { source: "xlsx_rows", truncated },
      });
    }
  }

  const extractedText = compactWhitespace(chunks.map((chunk) => chunk.content).join("\n\n"));
  return {
    status: "ready",
    parseStatus: extractedText ? "parsed" : "no_text",
    extractedText: extractedText || null,
    textPreview: extractedText ? preview(extractedText) : "No extractable text found.",
    chunks,
    sheetCount: workbook.SheetNames.length,
    rowCount: totalRows,
    sourceMetadata: { parser: "xlsx", sheetNames: workbook.SheetNames, truncated },
    errorMessage: extractedText ? null : "No extractable text found.",
  };
}

export async function parseUploadedFile(buffer: Buffer, extension: string): Promise<ParsedFileResult> {
  try {
    let result: ParsedFileResult;
    switch (extension) {
      case "pdf":
        result = await parsePdf(buffer);
        break;
      case "docx":
      case "doc":
        result = await parseDocx(buffer);
        break;
      case "xlsx":
      case "xls":
        result = parseXlsx(buffer);
        break;
      case "csv":
        result = parseCsvFile(buffer);
        break;
      case "txt":
      case "md":
        result = parseText(buffer, extension);
        break;
      default:
        return {
          status: "failed",
          parseStatus: "failed",
          extractedText: null,
          textPreview: null,
          chunks: [],
          sourceMetadata: {},
          errorMessage: "This file type is not supported yet.",
        };
    }
    // Keep stored text (and the UI preview it feeds) bounded regardless of source size.
    return {
      ...result,
      extractedText: boundStoredText(result.extractedText),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process file.";
    return {
      status: "failed",
      parseStatus: "failed",
      extractedText: null,
      textPreview: null,
      chunks: [],
      sourceMetadata: { parserError: message },
      errorMessage: friendlyParseError(message),
    };
  }
}
