import { sanitizeFileName } from "@/lib/files/sanitize-file-name";

export type DriveNameConflict = {
  originalName: string;
  displayName: string;
  existingFileId: string;
  existingDisplayName: string;
  suggestedName: string;
};

export function splitDisplayName(fileName: string): { stem: string; ext: string } {
  const safe = sanitizeFileName(fileName);
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) {
    return { stem: safe, ext: "" };
  }
  return { stem: safe.slice(0, dot), ext: safe.slice(dot) };
}

/** Next free name: report.pdf → report-1.pdf → report-2.pdf */
export function nextNumberedDisplayName(
  fileName: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set(
    [...existingNames].map((name) => sanitizeFileName(name).toLowerCase()),
  );
  const base = sanitizeFileName(fileName);
  if (!taken.has(base.toLowerCase())) return base;

  const { stem, ext } = splitDisplayName(base);
  let n = 1;
  while (n < 10_000) {
    const candidate = sanitizeFileName(`${stem}-${n}${ext}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n += 1;
  }
  return sanitizeFileName(`${stem}-${Date.now()}${ext}`);
}
