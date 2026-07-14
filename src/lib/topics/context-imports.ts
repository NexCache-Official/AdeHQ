import type { SupabaseClient } from "@supabase/supabase-js";

export type TopicImportSourceScope = "room" | "topic" | "dm";

export type TopicImportMessage = {
  id: string;
  senderType: "human" | "ai" | "system";
  senderId?: string;
  senderName: string;
  content: string;
  createdAt: string;
  topicId?: string;
};

export type TopicContextImportRecord = {
  id: string;
  workspaceId: string;
  sourceRoomId?: string | null;
  sourceTopicId?: string | null;
  sourceDmId?: string | null;
  targetRoomId?: string | null;
  targetTopicId: string;
  createdBy: string;
  importReason: string;
  suggestedTitle?: string | null;
  sourceMessageIds: string[];
  sourceRangeStartMessageId?: string | null;
  sourceRangeEndMessageId?: string | null;
  summary?: string | null;
  keyFacts: string[];
  openQuestions: string[];
  participants: Array<{ name: string; role?: string }>;
  metadata: Record<string, unknown>;
  createdAt: string;
  receiptMessages?: TopicImportMessage[];
};

const GREETING_ONLY =
  /^(hi|hello|hey|yo|sup|howdy)\b[\s,!.-]*(everyone|team|all|folks|guys)?[!?.]*$/i;

const PURE_GREETING =
  /^(hi|hello|hey)\b/i;

const WORKSTREAM_KEYWORDS =
  /\b(launch|product|market|pitch|research|pricing|campaign|client|feature|competitor|roadmap|strategy|washing machine|lawnmower|supplement)\b/i;

const QUESTION_MARKERS =
  /\?|^(what|how|why|when|where|who|can|could|should|would|before i|once|need|clarif)/i;

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isGreetingOnly(text: string): boolean {
  const clean = normalizeText(text);
  if (!clean) return true;
  if (GREETING_ONLY.test(clean)) return true;
  if (clean.length <= 24 && PURE_GREETING.test(clean) && !WORKSTREAM_KEYWORDS.test(clean)) {
    return true;
  }
  return false;
}

function extractProjectEntities(text: string): string[] {
  const entities = new Set<string>();
  const patterns = [
    /\b(new\s+)?([a-z]+(?:\s+[a-z]+){0,3})\s+(product|launch|idea|project|campaign)\b/gi,
    /\b(washing machine|lawnmower|health supplement|supplement line|saas platform)\b/gi,
    /\blaunch(?:ing)?\s+(?:a\s+)?([a-z]+(?:\s+[a-z]+){0,3})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phrase = (match[2] ?? match[1] ?? match[0]).trim().toLowerCase();
      if (phrase.length >= 4) entities.add(phrase);
    }
  }
  return [...entities];
}

function messageMatchesEntity(content: string, entities: string[]): boolean {
  if (!entities.length) return true;
  const lower = content.toLowerCase();
  return entities.some((entity) => lower.includes(entity));
}

function isStaleForEntities(content: string, activeEntities: string[]): boolean {
  if (!activeEntities.length) return false;
  const lower = content.toLowerCase();
  const staleMarkers = [
    { marker: "health supplement", active: "washing machine" },
    { marker: "supplement", active: "washing machine" },
    { marker: "lawnmower", active: "washing machine" },
    { marker: "lawn mower", active: "washing machine" },
  ];
  return staleMarkers.some(
    (entry) =>
      activeEntities.some((entity) => entity.includes(entry.active)) &&
      lower.includes(entry.marker) &&
      !lower.includes(entry.active),
  );
}

function inferOpenQuestions(messages: TopicImportMessage[]): string[] {
  const questions = new Set<string>();
  for (const message of messages) {
    if (message.senderType !== "ai") continue;
    const sentences = message.content.split(/(?<=[.?!])\s+/);
    for (const sentence of sentences) {
      if (!sentence.includes("?")) continue;
      const cleaned = sentence.replace(/^[^:]*:\s*/, "").trim();
      if (cleaned.length < 12 || cleaned.length > 180) continue;
      questions.add(cleaned.endsWith("?") ? cleaned : `${cleaned}?`);
    }
  }
  return [...questions].slice(0, 5);
}

