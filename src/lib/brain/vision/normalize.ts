import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VISION_JPEG_QUALITY,
  VISION_MAX_ASSETS,
  VISION_MAX_BYTES_PER_ASSET,
  VISION_MAX_EDGE_PX,
  truncateAssets,
} from "./bounds";
import type {
  NormalizedVisualAsset,
  VisualAssetKind,
  VisualAssetSource,
} from "./types";

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function isVisualMimeType(mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase().trim();
  return IMAGE_MIME.has(mime) || mime.startsWith("image/");
}

export function isVisualExtension(extension: string | null | undefined): boolean {
  return IMAGE_EXT.has((extension ?? "").toLowerCase().replace(/^\./, ""));
}

export function isVisionEligibleFile(params: {
  mimeType?: string | null;
  extension?: string | null;
  parseStatus?: string | null;
}): boolean {
  if (isVisualMimeType(params.mimeType) || isVisualExtension(params.extension)) return true;
  // Image-only / scanned PDFs: no extractable text — caller may still lack page rasters.
  const ext = (params.extension ?? "").toLowerCase();
  if (ext === "pdf" && params.parseStatus === "no_text") return true;
  return false;
}

export function guessVisualKind(fileName: string, userMessage = ""): VisualAssetKind {
  const blob = `${fileName} ${userMessage}`.toLowerCase();
  if (/\b(ui|bug|regression|broken|layout)\b/.test(blob)) return "ui_bug";
  if (/\b(chart|graph|plot|dashboard)\b/.test(blob)) return "chart";
  if (/\b(receipt|invoice|contract|scan|scanned|fax)\b/.test(blob)) return "low_quality_scan";
  if (/\b(property|listing|product|sku|photo)\b/.test(blob)) return "property_product";
  if (/\b(doc|page|pdf|screenshot)\b/.test(blob)) return "document_page";
  if (/\bscreen(shot)?\b/.test(blob)) return "screenshot";
  return "other";
}

/**
 * Resize / recompress image bytes for VL context bounds.
 * Non-images are returned unchanged (caller may skip them).
 */
