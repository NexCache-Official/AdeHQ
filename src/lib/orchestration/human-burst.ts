/** Multi-human typing quiet window + burst dedupe for topic orchestration. */

export const HUMAN_TYPING_QUIET_MS = 5000;
/** Ignore human messages older than this when building a burst (ms). */
export const HUMAN_BURST_LOOKBACK_MS = 120_000;
/** Reject flush if a human message landed this recently (race with typing). */
export const HUMAN_BURST_FLUSH_GRACE_MS = 1000;

export type BurstHumanMessage = {
  id: string;
  senderId: string | null;
  senderName: string;
  content: string;
  createdAt: string;
};

/** Collapse whitespace, case, and trivial punctuation for duplicate detection. */
export function normalizeHumanMessageForDedupe(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * Exact match after normalize, or very high similarity for short near-copies
 * (e.g. "hello!" vs "hello"). Real edits should remain distinct.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeHumanMessageForDedupe(a);
  const nb = normalizeHumanMessageForDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen > 80) return false;
  const dist = levenshtein(na, nb);
  const ratio = 1 - dist / maxLen;
  return ratio >= 0.92 && dist <= 3;
}

/** Keep chronological distinct messages; drop near-duplicates of earlier lines. */
export function selectDistinctBurstMessages(
  messages: BurstHumanMessage[],
): BurstHumanMessage[] {
  const kept: BurstHumanMessage[] = [];
  for (const msg of messages) {
    const content = msg.content.trim();
    if (!content) continue;
    if (kept.some((prior) => isNearDuplicate(prior.content, content))) continue;
    kept.push(msg);
  }
  return kept;
}

/**
 * Build steward / responder context for one multi-author human turn.
 * Prefer latest intent; earlier distinct lines are clarifications.
 */
export function buildBurstStewardContext(messages: BurstHumanMessage[]): {
  combinedText: string;
  triggerMessageId: string;
  messageIds: string[];
  authorSummary: string;
} {
  const distinct = selectDistinctBurstMessages(messages);
  if (!distinct.length) {
    return {
      combinedText: "",
      triggerMessageId: "",
      messageIds: [],
      authorSummary: "",
    };
  }

  const lines = distinct.map((m, index) => {
    const name = m.senderName.trim() || "Human";
    return `[${index + 1}] ${name}: ${m.content.trim()}`;
  });

  const authors = [...new Set(distinct.map((m) => m.senderName.trim() || "Human"))];
  const authorSummary =
    authors.length === 1
      ? authors[0]!
      : `${authors.slice(0, -1).join(", ")} and ${authors[authors.length - 1]}`;

  const combinedText = [
    "The following human messages arrived as one conversational turn (duplicates ignored).",
    "Treat them as a single request: prefer the latest intent and use earlier lines as context/clarifications.",
    "Do not answer discarded duplicate pings separately.",
    "",
    ...lines,
  ].join("\n");

  const last = distinct[distinct.length - 1]!;
  return {
    combinedText,
    triggerMessageId: last.id,
    messageIds: distinct.map((m) => m.id),
    authorSummary,
  };
}

export function formatTypingHumansLabel(
  typingHumans: Array<{ userId: string; displayName: string }>,
  localUserId?: string | null,
): string | null {
  const remote = typingHumans.filter((h) => h.userId !== localUserId);
  if (!remote.length) return null;
  const names = remote.map((h) => h.displayName.trim() || "Someone");
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

export function burstMessagesSince(
  messages: BurstHumanMessage[],
  opts: {
    sinceIso?: string | null;
    lookbackMs?: number;
    nowMs?: number;
  } = {},
): BurstHumanMessage[] {
  const now = opts.nowMs ?? Date.now();
  const lookback = opts.lookbackMs ?? HUMAN_BURST_LOOKBACK_MS;
  const floorMs = opts.sinceIso
    ? Math.max(new Date(opts.sinceIso).getTime(), now - lookback)
    : now - lookback;

  return messages
    .filter((m) => {
      const t = new Date(m.createdAt).getTime();
      return Number.isFinite(t) && t >= floorMs;
    })
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
}