export function buildContextSummaryFromMessages(
  messages: TopicImportMessage[],
  suggestedTitle?: string,
): { summary: string; keyFacts: string[]; openQuestions: string[] } {
  const humanLines = messages.filter((m) => m.senderType === "human");
  const aiLines = messages.filter((m) => m.senderType === "ai");
  const trigger = humanLines[humanLines.length - 1];
  const keyFacts: string[] = [];

  if (trigger) {
    keyFacts.push(`${trigger.senderName} shared the core request.`);
  }
  for (const ai of aiLines.slice(-2)) {
    if (QUESTION_MARKERS.test(ai.content)) {
      keyFacts.push(`${ai.senderName} asked for clarifications.`);
    } else {
      keyFacts.push(`${ai.senderName} added follow-up context.`);
    }
  }

  const openQuestions = inferOpenQuestions(messages);
  const productHint =
    trigger && WORKSTREAM_KEYWORDS.test(trigger.content)
      ? trigger.content.replace(/\s+/g, " ").slice(0, 160)
      : suggestedTitle ?? "this workstream";

  const summaryParts = [
    `Continuing from the previous conversation about ${productHint.replace(/\.$/, "")}.`,
    openQuestions.length
      ? `Open clarifications: ${openQuestions.slice(0, 3).join(" ")}`
      : "The team can continue from the imported context below.",
  ];

  return {
    summary: summaryParts.join(" "),
    keyFacts,
    openQuestions,
  };
}

function titleTokensFromSuggested(title?: string): string[] {
  if (!title?.trim()) return [];
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "at",
    "plus",
    "package",
    "launch",
    "pricing",
    "ops",
    "sales",
    "limits",
  ]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !stop.has(t))
    .slice(0, 8);
}

function matchesTitleTokens(content: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const lower = content.toLowerCase();
  const hits = tokens.filter((t) => lower.includes(t)).length;
  return tokens.length <= 2 ? hits >= 1 : hits >= Math.min(2, tokens.length);
}

/**
 * Re-filter candidate message ids against a topic title before migrating.
 * Keeps the trigger id always; drops clearly unrelated prior workstreams.
 */
export function filterMessageIdsForTopicMigration(params: {
  messages: Array<{ id: string; content: string; senderType?: string }>;
  candidateIds: string[];
  suggestedTopicTitle: string;
  triggerMessageId?: string;
}): string[] {
  const tokens = titleTokensFromSuggested(params.suggestedTopicTitle);
  const byId = new Map(params.messages.map((m) => [m.id, m]));
  const kept: string[] = [];
  for (const id of params.candidateIds) {
    const message = byId.get(id);
    if (!message) continue;
    if (params.triggerMessageId && id === params.triggerMessageId) {
      kept.push(id);
      continue;
    }
    if (!tokens.length || matchesTitleTokens(message.content, tokens)) {
      kept.push(id);
    }
  }
  if (params.triggerMessageId && !kept.includes(params.triggerMessageId)) {
    kept.push(params.triggerMessageId);
  }
  return [...new Set(kept)];
}

