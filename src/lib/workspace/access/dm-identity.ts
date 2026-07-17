import { uid } from "@/lib/utils";
import { humanDmPairKey } from "./decisions";

/** Generate a room id — never encode user ids for auth. */
export function newDmRoomId(): string {
  return uid("dm");
}

export function buildAiDmInsert(params: {
  workspaceId: string;
  ownerUserId: string;
  employeeId: string;
  name: string;
  description?: string;
  brief?: string;
  accent?: string;
  now: string;
}): {
  workspace_id: string;
  id: string;
  name: string;
  kind: "dm";
  dm_employee_id: string;
  dm_owner_user_id: string;
  dm_peer_user_id: null;
  dm_pair_key: null;
  room_visibility: null;
  description: string;
  brief: string;
  unread: number;
  accent: string;
  status: "active";
  created_at: string;
  updated_at: string;
} {
  return {
    workspace_id: params.workspaceId,
    id: newDmRoomId(),
    name: params.name,
    kind: "dm",
    dm_employee_id: params.employeeId,
    dm_owner_user_id: params.ownerUserId,
    dm_peer_user_id: null,
    dm_pair_key: null,
    room_visibility: null,
    description: params.description ?? `Direct message with ${params.name}`,
    brief: params.brief ?? "",
    unread: 0,
    accent: params.accent ?? "#0ea5e9",
    status: "active",
    created_at: params.now,
    updated_at: params.now,
  };
}

export function buildHumanDmInsert(params: {
  workspaceId: string;
  userA: string;
  userB: string;
  name: string;
  now: string;
  accent?: string;
}): {
  workspace_id: string;
  id: string;
  name: string;
  kind: "dm";
  dm_employee_id: null;
  dm_owner_user_id: string;
  dm_peer_user_id: string;
  dm_pair_key: string;
  room_visibility: null;
  description: string;
  brief: string;
  unread: number;
  accent: string;
  status: "active";
  created_at: string;
  updated_at: string;
} {
  const pairKey = humanDmPairKey(params.userA, params.userB);
  const [owner, peer] = params.userA < params.userB
    ? [params.userA, params.userB]
    : [params.userB, params.userA];

  return {
    workspace_id: params.workspaceId,
    id: newDmRoomId(),
    name: params.name,
    kind: "dm",
    dm_employee_id: null,
    dm_owner_user_id: owner,
    dm_peer_user_id: peer,
    dm_pair_key: pairKey,
    room_visibility: null,
    description: "Direct message",
    brief: "",
    unread: 0,
    accent: params.accent ?? "#3B4C6B",
    status: "active",
    created_at: params.now,
    updated_at: params.now,
  };
}
