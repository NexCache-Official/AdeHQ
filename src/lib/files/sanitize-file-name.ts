/** Safe filename helpers — kept separate from file-processing to avoid pulling pdf-parse into lightweight routes. */

/** Storage-object-safe name: no spaces (Next.js fetch rejects unencoded space URLs). */
export function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .trim();
  return cleaned.slice(0, 160) || "file";
}

export function fileExtension(fileName: string): string {
  return sanitizeFileName(fileName).split(".").pop()?.toLowerCase() ?? "";
}