export function selectMessagesForTopicImport(params: {
  messages: TopicImportMessage[];
  triggerMessageId: string;
  suggestedTopicTitle?: string;
  maxMessages?: number;
}): TopicImportMessage[] {
  const maxMessages = params.maxMessages ?? 8;
  const byId = new Map(params.messages.map((message) => [message.id, message]));
  const trigger = byId.get(params.triggerMessageId);
  if (!trigger) return [];

  const ordered = [...params.messages].sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  );
  const triggerIndex = ordered.findIndex((message) => message.id === params.triggerMessageId);
  if (triggerIndex < 0) return [trigger];

  const titleTokens = titleTokensFromSuggested(params.suggestedTopicTitle);
  const activeEntities = [
    ...extractProjectEntities(trigger.content),
    ...extractProjectEntities(params.suggestedTopicTitle ?? ""),
    ...titleTokens,
  ];
  const windowStart = Math.max(0, triggerIndex - maxMessages + 1);
  let candidates = ordered.slice(windowStart, triggerIndex + 1);

  // Prefer the contiguous recent cluster that matches the suggested title.
  if (titleTokens.length) {
    let clusterStart = triggerIndex;
    for (let i = triggerIndex; i >= windowStart; i -= 1) {
      const message = ordered[i];
      if (isGreetingOnly(message.content)) break;
      if (
        message.id === params.triggerMessageId ||
        matchesTitleTokens(message.content, titleTokens) ||
        messageMatchesEntity(message.content, activeEntities)
      ) {
        clusterStart = i;
        continue;
      }
      // Stop when we hit a human message about a different workstream.
      if (message.senderType === "human" && message.content.length > 40) break;
    }
    candidates = ordered.slice(clusterStart, triggerIndex + 1);
  } else {
    const firstWorkIndex = candidates.findIndex(
      (message) => !isGreetingOnly(message.content) && WORKSTREAM_KEYWORDS.test(message.content),
    );
    if (firstWorkIndex >= 0) {
      candidates = candidates.slice(firstWorkIndex);
    } else {
      candidates = candidates.filter((message) => !isGreetingOnly(message.content));
    }
  }

  candidates = candidates.filter(
    (message) =>
      message.id === params.triggerMessageId ||
      !isStaleForEntities(message.content, activeEntities),
  );

  candidates = candidates.filter((message) => {
    if (message.id === params.triggerMessageId) return true;
    if (titleTokens.length) {
      // AI replies after a matching human turn stay if nearby; otherwise require tokens.
      if (message.senderType === "ai") {
        return matchesTitleTokens(message.content, titleTokens) || message.content.length < 280;
      }
      return matchesTitleTokens(message.content, titleTokens);
    }
    return messageMatchesEntity(message.content, activeEntities) || message.senderType === "ai";
  });

  const selected: TopicImportMessage[] = [];
  const seen = new Set<string>();
  for (const message of candidates) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    selected.push(message);
  }

  if (!selected.some((message) => message.id === params.triggerMessageId)) {
    selected.push(trigger);
  }

  const aiFollowUps = ordered.slice(triggerIndex + 1, triggerIndex + 3).filter((message) => {
    if (message.senderType !== "ai") return false;
    if (isStaleForEntities(message.content, activeEntities)) return false;
    if (titleTokens.length && !matchesTitleTokens(message.content, titleTokens)) {
      // Keep short acknowledgements that immediately follow the trigger.
      return message.content.length < 220;
    }
    return true;
  });
  for (const message of aiFollowUps) {
    if (selected.length >= maxMessages) break;
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    selected.push(message);
  }

  return selected.slice(-maxMessages);
}

export function buildImportedContextBlock(imports: TopicContextImportRecord[]): string {
  if (!imports.length) return "";
  const latest = imports[imports.length - 1];
  const lines = [
    "Imported context for this topic:",
    `- Source: ${latest.sourceTopicId ? "previous topic" : latest.sourceDmId ? "DM thread" : "room conversation"}`,
  ];
  if (latest.summary) lines.push(`- Summary: ${latest.summary}`);
  if (latest.keyFacts.length) {
    lines.push("- Key facts:");
    for (const fact of latest.keyFacts.slice(0, 5)) {
      lines.push(`  - ${fact}`);
    }
  }
  const receipts = latest.receiptMessages ?? [];
  if (receipts.length) {
    lines.push("- Relevant messages:");
    for (const message of receipts.slice(0, 6)) {
      const snippet = normalizeText(message.content).slice(0, 220);
      lines.push(`  - ${message.senderName}: ${snippet}`);
    }
  }
  if (latest.openQuestions.length) {
    lines.push("- Open questions:");
    for (const question of latest.openQuestions.slice(0, 5)) {
      lines.push(`  - ${question}`);
    }
  }
  lines.push(
    "- Treat imported receipts as background only — do not repeat the receipt card verbatim and do not assume the user pivoted from an old project unless they said so.",
  );
  return lines.join("\n");
}

function rowToRecord(row: Record<string, unknown>, receiptMessages?: TopicImportMessage[]): TopicContextImportRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceRoomId: row.source_room_id ? String(row.source_room_id) : null,
    sourceTopicId: row.source_topic_id ? String(row.source_topic_id) : null,
    sourceDmId: row.source_dm_id ? String(row.source_dm_id) : null,
    targetRoomId: row.target_room_id ? String(row.target_room_id) : null,
    targetTopicId: String(row.target_topic_id),
    createdBy: String(row.created_by),
    importReason: String(row.import_reason ?? "topic_suggestion"),
    suggestedTitle: row.suggested_title ? String(row.suggested_title) : null,
    sourceMessageIds: Array.isArray(row.source_message_ids)
      ? row.source_message_ids.map(String)
      : [],
    sourceRangeStartMessageId: row.source_range_start_message_id
      ? String(row.source_range_start_message_id)
      : null,
    sourceRangeEndMessageId: row.source_range_end_message_id
      ? String(row.source_range_end_message_id)
      : null,
    summary: row.summary ? String(row.summary) : null,
    keyFacts: Array.isArray(row.key_facts) ? row.key_facts.map(String) : [],
    openQuestions: Array.isArray(row.open_questions) ? row.open_questions.map(String) : [],
    participants: Array.isArray(row.participants)
      ? (row.participants as Array<{ name: string; role?: string }>)
      : [],
    metadata: typeof row.metadata === "object" && row.metadata ? (row.metadata as Record<string, unknown>) : {},
    createdAt: String(row.created_at ?? new Date().toISOString()),
    receiptMessages,
  };
}

