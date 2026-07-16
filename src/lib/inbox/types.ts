/**
 * Workspace inbox — shared types (Slice A + Slice B).
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

export type ThreadStatus = "open" | "waiting" | "resolved" | "archived";

export type DirectionState = "inbound" | "outbound" | "mixed";

export type MessageDirection = "inbound" | "outbound" | "internal";

/** UI folder keys — derived via query, not a DB column. */
export type InboxFolder =
  | "inbox"
  | "all"
  | "awaiting"
  | "sent"
  | "drafts"
  | "archived"
  | "spam"
  | "ai_working"
  | "needs_input"
  | "needs_approval"
  | "assigned_to_me";

export type TriageStatus =
  | "not_started"
  | "queued"
  | "running"
  | "ready"
  | "failed";

export type DraftJobStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelled";

export type EmailPriority = "low" | "normal" | "high" | "urgent";

export type MailboxDTO = {
  id: string;
  workspaceId: string;
  address: string;
  displayName: string;
  status: string;
};

export type MailboxAccessFlags = {
  canRead: boolean;
  canSend: boolean;
  canOrganize: boolean;
  canManage: boolean;
  canApprove: boolean;
  isAdmin: boolean;
  role: string;
  permissions: string[];
};

export type InboxMailboxResponse =
  | { claimed: false; canClaim: boolean }
  | { claimed: true; mailbox: MailboxDTO; access: MailboxAccessFlags };

export type AttachmentDTO = {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  quarantineState: string;
};

export type ThreadSummaryDTO = {
  id: string;
  subject: string;
  snippet: string;
  /** Primary line in the list — From (inbox) or To (sent). */
  peer: string;
  peerName: string | null;
  /** How the list should label the peer. */
  peerKind: "from" | "to";
  timestamp: string | null;
  hasUnread: boolean;
  hasAttachments: boolean;
  directionState: DirectionState;
  status: ThreadStatus;
  isSpam: boolean;
  /** Latest preview message delivery status (outbound failures show here). */
  deliveryStatus: DeliveryStatus | null;
  assigneeId: string | null;
  suggestedEmployeeId: string | null;
  priority: EmailPriority;
  replyRequired: boolean;
  triageStatus: TriageStatus;
  draftStatus: DraftJobStatus;
  category: string | null;
  aiActivity: string | null;
  missionStatus: import("./mission-status").EmailMissionStatus;
  missionOwnerEmployeeId: string | null;
  labels: Array<{ id: string; name: string; color: string | null }>;
};

export type ThreadPageDTO = {
  threads: ThreadSummaryDTO[];
  nextCursor: string | null;
};

export type MessageDTO = {
  id: string;
  direction: MessageDirection;
  fromAddress: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string | null;
  htmlSanitised: string | null;
  deliveryStatus: DeliveryStatus;
  deliveryError: string | null;
  outboxId: string | null;
  createdAt: string;
  attachments: AttachmentDTO[];
};

export type ThreadDetailDTO = {
  id: string;
  subject: string;
  status: ThreadStatus;
  isSpam: boolean;
  hasUnread: boolean;
  directionState: DirectionState;
  messages: MessageDTO[];
  triageStatus: TriageStatus;
  draftStatus: DraftJobStatus;
  category: string | null;
  priority: EmailPriority;
  replyRequired: boolean;
  triageConfidence: number;
  assignmentConfidence: number;
  assignmentSource: string | null;
  assigneeId: string | null;
  /** Who the current assignee is — human teammate or AI employee. */
  assigneeKind: "human" | "ai_employee" | null;
  suggestedEmployeeId: string | null;
  assigneeName: string | null;
  suggestedEmployeeName: string | null;
  keyPoints: string[];
  summary: string | null;
  suggestedNextAction: string | null;
  matchReason: string | null;
  suggestionDismissed: boolean;
  latestDraftId: string | null;
  assistanceModeSuggestsActions: boolean;
  missionStatus: import("./mission-status").EmailMissionStatus;
  missionOwnerEmployeeId: string | null;
  lastWakeAt: string | null;
  originRoomId: string | null;
  originTopicId: string | null;
};

export type DraftDTO = {
  id: string;
  threadId: string | null;
  status: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  updatedAt: string;
  originType: "ai_employee" | "human";
  requiresApproval: boolean;
  isStale: boolean;
  staleReason: string | null;
  employeeId: string | null;
  versionId: string | null;
  rewriteCount: number;
  basedOnMessageId: string | null;
  approvalStatus: "none" | "pending" | "approved" | "rejected" | "expired";
  approvalId: string | null;
  approvalExpiresAt: string | null;
};

export type SendResultDTO = {
  outboxId: string;
  status: OutboxStatus;
  deduped: boolean;
  threadId: string | null;
  messageId: string | null;
  /** ISO time until which cancel/undo is allowed (status still queued). */
  undoUntil?: string | null;
};

/** Attachment staged in the composer before send. */
export type ComposerAttachment = {
  filename: string;
  contentBase64: string;
  contentType: string;
  sizeBytes: number;
};

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
