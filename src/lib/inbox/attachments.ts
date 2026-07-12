/**
 * Attachment risk classification for inbound mail.
 */

import {
  DANGEROUS_ATTACHMENT_EXTENSIONS,
  DANGEROUS_ATTACHMENT_MIME_PREFIXES,
} from "./types";

export type AttachmentRisk = {
  quarantineState: "clean" | "quarantined" | "blocked" | "pending_scan";
  flags: string[];
};

export function classifyAttachmentRisk(input: {
  filename?: string | null;
  contentType?: string | null;
}): AttachmentRisk {
  const flags: string[] = [];
  const name = (input.filename ?? "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const mime = (input.contentType ?? "").toLowerCase();

  if (ext && DANGEROUS_ATTACHMENT_EXTENSIONS.has(ext)) {
    flags.push(`blocked_extension:${ext}`);
  }
  for (const prefix of DANGEROUS_ATTACHMENT_MIME_PREFIXES) {
    if (mime.startsWith(prefix)) {
      flags.push(`blocked_mime:${mime}`);
      break;
    }
  }

  if (flags.length > 0) {
    return { quarantineState: "blocked", flags };
  }
  return { quarantineState: "clean", flags: [] };
}
