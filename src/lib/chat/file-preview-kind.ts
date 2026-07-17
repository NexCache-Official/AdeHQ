/** Normalize chat/Drive file kinds for the in-chat mini viewer. */

export type ChatFilePreviewKind =
  | "spreadsheet"
  | "pdf"
  | "document"
  | "presentation"
  | "image"
  | "video"
  | "audio"
  | "other";

const EXT_KIND: Record<string, ChatFilePreviewKind> = {
  xlsx: "spreadsheet",
  xls: "spreadsheet",
  csv: "spreadsheet",
  pdf: "pdf",
  docx: "document",
  doc: "document",
  pptx: "presentation",
  ppt: "presentation",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
};

export function extensionFromToolName(toolName?: string | null): string | undefined {
  if (!toolName) return undefined;
  if (toolName.includes("Spreadsheet") || toolName.includes("spreadsheet")) return "xlsx";
  if (toolName.includes("Pdf") || toolName.includes("pdf")) return "pdf";
  if (toolName.includes("Docx") || toolName.includes("docx")) return "docx";
  if (toolName.includes("Presentation") || toolName.includes("presentation")) return "pptx";
  if (toolName.startsWith("image.")) return "png";
  if (toolName.startsWith("video.")) return "mp4";
  if (toolName.startsWith("speech.")) return "mp3";
  return undefined;
}

export function chatFilePreviewKind(input: {
  extension?: string | null;
  mimeType?: string | null;
  toolName?: string | null;
  fileName?: string | null;
}): ChatFilePreviewKind {
  const fromExt = (input.extension ?? "").toLowerCase().replace(/^\./, "");
  if (fromExt && EXT_KIND[fromExt]) return EXT_KIND[fromExt];

  const fromTool = extensionFromToolName(input.toolName);
  if (fromTool && EXT_KIND[fromTool]) return EXT_KIND[fromTool];

  const mime = (input.mimeType ?? "").toLowerCase();
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") {
    return "spreadsheet";
  }
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("word") || mime.includes("document")) return "document";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  const name = input.fileName ?? "";
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (EXT_KIND[ext]) return EXT_KIND[ext];
  }

  return "other";
}

/** Strip E2E / internal markers that must never appear in user-visible titles. */
export function cleanChatFileTitle(title: string): string {
  const cleaned = title
    .replace(/\[\[[^\]]*\]\]\s*/g, "")
    .replace(/\b(?:wren|maya|emily|priya|adrian)[-_]leads[-_]?\d*\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || "File";
}

export function isPreviewableChatFile(kind: ChatFilePreviewKind): boolean {
  return kind !== "other";
}
