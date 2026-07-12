/**
 * Workspace inbox — shared types (Slice A foundation).
 */

export type MailboxType = "adehq_managed" | "google" | "microsoft" | "imap_future";

export type AssistanceMode =
  | "manual"
  | "ai_triage"
  | "ai_triage_suggested_replies"
  | "ai_auto_draft";

export type InboundProcessingState =
  | "received"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "quarantined";

export type OutboxStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "cancelled";

export type DeliveryStatus =
  | "received"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "cancelled";

export const INBOX_DOMAIN_DEFAULT = "inbox.adehq.com";

export const DANGEROUS_ATTACHMENT_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "js", "jse", "vbs", "vbe",
  "wsf", "wsh", "ps1", "jar", "dll", "sys", "lnk", "hta",
  "zip", "rar", "7z", "gz", "tar", "iso", "img", "dmg",
]);

export const DANGEROUS_ATTACHMENT_MIME_PREFIXES = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/java-archive",
  "application/x-sh",
];
