import type { RoomTopic } from "@/lib/types";
import { hiringTopicTitle, isHiringTopic } from "@/lib/topics";
import { inferRoleFromText } from "./role-inference";
import { getRoleByKey } from "./role-library";
import { isExplicitHiringIntent } from "./maya-dm-intent";

export type HiringTopicRole = {
  roleTitle: string;
  roleKey: string | null;
};

export function parseHiringTopicRole(
  topic: Pick<RoomTopic, "title" | "metadata">,
): HiringTopicRole | null {
  if (!isHiringTopic(topic)) return null;
  const meta = topic.metadata as { roleTitle?: string; roleKey?: string } | undefined;
  const roleTitle =
    meta?.roleTitle?.trim() ||
    topic.title.replace(/^hire:\s*/i, "").trim() ||
    "";
  if (!roleTitle) return null;
  const roleKey = meta?.roleKey ?? null;
  return { roleTitle, roleKey };
}

export function rolesEquivalent(
  a: { roleKey?: string | null; roleTitle?: string | null },
  b: { roleKey?: string | null; roleTitle?: string | null },
): boolean {
  if (a.roleKey && b.roleKey) return a.roleKey === b.roleKey;
  const norm = (s?: string | null) => s?.trim().toLowerCase() ?? "";
  return norm(a.roleTitle) === norm(b.roleTitle) && norm(a.roleTitle).length > 0;
}

export function findActiveHiringTopicsForRole(
  topics: RoomTopic[],
  roomId: string,
  roleKey: string | null,
  roleTitle: string,
): RoomTopic[] {
  return topics.filter((t) => {
    if (t.roomId !== roomId || t.status === "archived") return false;
    if (!isHiringTopic(t)) return false;
    const parsed = parseHiringTopicRole(t);
    if (!parsed) return false;
    return rolesEquivalent(
      { roleKey, roleTitle },
      { roleKey: parsed.roleKey, roleTitle: parsed.roleTitle },
    );
  });
}

export function uniqueHiringTopicTitle(roleTitle: string, existingTopics: RoomTopic[]): string {
  const base = hiringTopicTitle(roleTitle);
  const titles = new Set(existingTopics.map((t) => t.title.trim().toLowerCase()));
  if (!titles.has(base.toLowerCase())) return base;
  let n = 2;
  while (titles.has(`${base} (${n})`.toLowerCase())) n += 1;
  return `${base} (${n})`;
}

export type InTopicRoleChange = {
  userText: string;
  newRoleTitle: string;
  newRoleKey: string;
  currentRoleTitle: string;
  currentRoleKey: string | null;
};

const ROLE_CHANGE_CUES = [
  /\bactually\b/i,
  /\binstead\b/i,
  /\brather\b/i,
  /\bchange (this )?to\b/i,
  /\bswitch to\b/i,
  /\bnot (a|an) /i,
  /\bwant (a|an) /i,
  /\bhire (a|an) /i,
];

export function detectInTopicRoleChange(
  text: string,
  current: HiringTopicRole,
): InTopicRoleChange | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const hasCue = ROLE_CHANGE_CUES.some((p) => p.test(trimmed));
  const explicitHire = isExplicitHiringIntent(trimmed);
  if (!hasCue && !explicitHire) return null;

  const inference = inferRoleFromText(trimmed);
  const match = inference.matches[0];
  const newRoleKey = match?.roleKey ?? "custom";
  const newRoleTitle =
    match?.title ?? getRoleByKey(newRoleKey)?.title ?? trimmed.slice(0, 48);

  if (rolesEquivalent(current, { roleKey: newRoleKey, roleTitle: newRoleTitle })) {
    return null;
  }

  return {
    userText: trimmed,
    newRoleTitle,
    newRoleKey,
    currentRoleTitle: current.roleTitle,
    currentRoleKey: current.roleKey,
  };
}

export function mayaInTopicRoleChangeMessage(
  currentRoleTitle: string,
  newRoleTitle: string,
): string {
  return `This topic is currently for ${currentRoleTitle}. Do you want me to create a new hiring topic for ${newRoleTitle}?`;
}

export function mayaDuplicateHiringTopicMessage(roleTitle: string): string {
  return `You already have an active hiring topic for ${roleTitle}. Would you like to continue that session or start a fresh one?`;
}