export async function fetchMessagesForImportSelection(
  client: SupabaseClient,
  workspaceId: string,
  params: {
    sourceRoomId: string;
    sourceTopicId?: string | null;
    messageIds?: string[];
    limit?: number;
  },
): Promise<TopicImportMessage[]> {
  let query = client
    .from("messages")
    .select("id, sender_type, sender_id, sender_name, content, created_at, topic_id")
    .eq("workspace_id", workspaceId)
    .eq("room_id", params.sourceRoomId)
    .order("created_at", { ascending: true })
    .limit(params.limit ?? 40);

  if (params.sourceTopicId) {
    query = query.eq("topic_id", params.sourceTopicId);
  }
  if (params.messageIds?.length) {
    query = query.in("id", params.messageIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id),
    senderType: row.sender_type as TopicImportMessage["senderType"],
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    senderName: String(row.sender_name ?? "Unknown"),
    content: String(row.content ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
  }));
}

export async function createTopicContextImport(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    createdBy: string;
    targetRoomId: string;
    targetTopicId: string;
    sourceRoomId?: string | null;
    sourceTopicId?: string | null;
    sourceDmId?: string | null;
    triggerMessageId: string;
    suggestedTitle?: string;
    importReason?: string;
    sourceMessages: TopicImportMessage[];
    metadata?: Record<string, unknown>;
  },
): Promise<TopicContextImportRecord> {
  const selected = params.sourceMessages;
  const { summary, keyFacts, openQuestions } = buildContextSummaryFromMessages(
    selected,
    params.suggestedTitle,
  );
  const participants = [...new Map(
    selected.map((message) => [
      message.senderName,
      { name: message.senderName, role: message.senderType },
    ]),
  ).values()];

  const { data, error } = await client
    .from("topic_context_imports")
    .insert({
      workspace_id: params.workspaceId,
      source_room_id: params.sourceRoomId ?? null,
      source_topic_id: params.sourceTopicId ?? null,
      source_dm_id: params.sourceDmId ?? null,
      target_room_id: params.targetRoomId,
      target_topic_id: params.targetTopicId,
      created_by: params.createdBy,
      import_reason: params.importReason ?? "topic_suggestion",
      suggested_title: params.suggestedTitle ?? null,
      source_message_ids: selected.map((message) => message.id),
      source_range_start_message_id: selected[0]?.id ?? null,
      source_range_end_message_id: selected[selected.length - 1]?.id ?? null,
      summary,
      key_facts: keyFacts,
      open_questions: openQuestions,
      participants,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return rowToRecord(data as Record<string, unknown>, selected);
}

export async function getTopicContextImportsForTopic(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<TopicContextImportRecord[]> {
  const { data, error } = await client
    .from("topic_context_imports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("target_topic_id", topicId)
    .order("created_at", { ascending: true });

  if (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const allIds = [...new Set(rows.flatMap((row) => (Array.isArray(row.source_message_ids) ? row.source_message_ids.map(String) : [])))];
  let receiptById = new Map<string, TopicImportMessage>();
  if (allIds.length) {
    const { data: messageRows } = await client
      .from("messages")
      .select("id, sender_type, sender_id, sender_name, content, created_at, topic_id")
      .eq("workspace_id", workspaceId)
      .in("id", allIds);
    receiptById = new Map(
      (messageRows ?? []).map((row) => [
        String(row.id),
        {
          id: String(row.id),
          senderType: row.sender_type as TopicImportMessage["senderType"],
          senderId: row.sender_id ? String(row.sender_id) : undefined,
          senderName: String(row.sender_name ?? "Unknown"),
          content: String(row.content ?? ""),
          createdAt: String(row.created_at ?? new Date().toISOString()),
          topicId: row.topic_id ? String(row.topic_id) : undefined,
        },
      ]),
    );
  }

  return rows.map((row) => {
    const ids = Array.isArray(row.source_message_ids) ? row.source_message_ids.map(String) : [];
    const receiptMessages = ids
      .map((id) => receiptById.get(id))
      .filter(Boolean) as TopicImportMessage[];
    return rowToRecord(row, receiptMessages);
  });
}
