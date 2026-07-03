import type { MentionRef } from "@/lib/types";

export type MentionParticipant = {
  id: string;
  name: string;
  type: "ai_employee" | "human";
};

export type MentionSpan = {
  start: number;
  end: number;
  ref: MentionRef;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionRefFromParticipant(participant: MentionParticipant): MentionRef {
  return { type: participant.type, id: participant.id, label: participant.name };
}

/** Resolve a name fragment (first name, partial) to a single participant. */
export function resolveParticipantByFragment(
  fragment: string,
  participants: MentionParticipant[],
): MentionParticipant | null {
  const normalized = fragment.trim().toLowerCase();
  if (!normalized) return null;

  const exact = participants.find((p) => p.name.toLowerCase() === normalized);
  if (exact) return exact;

  const byFirst = participants.filter((p) => p.name.split(/\s+/)[0]?.toLowerCase() === normalized);
  if (byFirst.length === 1) return byFirst[0];

  const partial = participants.filter((p) => p.name.toLowerCase().includes(normalized));
  if (partial.length === 1) return partial[0];

  return null;
}

function dedupeMentions(mentions: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const m of mentions) {
    const key = `${m.type}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Collect structured mentions for every @Full Name token in content. */
export function collectMentionsFromContent(
  content: string,
  participants: MentionParticipant[],
): MentionRef[] {
  const mentions: MentionRef[] = [];
  const mentioned = new Set<string>();

  const sorted = [...participants].sort((a, b) => b.name.length - a.name.length);
  for (const participant of sorted) {
    const re = new RegExp(`@${escapeRegex(participant.name)}(?=\\s|$|[,.!?;:])`, "gi");
    if (re.test(content) && !mentioned.has(participant.id)) {
      mentioned.add(participant.id);
      mentions.push(mentionRefFromParticipant(participant));
    }
  }

  return mentions;
}

/** Upgrade partial @first-name tokens to @Full Name and merge tracked mentions. */
export function resolveMessageMentions(
  content: string,
  participants: MentionParticipant[],
  tracked: MentionRef[] = [],
): { content: string; mentionsJson: MentionRef[] } {
  let normalized = content;
  const mentions: MentionRef[] = [...tracked];

  const sorted = [...participants].sort((a, b) => b.name.length - a.name.length);
  for (const participant of sorted) {
    const fullToken = `@${participant.name}`;
    if (normalized.includes(fullToken)) continue;

    const first = participant.name.split(/\s+/)[0];
    if (!first || first === participant.name) continue;

    const partialRe = new RegExp(`@${escapeRegex(first)}(?=\\s|$|[,.!?;:])`, "gi");
    if (partialRe.test(normalized)) {
      normalized = normalized.replace(partialRe, fullToken);
      if (!mentions.some((m) => m.id === participant.id && m.type === participant.type)) {
        mentions.push(mentionRefFromParticipant(participant));
      }
    }
  }

  for (const m of collectMentionsFromContent(normalized, participants)) {
    if (!mentions.some((x) => x.id === m.id && x.type === m.type)) {
      mentions.push(m);
    }
  }

  return { content: normalized, mentionsJson: dedupeMentions(mentions) };
}

const DIRECT_ADDRESS_PATTERNS = [
  /^([\w .'-]+)\s*[—–-]\s*(can you|could you|please|will you|would you|do you|what|how)/i,
  /^([\w .'-]+),\s*(can you|could you|please|will you|would you|do you|what|how)/i,
  /\b([\w .'-]+)\s*[—–-]\s*(can you|could you|please|will you|would you)\b/gi,
  /\b([\w .'-]+),\s*(can you|could you|please|will you|would you)\b/gi,
];

/** When an AI directly addresses another participant by plain name, upgrade to @Full Name. */
export function applyMentionEtiquette(
  reply: string,
  participants: MentionParticipant[],
): { content: string; mentionsJson: MentionRef[] } {
  if (!reply.trim() || participants.length === 0) {
    return { content: reply, mentionsJson: [] };
  }

  let content = reply;
  const mentions: MentionRef[] = [];
  const mentionedIds = new Set<string>();

  const addMention = (participant: MentionParticipant) => {
    const key = `${participant.type}:${participant.id}`;
    if (mentionedIds.has(key)) return;
    mentionedIds.add(key);
    mentions.push(mentionRefFromParticipant(participant));
  };

  for (const participant of participants) {
    const escaped = escapeRegex(participant.name);
    if (new RegExp(`@${escaped}`, "i").test(content)) {
      addMention(participant);
      continue;
    }

    for (const pattern of DIRECT_ADDRESS_PATTERNS) {
      pattern.lastIndex = 0;
      content = content.replace(pattern, (match, namePart: string, ...rest: string[]) => {
        const resolved = resolveParticipantByFragment(namePart, [participant]);
        if (!resolved) return match;
        const suffix = rest[0] ?? "";
        addMention(resolved);
        return `@${resolved.name} ${suffix}`;
      });
    }
  }

  for (const participant of participants) {
    const re = new RegExp(`@${escapeRegex(participant.name)}`, "gi");
    if (re.test(content)) addMention(participant);
  }

  return { content, mentionsJson: dedupeMentions(mentions) };
}

function buildResolvableMentions(
  content: string,
  mentionsJson: MentionRef[],
  participants: MentionParticipant[],
): MentionRef[] {
  const map = new Map<string, MentionRef>();
  for (const m of mentionsJson) map.set(m.label.toLowerCase(), m);
  for (const m of collectMentionsFromContent(content, participants)) {
    const key = m.label.toLowerCase();
    if (!map.has(key)) map.set(key, m);
  }
  return [...map.values()].sort((a, b) => b.label.length - a.label.length);
}

/** Non-overlapping mention spans for rendering @Full Name as interactive chips. */
export function findMentionSpans(
  content: string,
  mentionsJson: MentionRef[] = [],
  participants: MentionParticipant[] = [],
): MentionSpan[] {
  const resolvable = buildResolvableMentions(content, mentionsJson, participants);
  const spans: MentionSpan[] = [];

  for (const ref of resolvable) {
    const re = new RegExp(`@${escapeRegex(ref.label)}(?=\\s|$|[,.!?;:])`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = spans.some((s) => start < s.end && end > s.start);
      if (!overlaps) spans.push({ start, end, ref });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return spans;
}
