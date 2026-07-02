import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, ResponseReason } from "@/lib/types";

export const ROOM_AMBIENT_COOLDOWN_MS = 3 * 60 * 1000;
export const MAX_AI_TO_AI_HOPS = 2;
export const MAX_FOLLOW_UP_RUNS_PER_ROOT = 3;
export const MAX_SAME_EMPLOYEE_REENTRY = 1;
export const GREETING_MAX_OUTPUT_TOKENS = 120;

export const AMBIENT_RESPONSE_REASONS: ResponseReason[] = [
  "group_greeting",
  "smart_assist_role_match",
  "ambient_help_request",
  "ambient_role_match",
  "ambient_collaboration_lead",
];

const GREETING_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howdy)\b/i,
  /\b(hi|hello|hey)\s+(everyone|team|all|folks|guys)\b/i,
  /\bhow('s| is) it going\b/i,
  /\bgood\s+(morning|afternoon|evening)\b/i,
  /\bwhat('s| is) up\b/i,
];

const BROADCAST_PATTERNS = [
  /\b(hey|hi)\s+(team|everyone|all|folks)\b/i,
  /\b(everyone|team|all)\b/i,
];

const ACTION_VERBS =
  /\b(draft|review|build|research|follow up|prepare|implement|investigate|analyze|design|ship|fix|create|write|send)\b/i;

const LOW_ACTION_PATTERNS = [
  /^(thanks|thank you|ok|okay|cool|got it|sounds good|nice|great|perfect|👍|🙏)\.?!?$/i,
  /^(hi|hello|hey)\b/i,
];

export function isGroupGreeting(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return GREETING_PATTERNS.some((p) => p.test(text));
}

export function isBroadcastToEveryone(content: string): boolean {
  const text = content.trim();
  return BROADCAST_PATTERNS.some((p) => p.test(text));
}

export function isLowActionMessage(content: string): boolean {
  const text = content.trim();
  if (!text) return true;
  return LOW_ACTION_PATTERNS.some((p) => p.test(text));
}

export function isActionOriented(content: string): boolean {
  return ACTION_VERBS.test(content);
}

export function pickGreetingEmployee(employees: AIEmployee[]): AIEmployee | undefined {
  if (!employees.length) return undefined;
  const social = employees.find((e) => e.participationStyle === "social_coordinator");
  if (social) return social;
  const byRole = (key: AIEmployee["roleKey"]) =>
    employees.find((e) => e.roleKey === key);
  return (
    byRole("pm") ??
    byRole("operations") ??
    [...employees].sort(
      (a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt),
    )[0]
  );
}

export type RoomGovernanceContext = {
  lastMessageSenderType?: "human" | "ai" | "system";
  lastAmbientResponseAt?: string | null;
};

export async function loadRoomGovernanceContext(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  excludeMessageId?: string,
): Promise<RoomGovernanceContext> {
  const since = new Date(Date.now() - ROOM_AMBIENT_COOLDOWN_MS).toISOString();

  let lastMsgQuery = client
    .from("messages")
    .select("sender_type")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (excludeMessageId) {
    lastMsgQuery = lastMsgQuery.neq("id", excludeMessageId);
  }

  const [lastMsgResult, ambientResult] = await Promise.all([
    lastMsgQuery.maybeSingle(),
    client
      .from("agent_runs")
      .select("started_at")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .in("response_reason", AMBIENT_RESPONSE_REASONS)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    lastMessageSenderType: lastMsgResult.data?.sender_type as
      | RoomGovernanceContext["lastMessageSenderType"]
      | undefined,
    lastAmbientResponseAt: ambientResult.data?.started_at
      ? String(ambientResult.data.started_at)
      : null,
  };
}

export function isRoomCooldownActive(ctx: RoomGovernanceContext): boolean {
  if (!ctx.lastAmbientResponseAt) return false;
  return Date.now() - +new Date(ctx.lastAmbientResponseAt) < ROOM_AMBIENT_COOLDOWN_MS;
}

export function responseReasonLabel(
  reason: ResponseReason,
  employeeName?: string,
): string {
  switch (reason) {
    case "explicit_mention":
      return employeeName ? `${employeeName} — @mentioned` : "Responded to @mention";
    case "dm_default":
      return employeeName ? `${employeeName} — DM default` : "DM default response";
    case "group_greeting":
      return employeeName ? `${employeeName} — group greeting` : "Group greeting";
    case "smart_assist_role_match":
      return employeeName
        ? `${employeeName} — matched role relevance`
        : "Smart assist role match";
    case "ai_mention":
      return employeeName ? `${employeeName} — AI @mention chain` : "AI @mention chain";
    case "handoff":
      return employeeName ? `${employeeName} — handoff` : "Handoff";
    case "slash_command":
      return employeeName ? `${employeeName} — slash command` : "Slash command";
    case "blocked_cooldown":
      return "Blocked — room cooldown";
    case "blocked_policy":
      return "Blocked — AI paused or policy";
    case "collaboration_lead":
      return employeeName ? `${employeeName} — leading collaboration` : "Collaboration lead";
    case "collaboration_collaborator":
      return employeeName ? `${employeeName} — collaboration follow-up` : "Collaboration collaborator";
    case "panel_response":
      return employeeName ? `${employeeName} — panel perspective` : "Panel response";
    case "sequential_dependent":
      return employeeName ? `${employeeName} — sequential step` : "Sequential dependent";
    case "ambient_help_request":
      return employeeName ? `${employeeName} — help request match` : "Ambient help request";
    case "ambient_role_match":
      return employeeName ? `${employeeName} — role domain match` : "Ambient role match";
    case "ambient_collaboration_lead":
      return employeeName ? `${employeeName} — leading ambient collaboration` : "Ambient collaboration lead";
    case "ambient_collaboration_collaborator":
      return employeeName
        ? `${employeeName} — ambient collaboration follow-up`
        : "Ambient collaboration collaborator";
    default:
      return reason;
  }
}
