import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_MISSION_STATUSES = [
  "idle",
  "triaging",
  "assigned",
  "awaiting_human",
  "brainstorming",
  "drafting",
  "pending_send",
  "queued",
  "sent",
  "waiting_reply",
  "discarded",
] as const;

export type EmailMissionStatus = (typeof EMAIL_MISSION_STATUSES)[number];

export type EmailMissionSnapshot = {
  status: EmailMissionStatus;
  ownerEmployeeId: string | null;
  lastInboundAt: string | null;
  lastWakeAt: string | null;
  originRoomId: string | null;
  originTopicId: string | null;
};

type MissionInputs = {
  currentStatus?: string | null;
  assignedEmployeeId?: string | null;
  replyRequired?: boolean | null;
  latestDirection?: string | null;
  draftStatus?: string | null;
  draftRequiresApproval?: boolean | null;
  approvalStatus?: string | null;
  outboxStatus?: string | null;
  wakePosted?: boolean;
};

export function deriveEmailMissionStatus(input: MissionInputs): EmailMissionStatus {
  const outbox = input.outboxStatus ?? "";
  if (outbox === "queued" || outbox === "sending") return "queued";
  if (outbox === "sent" || outbox === "delivered") {
    return input.latestDirection === "inbound" ? "awaiting_human" : "waiting_reply";
  }
  if (outbox === "cancelled" || outbox === "failed") return "discarded";

  const approval = input.approvalStatus ?? "";
  if (approval === "pending") return "pending_send";
  if (approval === "approved") return "queued";
  if (approval === "rejected" || approval === "invalidated") {
    return input.replyRequired ? "awaiting_human" : "discarded";
  }

  const draft = input.draftStatus ?? "";
  if (draft === "pending_approval" || input.draftRequiresApproval) return "pending_send";
  if (draft === "draft" || draft === "ready") return "drafting";
  if (draft === "discarded" || draft === "cancelled") {
    return input.replyRequired ? "awaiting_human" : "discarded";
  }

  if (input.latestDirection === "inbound" && input.replyRequired) {
    return input.wakePosted ? "awaiting_human" : input.assignedEmployeeId ? "assigned" : "triaging";
  }
  if (input.assignedEmployeeId) return "assigned";

  const current = input.currentStatus as EmailMissionStatus | undefined;
  return current && EMAIL_MISSION_STATUSES.includes(current) ? current : "idle";
}

export async function updateEmailMission(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    threadId: string;
    status: EmailMissionStatus;
    ownerEmployeeId?: string | null;
    lastInboundAt?: string | null;
    lastWakeAt?: string | null;
    originRoomId?: string | null;
    originTopicId?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    mission_status: params.status,
    updated_at: new Date().toISOString(),
  };
  if ("ownerEmployeeId" in params) {
    patch.mission_owner_employee_id = params.ownerEmployeeId ?? null;
  }
  if ("lastInboundAt" in params) patch.last_inbound_at = params.lastInboundAt ?? null;
  if ("lastWakeAt" in params) patch.last_wake_at = params.lastWakeAt ?? null;
  if ("originRoomId" in params) patch.origin_room_id = params.originRoomId ?? null;
  if ("originTopicId" in params) patch.origin_topic_id = params.originTopicId ?? null;

  const { error } = await client
    .from("email_threads")
    .update(patch)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.threadId);
  if (error) throw error;
}

export const EMAIL_MISSION_LABELS: Record<EmailMissionStatus, string> = {
  idle: "Idle",
  triaging: "Triage",
  assigned: "Assigned",
  awaiting_human: "Needs your input",
  brainstorming: "Brainstorming",
  drafting: "Drafting",
  pending_send: "Needs approval",
  queued: "Sending",
  sent: "Sent",
  waiting_reply: "Awaiting reply",
  discarded: "Closed",
};
