import { isWorkspaceAdmin, normalizeWorkspaceRole } from "@/lib/workspace/permissions";
import type {
  AiEmployeeAccessInput,
  AiEmployeeUserGrant,
  RoomAccessInput,
  TopicAccessInput,
  WorkspaceActor,
} from "./types";

/** Canonical human-DM pair key: smallerUserId:largerUserId */
export function humanDmPairKey(userA: string, userB: string): string {
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

export function canManageAiEmployees(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canAccessMaya(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

/**
 * AI employee visibility / DM eligibility for a human.
 * Deny wins. Restricted requires allow. Workspace defaults to allow for active members.
 */
export function canAccessAiEmployee(params: {
  actor: WorkspaceActor;
  employee: AiEmployeeAccessInput;
  grant?: AiEmployeeUserGrant | null;
}): boolean {
  const { actor, employee, grant } = params;
  if (actor.status === "removed") return false;

  const role = normalizeWorkspaceRole(actor.role);
  const kind =
    employee.employeeKind ??
    (employee.isSystemManager ? "system_manager" : "workspace_employee");

  if (kind === "system_manager") {
    return canAccessMaya(role);
  }

  if (grant?.accessEffect === "deny") return false;

  const level = employee.employeeAccess ?? "workspace";

  if (level === "restricted") {
    return grant?.accessEffect === "allow";
  }

  // workspace (and department until wired): default allow; optional allow grant refines flags only
  if (grant?.accessEffect === "allow") return true;
  return role === "admin" || role === "member";
}

/** Whether the human may open / message this AI DM (includes can_dm flag). */
export function canDmAiEmployee(params: {
  actor: WorkspaceActor;
  employee: AiEmployeeAccessInput;
  grant?: AiEmployeeUserGrant | null;
}): boolean {
  if (!canAccessAiEmployee(params)) return false;
  if (params.grant?.accessEffect === "allow" && params.grant.canDm === false) return false;
  return true;
}

/**
 * Room authorization.
 * - DM: owner/peer identity only (never admin bypass).
 * - workspace visibility: any active workspace member (room_members not required).
 * - restricted/private: explicit membership required (admins included — no silent bypass).
 */
export function canAccessRoom(params: {
  actor: WorkspaceActor;
  room: RoomAccessInput;
}): boolean {
  const { actor, room } = params;
  if (actor.status === "removed") return false;

  if (room.kind === "dm") {
    const uid = actor.userId;
    if (room.dmOwnerUserId && room.dmOwnerUserId === uid) return true;
    if (room.dmPeerUserId && room.dmPeerUserId === uid) return true;
    return false;
  }

  const visibility = room.visibility ?? "workspace";
  if (visibility === "workspace") {
    return true; // caller must already be an active workspace member
  }

  // restricted | private
  return room.isRoomMember;
}

/** After revoke of AI access: nav hide + block send, but history retained. */
export function isAiDmNavigable(params: {
  actor: WorkspaceActor;
  employee: AiEmployeeAccessInput;
  grant?: AiEmployeeUserGrant | null;
  dmOwnerUserId: string;
}): boolean {
  if (params.dmOwnerUserId !== params.actor.userId) return false;
  return canDmAiEmployee(params);
}

export function canSendInRoom(params: {
  actor: WorkspaceActor;
  room: RoomAccessInput;
  /** For AI DMs: must still have AI access. */
  aiEmployee?: AiEmployeeAccessInput | null;
  grant?: AiEmployeeUserGrant | null;
}): boolean {
  if (!canAccessRoom({ actor: params.actor, room: params.room })) return false;

  if (params.room.kind === "dm" && params.room.dmEmployeeId && params.aiEmployee) {
    return canDmAiEmployee({
      actor: params.actor,
      employee: params.aiEmployee,
      grant: params.grant,
    });
  }

  return true;
}

export function canAccessTopic(params: {
  actor: WorkspaceActor;
  topic: TopicAccessInput;
}): boolean {
  if (!canAccessRoom({ actor: params.actor, room: params.topic.room })) return false;
  if (params.topic.topicDenied) return false;
  return true;
}

/**
 * Effective AI scope: human ∩ AI ∩ conversation.
 * Returns false if any layer denies.
 */
export function assertEffectiveAiScope(params: {
  actor: WorkspaceActor;
  employee: AiEmployeeAccessInput;
  grant?: AiEmployeeUserGrant | null;
  room: RoomAccessInput;
  topicDenied?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!canAccessAiEmployee(params)) {
    return { ok: false, reason: "no_ai_employee_access" };
  }
  if (!canAccessRoom({ actor: params.actor, room: params.room })) {
    return { ok: false, reason: "no_room_access" };
  }
  if (params.topicDenied) {
    return { ok: false, reason: "topic_denied" };
  }

  // Human must be party to AI DM when conversation is that DM
  if (params.room.kind === "dm" && params.room.dmEmployeeId === params.employee.id) {
    if (params.room.dmOwnerUserId !== params.actor.userId) {
      return { ok: false, reason: "not_dm_owner" };
    }
  }

  return { ok: true };
}

/** Ranked ownership reasons for shared-DM backfill. */
export type DmOwnershipReason =
  | "highest_human_sender"
  | "earliest_human_sender"
  | "earliest_human_member"
  | "workspace_admin_fallback";

export function selectDmOwner(params: {
  humanSenderCounts: Array<{ userId: string; count: number; earliestAt: string }>;
  humanMembers: Array<{ userId: string; joinedAt: string }>;
  adminUserIds: string[];
}): { ownerId: string; reason: DmOwnershipReason; messageCount: number; fallbackUsed: boolean } {
  const senders = [...params.humanSenderCounts].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.earliestAt.localeCompare(b.earliestAt);
  });

  if (senders[0] && senders[0].count > 0) {
    const top = senders[0];
    const tied = senders.filter((s) => s.count === top.count);
    if (tied.length === 1) {
      return {
        ownerId: top.userId,
        reason: "highest_human_sender",
        messageCount: top.count,
        fallbackUsed: false,
      };
    }
    const earliest = [...tied].sort((a, b) => a.earliestAt.localeCompare(b.earliestAt))[0];
    return {
      ownerId: earliest.userId,
      reason: "earliest_human_sender",
      messageCount: earliest.count,
      fallbackUsed: false,
    };
  }

  if (params.humanMembers.length > 0) {
    const earliest = [...params.humanMembers].sort((a, b) =>
      a.joinedAt.localeCompare(b.joinedAt),
    )[0];
    return {
      ownerId: earliest.userId,
      reason: "earliest_human_member",
      messageCount: 0,
      fallbackUsed: true,
    };
  }

  const admin = params.adminUserIds[0];
  if (!admin) {
    throw new Error("Unable to select DM owner: no humans or admins.");
  }
  return {
    ownerId: admin,
    reason: "workspace_admin_fallback",
    messageCount: 0,
    fallbackUsed: true,
  };
}
