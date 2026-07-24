/**
 * In-memory inbox seed for demo mode so /inbox matches Inbox.dc.html
 * without a real Supabase mailbox session.
 */
import type {
  InboxMailboxResponse,
  MessageDTO,
  ThreadDetailDTO,
  ThreadSummaryDTO,
} from "@/lib/inbox/types";

const DEMO_MAILBOX_ADDRESS = "helloade@inbox.adehq.com";
const DEMO_THREAD_ID = "demo-thread-sent-1";
const NOW = new Date().toISOString();

export const DEMO_INBOX_ACCESS = {
  canRead: true,
  canSend: true,
  canOrganize: true,
  canManage: true,
  canApprove: true,
  isAdmin: true,
  role: "admin",
  permissions: ["read", "send", "organize", "manage", "approve"] as string[],
};

export function demoMailboxResponse(workspaceId: string): InboxMailboxResponse {
  return {
    claimed: true,
    mailbox: {
      id: "demo-mailbox",
      workspaceId,
      address: DEMO_MAILBOX_ADDRESS,
      displayName: "AdeHQ Headquarters",
      status: "active",
    },
    access: { ...DEMO_INBOX_ACCESS },
  };
}

export function demoInboxBrief(greeting?: string) {
  const hour = new Date().getHours();
  const auto =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return {
    greeting: greeting ?? auto,
    mailboxAddress: DEMO_MAILBOX_ADDRESS,
    stats: {
      unread: 0,
      needsApproval: 0,
      highPriority: 0,
      assignedToMe: 0,
    },
  };
}

export function demoThreadsForFolder(folder: string): ThreadSummaryDTO[] {
  if (folder !== "sent" && folder !== "all" && folder !== "awaiting") return [];
  return [
    {
      id: DEMO_THREAD_ID,
      subject: "This is the subject",
      snippet: "This is the body — Best, Shubham",
      peer: "skumar@nexcache.com",
      peerName: null,
      peerKind: "to",
      timestamp: NOW,
      hasUnread: false,
      hasAttachments: false,
      directionState: "outbound",
      status: "open",
      isSpam: false,
      deliveryStatus: "sent",
      assigneeId: null,
      suggestedEmployeeId: null,
      priority: "normal",
      replyRequired: false,
      triageStatus: "ready",
      draftStatus: "idle",
      category: null,
      aiActivity: null,
      missionStatus: "waiting_reply",
      missionOwnerEmployeeId: null,
      labels: [],
    },
  ];
}

export function demoThreadDetail(): ThreadDetailDTO {
  const message: MessageDTO = {
    id: "demo-msg-1",
    direction: "outbound",
    fromAddress: DEMO_MAILBOX_ADDRESS,
    fromName: "AdeHQ Headquarters",
    to: ["skumar@nexcache.com"],
    cc: [],
    bcc: [],
    subject: "This is the subject",
    textBody: "This is the body\n\nBest,\nShubham",
    htmlSanitised: null,
    createdAt: NOW,
    deliveryStatus: "sent",
    deliveryError: null,
    outboxId: null,
    attachments: [],
  };

  return {
    id: DEMO_THREAD_ID,
    subject: "This is the subject",
    status: "open",
    isSpam: false,
    hasUnread: false,
    directionState: "outbound",
    messages: [message],
    triageStatus: "ready",
    draftStatus: "idle",
    category: null,
    priority: "normal",
    replyRequired: false,
    triageConfidence: 1,
    assignmentConfidence: 0,
    assignmentSource: null,
    assigneeId: null,
    assigneeKind: null,
    suggestedEmployeeId: null,
    assigneeName: null,
    suggestedEmployeeName: null,
    keyPoints: [],
    summary: null,
    suggestedNextAction: null,
    matchReason: null,
    suggestionDismissed: true,
    latestDraftId: null,
    assistanceModeSuggestsActions: false,
    missionStatus: "waiting_reply",
    missionOwnerEmployeeId: null,
    lastWakeAt: null,
    originRoomId: null,
    originTopicId: null,
  };
}

export const DEMO_THREAD_ID_SENT = DEMO_THREAD_ID;
export const DEMO_MAILBOX_ADDR = DEMO_MAILBOX_ADDRESS;