export async function boundVisualBytes(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string; width?: number; height?: number }> {
  if (!isVisualMimeType(mimeType)) {
    return { bytes, mimeType };
  }
  try {
    const image = sharp(bytes, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    let pipeline = image;
    if (width > VISION_MAX_EDGE_PX || height > VISION_MAX_EDGE_PX) {
      pipeline = pipeline.resize({
        width: VISION_MAX_EDGE_PX,
        height: VISION_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    let out = await pipeline.jpeg({ quality: VISION_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    if (out.byteLength > VISION_MAX_BYTES_PER_ASSET) {
      out = await sharp(out)
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer();
    }
    if (out.byteLength > VISION_MAX_BYTES_PER_ASSET) {
      out = out.subarray(0, VISION_MAX_BYTES_PER_ASSET);
    }
    const outMeta = await sharp(out).metadata();
    return {
      bytes: out,
      mimeType: "image/jpeg",
      width: outMeta.width,
      height: outMeta.height,
    };
  } catch {
    if (bytes.byteLength > VISION_MAX_BYTES_PER_ASSET) {
      return { bytes: bytes.subarray(0, VISION_MAX_BYTES_PER_ASSET), mimeType };
    }
    return { bytes, mimeType };
  }
}

export function toDataUrl(mimeType: string, bytes: Buffer): string {
  const mime = mimeType || "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function normalizeVisualAsset(input: {
  id: string;
  source: VisualAssetSource;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  kind?: VisualAssetKind;
  userMessage?: string;
  provenance?: NormalizedVisualAsset["provenance"];
}): Promise<NormalizedVisualAsset | null> {
  if (!isVisualMimeType(input.mimeType) && !isVisualExtension(input.fileName.split(".").pop())) {
    return null;
  }
  const bounded = await boundVisualBytes(input.bytes, input.mimeType);
  return {
    id: input.id,
    source: input.source,
    kind: input.kind ?? guessVisualKind(input.fileName, input.userMessage),
    fileName: input.fileName,
    mimeType: bounded.mimeType,
    bytes: bounded.bytes,
    width: bounded.width,
    height: bounded.height,
    byteLength: bounded.bytes.byteLength,
    provenance: input.provenance ?? {},
  };
}

export async function loadVisualAssetsFromWorkspaceFiles(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    fileIds: string[];
    userMessage?: string;
  },
): Promise<NormalizedVisualAsset[]> {
  const ids = [...new Set(params.fileIds.filter(Boolean))].slice(0, VISION_MAX_ASSETS * 2);
  if (!ids.length) return [];

  const { data: files, error } = await client
    .from("workspace_files")
    .select(
      "id, display_name, original_name, mime_type, extension, storage_bucket, storage_path, parse_status, status",
    )
    .eq("workspace_id", params.workspaceId)
    .in("id", ids);
  if (error) throw error;

  const assets: NormalizedVisualAsset[] = [];
  for (const row of files ?? []) {
    const mime = String(row.mime_type ?? "");
    const ext = String(row.extension ?? "");
    if (!isVisionEligibleFile({ mimeType: mime, extension: ext, parseStatus: row.parse_status })) {
      continue;
    }
    // Page-raster for scanned PDFs is not available yet — skip PDF bytes until rendered.
    if (ext.toLowerCase() === "pdf" && !isVisualMimeType(mime)) {
      continue;
    }
    const bucket = String(row.storage_bucket ?? "");
    const path = String(row.storage_path ?? "");
    if (!bucket || !path) continue;

    const { data: blob, error: dlError } = await client.storage.from(bucket).download(path);
    if (dlError || !blob) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    const fileName = String(row.display_name || row.original_name || "image");
    const normalized = await normalizeVisualAsset({
      id: String(row.id),
      source: "workspace_file",
      fileName,
      mimeType: mime || "image/jpeg",
      bytes: buffer,
      userMessage: params.userMessage,
      provenance: {
        fileId: String(row.id),
        storageBucket: bucket,
        storagePath: path,
      },
    });
    if (normalized) assets.push(normalized);
  }

  // Preserve caller priority order.
  const byId = new Map(assets.map((a) => [a.id, a]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as NormalizedVisualAsset[];
  return truncateAssets(ordered.length ? ordered : assets, VISION_MAX_ASSETS);
}

export async function loadVisualAssetsFromEmailAttachments(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    emailThreadId?: string | null;
    emailMessageId?: string | null;
    userMessage?: string;
  },
): Promise<NormalizedVisualAsset[]> {
  if (!params.emailThreadId && !params.emailMessageId) return [];

  let messageIds: string[] = [];
  if (params.emailMessageId) {
    messageIds = [params.emailMessageId];
  } else if (params.emailThreadId) {
    const { data: messages, error: msgError } = await client
      .from("email_messages")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("thread_id", params.emailThreadId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (msgError) throw msgError;
    messageIds = (messages ?? []).map((m) => String(m.id)).filter(Boolean);
  }
  if (!messageIds.length) return [];

  const { data, error } = await client
    .from("email_attachments")
    .select("id, filename, content_type, storage_path, size_bytes, message_id")
    .eq("workspace_id", params.workspaceId)
    .in("message_id", messageIds)
    .limit(12);
  if (error) throw error;

  const assets: NormalizedVisualAsset[] = [];
  for (const row of data ?? []) {
    const mime = String(row.content_type ?? "");
    if (!isVisualMimeType(mime)) continue;
    const path = String(row.storage_path ?? "");
    if (!path) continue;
    const { data: blob, error: dlError } = await client.storage
      .from("email-attachments")
      .download(path);
    if (dlError || !blob) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    const normalized = await normalizeVisualAsset({
      id: String(row.id),
      source: "inbox_attachment",
      fileName: String(row.filename || "attachment"),
      mimeType: mime,
      bytes: buffer,
      userMessage: params.userMessage,
      provenance: {
        emailAttachmentId: String(row.id),
        storageBucket: "email-attachments",
        storagePath: path,
      },
    });
    if (normalized) assets.push(normalized);
  }
  return truncateAssets(assets, VISION_MAX_ASSETS);
}
