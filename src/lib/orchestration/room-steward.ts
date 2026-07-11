import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject as runtimeGenerateObject, planRoute, RuntimeDisabledError } from "@/lib/ai/runtime";
import type { RuntimeProviderPref, RuntimeV2Mode } from "@/lib/ai/runtime";
import { getRuntimeFlags, isRuntimeShadowMode } from "@/lib/ai/runtime/flags";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import type { EmployeeIntelligencePolicy } from "@/lib/types";
import {
  isBroadcastToEveryone,
  isGroupGreeting,
} from "@/lib/server/room-governance";
import { rankEmployeesForMessage } from "./employee-relevance";
import { rankEmployeesByRoleEmbedding } from "./employee-role-embeddings";
import type {
  AIEmployeeProfile,
  PendingQuestionAnswerType,
  RoomStewardDecision,
  RoomStewardIntent,
  RoomStewardParticipationMode,
  RoomStewardResponseStyle,
  TopicOrchestrationPendingQuestion,
  TopicOrchestrationState,
  TopicOrchestrationWorkIntent,
} from "./types";

export type RoomStewardRosterEmployee = {
  employeeId: string;
  name: string;
  roleTitle: string;
  roleKey: string;
  expertiseSummary: string;
  intelligencePolicy?: EmployeeIntelligencePolicy;
  isActiveInTopic: boolean;
};

export type RoomStewardMessage = {
  id: string;
  authorType: "human" | "ai";
  authorName: string;
  employeeId?: string;
  content: string;
  createdAt: string;
};

export type RoomStewardInput = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  messageId: string;
  messageContent: string;
  authorType: "human" | "ai";
  authorEmployeeId?: string;
  mentionedEmployeeIds?: string[];
  mentionedHumanIds?: string[];
  participationMode:
    | RoomStewardParticipationMode
    | "silent_observation"
    | "smart_assist_lite";
  roster: RoomStewardRosterEmployee[];
  recentMessages: RoomStewardMessage[];
  topicState: TopicOrchestrationState;
};

export type RoomStewardClassifyOptions = {
  forceMode?: RuntimeV2Mode;
  forceProviderPref?: RuntimeProviderPref;
  /** Enables the embedding-based role-match fallback (Phase 3a) before the LLM steward. */
  client?: SupabaseClient;
};

export type RoomStewardTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubRuntimeDecision?: Partial<RoomStewardDecision> | null;
  onRuntimeCall?: (input: RoomStewardInput) => void;
  onFallback?: (info: { reason: string }) => void;
  onEmbeddingMatch?: (info: { employeeId: string; similarity: number }) => void;
};

const ROOM_STEWARD_INTENTS = [
  "silent_note",
  "social_ack",
  "social_broadcast",
  "direct_question",
  "answer_to_pending_question",
  "task_request",
  "work_update",
  "ask_for_opinion",
  "handoff_response",
  "employee_followup_needed",
  "offer_help",
  "multi_employee_collaboration",
  "topic_shift",
  "correction_or_clarification",
] as const satisfies readonly RoomStewardIntent[];

const RESPONSE_STYLES = [
  "answer",
  "continue_thread",
  "ask_followup",
  "offer_help",
  "panel",
  "silent",
] as const satisfies readonly RoomStewardResponseStyle[];

const stewardRuntimeSchema = z.object({
  intent: z.enum(ROOM_STEWARD_INTENTS),
  confidence: z.number().min(0).max(1),
  shouldRespond: z.boolean(),
  selectedEmployeeIds: z.array(z.string()).default([]),
  offerOnlyEmployeeIds: z.array(z.string()).default([]),
  responseStyle: z.enum(RESPONSE_STYLES),
  reason: z.string(),
  pendingQuestionUpdates: z
    .array(
      z.object({
        questionId: z.string(),
        status: z.enum(["answered", "expired"]),
        answeredAtMessageId: z.string().optional(),
        extractedAnswer: z.string().optional(),
      }),
    )
    .default([]),
});

let roomStewardTestHooks: RoomStewardTestHooks | null = null;

export function setRoomStewardTestHooks(hooks: RoomStewardTestHooks | null): void {
  roomStewardTestHooks = hooks;
}

function normalizeParticipationMode(
  mode: RoomStewardInput["participationMode"],
): RoomStewardParticipationMode {
  if (mode === "active_team") return "active_team";
  if (mode === "manual_only") return "manual_only";
  if (mode === "silent_observation" || mode === "talent_observation") {
    return "talent_observation";
  }
  return "smart_assist";
}

export function createEmptyTopicOrchestrationState(params: {
  workspaceId: string;
  roomId: string;
  topicId: string;
}): TopicOrchestrationState {
  return {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    activeEmployeeIds: [],
    pendingQuestions: [],
    currentWorkIntent: "unknown",
  };
}

function isMissingStateTableError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  const message = err?.message?.toLowerCase() ?? "";
  return err?.code === "42P01" || message.includes("topic_orchestration_state");
}

function sanitizePendingQuestions(value: unknown): TopicOrchestrationPendingQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as Partial<TopicOrchestrationPendingQuestion>;
      if (!row.id || !row.askedByEmployeeId || !row.askedAtMessageId || !row.questionText) {
        return null;
      }
      const status =
        row.status === "answered" || row.status === "expired" ? row.status : "open";
      return {
        id: String(row.id),
        askedByEmployeeId: String(row.askedByEmployeeId),
        askedAtMessageId: String(row.askedAtMessageId),
        questionText: String(row.questionText),
        expectedAnswerType: normalizeExpectedAnswerType(row.expectedAnswerType),
        createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
        expiresAt: row.expiresAt ? String(row.expiresAt) : undefined,
        answeredAtMessageId: row.answeredAtMessageId
          ? String(row.answeredAtMessageId)
          : undefined,
        status,
      };
    })
    .filter(Boolean) as TopicOrchestrationPendingQuestion[];
}

function rowToTopicOrchestrationState(
  row: Record<string, unknown>,
  fallback: { workspaceId: string; roomId: string; topicId: string },
): TopicOrchestrationState {
  return {
    workspaceId: String(row.workspace_id ?? fallback.workspaceId),
    roomId: String(row.room_id ?? fallback.roomId),
    topicId: String(row.topic_id ?? fallback.topicId),
    activeEmployeeIds: Array.isArray(row.active_employee_ids)
      ? (row.active_employee_ids as unknown[]).map(String)
      : [],
    lastHumanMessageId: row.last_human_message_id
      ? String(row.last_human_message_id)
      : undefined,
    lastAiMessageId: row.last_ai_message_id ? String(row.last_ai_message_id) : undefined,
    pendingQuestions: sanitizePendingQuestions(row.pending_questions),
    currentWorkIntent: normalizeWorkIntent(row.current_work_intent),
    lastDecision: row.last_decision ? String(row.last_decision) : undefined,
    lastProjectEntity: row.last_project_entity ? String(row.last_project_entity) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function loadTopicOrchestrationState(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; topicId: string },
): Promise<TopicOrchestrationState> {
  const empty = createEmptyTopicOrchestrationState(params);
  try {
    const { data, error } = await client
      .from("topic_orchestration_state")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("topic_id", params.topicId)
      .maybeSingle();
    if (error) {
      if (isMissingStateTableError(error)) return empty;
      console.warn("[AdeHQ room steward] state load failed", error);
      return empty;
    }
    if (!data) return empty;
    return rowToTopicOrchestrationState(data as Record<string, unknown>, params);
  } catch (error) {
    if (!isMissingStateTableError(error)) {
      console.warn("[AdeHQ room steward] state load failed", error);
    }
    return empty;
  }
}

export async function persistTopicOrchestrationState(
  client: SupabaseClient,
  state: TopicOrchestrationState,
): Promise<void> {
  try {
    const { error } = await client.from("topic_orchestration_state").upsert(
      {
        workspace_id: state.workspaceId,
        room_id: state.roomId,
        topic_id: state.topicId,
        active_employee_ids: state.activeEmployeeIds,
        last_human_message_id: state.lastHumanMessageId ?? null,
        last_ai_message_id: state.lastAiMessageId ?? null,
        pending_questions: state.pendingQuestions,
        current_work_intent: state.currentWorkIntent ?? "unknown",
        last_decision: state.lastDecision ?? null,
        last_project_entity: state.lastProjectEntity ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,topic_id" },
    );
    if (error && !isMissingStateTableError(error)) {
      console.warn("[AdeHQ room steward] state persist failed", error);
    }
  } catch (error) {
    if (!isMissingStateTableError(error)) {
      console.warn("[AdeHQ room steward] state persist failed", error);
    }
  }
}

function normalizeExpectedAnswerType(value: unknown): PendingQuestionAnswerType {
  if (
    value === "product_type" ||
    value === "target_customer" ||
    value === "differentiator" ||
    value === "approval" ||
    value === "preference" ||
    value === "missing_detail" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeWorkIntent(value: unknown): TopicOrchestrationWorkIntent {
  if (
    value === "launch_pitch" ||
    value === "market_research" ||
    value === "sales_pitch" ||
    value === "hiring" ||
    value === "artifact_creation" ||
    value === "general_discussion" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function inferExpectedAnswerType(questionText: string): PendingQuestionAnswerType {
  const text = questionText.toLowerCase();
  if (/\b(type|kind|category)\b/.test(text) || /\bwhat .*building\b/.test(text)) {
    return "product_type";
  }
  if (/\b(target|customer|buyer|audience|who('?s| is)? it for|homeowner|commercial)\b/.test(text)) {
    return "target_customer";
  }
  if (/\b(different|differentiator|unique|stand out|advantage|edge)\b/.test(text)) {
    return "differentiator";
  }
  if (/^(is|are|do|does|did|can|could|should|would|will)\b/.test(text)) {
    return "approval";
  }
  if (/\b(prefer|preference|which|choose|option)\b/.test(text)) {
    return "preference";
  }
  if (/\b(price|budget|cost|timeline|date|deadline|when|where|how many|how much)\b/.test(text)) {
    return "missing_detail";
  }
  return "unknown";
}

function safeQuestionId(messageId: string, index: number): string {
  return `pq_${messageId.replace(/[^a-zA-Z0-9]/g, "_")}_${index}`;
}

export function extractPendingQuestionsFromAiMessage(params: {
  content: string;
  askedByEmployeeId: string;
  askedAtMessageId: string;
  createdAt?: string;
}): TopicOrchestrationPendingQuestion[] {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const questionTexts = params.content
    .replace(/\s+/g, " ")
    .match(/[^?]+\?/g);
  if (!questionTexts?.length) return [];

  return questionTexts.slice(0, 6).map((raw, index) => {
    const questionText = raw.trim();
    return {
      id: safeQuestionId(params.askedAtMessageId, index),
      askedByEmployeeId: params.askedByEmployeeId,
      askedAtMessageId: params.askedAtMessageId,
      questionText,
      expectedAnswerType: inferExpectedAnswerType(questionText),
      createdAt,
      status: "open",
    };
  });
}

export async function recordAiMessageInTopicOrchestrationState(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    employeeId: string;
    messageId: string;
    content: string;
    createdAt?: string;
  },
): Promise<void> {
  const state = await loadTopicOrchestrationState(client, params);
  const newQuestions = extractPendingQuestionsFromAiMessage({
    content: params.content,
    askedByEmployeeId: params.employeeId,
    askedAtMessageId: params.messageId,
    createdAt: params.createdAt,
  });
  const existingById = new Map(state.pendingQuestions.map((q) => [q.id, q]));
  for (const question of newQuestions) {
    existingById.set(question.id, question);
  }
  const activeEmployeeIds = uniqueIds([params.employeeId, ...state.activeEmployeeIds]).slice(0, 8);
  await persistTopicOrchestrationState(client, {
    ...state,
    activeEmployeeIds,
    lastAiMessageId: params.messageId,
    pendingQuestions: Array.from(existingById.values()).slice(-20),
  });
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter(Boolean).map(String))];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isShortAnswer(text: string): boolean {
  const clean = text.trim();
  return Boolean(clean) && wordCount(clean) <= 18 && !clean.includes("?");
}

const SOCIAL_ACK_PATTERNS = [
  /^(thanks|thank you|thx|cheers)[!.?]*$/i,
  /^(ok|okay|got it|sounds good|cool|great|perfect)[!.?]*$/i,
];

function isSocialAck(text: string): boolean {
  return SOCIAL_ACK_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function isSilentContextNote(text: string): boolean {
  return /\b(note to self|just noting|for the record|remember that|remember the|leaving this here)\b/i.test(
    text,
  );
}

function isTopicShift(text: string): boolean {
  return /\b(new project|switching topics|different project|separate topic|new topic)\b/i.test(text);
}

function isCorrection(text: string): boolean {
  return /^(actually|correction|to clarify|clarification|no,|nope,|it'?s not|it is not)\b/i.test(
    text.trim(),
  );
}

function isOpinionRequest(text: string): boolean {
  return /\b(what do you (all|both) think|thoughts|opinions?|weigh in|what'?s your take)\b/i.test(
    text,
  );
}

function isTaskRequest(text: string): boolean {
  return /\b(can you|could you|please|help me|need help|draft|write|create|build|research|analyze|prepare|turn this into|make a)\b/i.test(
    text,
  );
}

function isDirectQuestion(text: string): boolean {
  const clean = text.trim();
  return (
    clean.includes("?") ||
    /^(what|how|why|when|where|who|can|could|should|would|will|do|does|is|are)\b/i.test(clean)
  );
}

function isExplicitManualHelp(text: string): boolean {
  return /\b(someone|anyone|team|you guys|yall|y'all)\b.*\b(help|jump in|take this)\b/i.test(text);
}

function answerMatchesQuestion(
  answer: string,
  question: TopicOrchestrationPendingQuestion,
): boolean {
  const text = answer.trim().toLowerCase();
  if (!isShortAnswer(text)) return false;
  const questionText = question.questionText.toLowerCase();

  if (question.expectedAnswerType === "product_type") {
    return /\b(robotic|autonomous|electric|battery|cordless|manual|push|ride-on|riding|gas|petrol|solar|smart|ai|lawnmower|mower|device|machine|tool|hardware|software|app)\b/i.test(
      text,
    );
  }
  if (question.expectedAnswerType === "target_customer") {
    return /\b(homeowners?|home owners?|consumers?|commercial|landscapers?|businesses|enterprises?|gardens?|parks|municipal|schools|hotels|property managers?)\b/i.test(
      text,
    );
  }
  if (question.expectedAnswerType === "differentiator") {
    return /\b(different|unique|unlike|cheaper|faster|safer|better|battery|accuracy|autonomy|feature|because|without|first|only|smarter|quieter)\b/i.test(
      text,
    );
  }
  if (question.expectedAnswerType === "approval") {
    return /^(yes|yeah|yep|no|nope|not yet|sure|go ahead|approved|don't|do not)\b/i.test(text);
  }
  if (question.expectedAnswerType === "preference") {
    return /^(the |i prefer|prefer|option|first|second|a|b|yes|no|\w+)/i.test(text);
  }
  if (question.expectedAnswerType === "missing_detail") {
    return (
      /(\$|\u00a3|\u20ac|\b\d+\b|\b(today|tomorrow|next week|homeowners?|commercial|small|large)\b)/i.test(text) ||
      wordCount(text) <= 8
    );
  }
  if (/^(is|are|do|does|did|can|could|should|would|will)\b/.test(questionText)) {
    return /^(yes|yeah|yep|no|nope|not yet|sure)\b/i.test(text);
  }
  return wordCount(text) <= 8;
}

function findPendingAnswerMatches(
  text: string,
  state: TopicOrchestrationState,
): TopicOrchestrationPendingQuestion[] {
  const open = state.pendingQuestions.filter((q) => q.status === "open");
  return open.filter((question) => answerMatchesQuestion(text, question));
}

function rosterById(input: RoomStewardInput): Map<string, RoomStewardRosterEmployee> {
  return new Map(input.roster.map((employee) => [employee.employeeId, employee]));
}

function employeeName(input: RoomStewardInput, employeeId: string): string {
  return rosterById(input).get(employeeId)?.name ?? "the employee";
}

function pickGreeterEmployeeId(input: RoomStewardInput): string | undefined {
  if (!input.roster.length) return undefined;
  const social = input.roster.find((employee) => employee.roleKey === "pm");
  if (social) return social.employeeId;
  const operations = input.roster.find((employee) => employee.roleKey === "operations");
  if (operations) return operations.employeeId;
  return input.roster[0]?.employeeId;
}

function decisionForPendingAnswerMatches(
  input: RoomStewardInput,
  pendingMatches: TopicOrchestrationPendingQuestion[],
): RoomStewardDecision {
  const participation = normalizeParticipationMode(input.participationMode);
  const primary = pendingMatches[0];
  const askerId = primary.askedByEmployeeId;
  const secondary =
    participation === "active_team"
      ? activeAiParticipants(input).filter((id) => id !== askerId).slice(0, 2)
      : [];
  const respondInMode = participation !== "manual_only" && participation !== "talent_observation";
  const selected = respondInMode ? uniqueIds([askerId, ...secondary]) : [];
  const offerOnlyEmployeeIds =
    participation === "talent_observation" ? [askerId] : [];
  const asker = employeeName(input, askerId);
  return baseDecision(
    input,
    "answer_to_pending_question",
    participation === "manual_only"
      ? `The human answered ${asker}'s pending question; saved for when you @mention someone.`
      : `The human answered ${asker}'s pending ${primary.expectedAnswerType.replace(/_/g, " ")} question.`,
    {
      confidence: 0.91,
      shouldRespond: selected.length > 0,
      selectedEmployeeIds: selected,
      offerOnlyEmployeeIds,
      responseStyle:
        selected.length > 1
          ? "panel"
          : participation === "talent_observation"
            ? "offer_help"
            : "continue_thread",
      pendingQuestionUpdates: pendingMatches.map((question) => ({
        questionId: question.id,
        status: "answered" as const,
        answeredAtMessageId: input.messageId,
        extractedAnswer: input.messageContent.trim(),
      })),
    },
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionedEmployees(input: RoomStewardInput): string[] {
  const explicit = new Set(input.mentionedEmployeeIds ?? []);
  const text = input.messageContent;
  for (const employee of input.roster) {
    const full = new RegExp(`@\\s*${escapeRegex(employee.name)}\\b`, "i");
    const firstName = employee.name.split(/\s+/)[0];
    const first = firstName
      ? new RegExp(`@\\s*${escapeRegex(firstName)}\\b`, "i")
      : null;
    if (full.test(text) || (first && first.test(text))) {
      explicit.add(employee.employeeId);
    }
  }
  const valid = rosterById(input);
  return [...explicit].filter((id) => valid.has(id));
}

function toEmployeeProfiles(input: RoomStewardInput): AIEmployeeProfile[] {
  return input.roster.map((employee) => ({
    id: employee.employeeId,
    name: employee.name,
    role: employee.roleTitle,
    roleKey: employee.roleKey as AIEmployeeProfile["roleKey"],
    instructions: employee.expertiseSummary,
    seniority: "mid",
    metadata: {},
    systemEmployeeKey: null,
    isSystemEmployee: false,
    intelligencePolicy: employee.intelligencePolicy,
  }));
}

function selectRelevantEmployees(
  input: RoomStewardInput,
  limit: number,
  preferredIds: string[] = [],
): string[] {
  const valid = rosterById(input);
  const selected = uniqueIds(preferredIds).filter((id) => valid.has(id));
  if (selected.length >= limit) return selected.slice(0, limit);

  const profiles = toEmployeeProfiles(input);
  const ranked = rankEmployeesForMessage(input.messageContent, profiles);
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(row.employeeId)) selected.push(row.employeeId);
  }

  if (selected.length >= limit) return selected.slice(0, limit);
  for (const activeId of input.topicState.activeEmployeeIds) {
    if (selected.length >= limit) break;
    if (valid.has(activeId) && !selected.includes(activeId)) selected.push(activeId);
  }

  return selected.slice(0, limit);
}

function activeAiParticipants(input: RoomStewardInput): string[] {
  const fromState = input.topicState.activeEmployeeIds;
  const fromMessages = input.recentMessages
    .filter((message) => message.authorType === "ai" && message.employeeId)
    .slice(-6)
    .map((message) => message.employeeId!);
  return uniqueIds([...fromMessages.reverse(), ...fromState]).filter((id) =>
    rosterById(input).has(id),
  );
}

function inferCurrentWorkIntent(text: string, previous?: TopicOrchestrationWorkIntent): TopicOrchestrationWorkIntent {
  if (/\b(hire|hiring|candidate|recruit)\b/i.test(text)) return "hiring";
  if (/\b(market|research|competitor|landscape|benchmark)\b/i.test(text)) return "market_research";
  if (/\b(sales pitch|sell|sales|outreach|prospect)\b/i.test(text)) return "sales_pitch";
  if (/\b(launch|go-to-market|gtm|pitch|campaign)\b/i.test(text)) return "launch_pitch";
  if (/\b(artifact|doc|document|brief|report|deck|write|draft|create)\b/i.test(text)) {
    return "artifact_creation";
  }
  return previous ?? "unknown";
}

function inferProjectEntity(text: string, previous?: string): string | undefined {
  if (/\blawn\s*mower\b/i.test(text) || /\blawnmower\b/i.test(text)) return "lawnmower";
  const productMatch = text.match(/\b(?:new|robotic|electric|smart)\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})\b/i);
  if (productMatch?.[0]) return productMatch[0].toLowerCase();
  return previous;
}

function baseDecision(
  input: RoomStewardInput,
  intent: RoomStewardIntent,
  reason: string,
  opts: Partial<RoomStewardDecision> = {},
): RoomStewardDecision {
  const participation = normalizeParticipationMode(input.participationMode);
  return finalizeDecision(input, {
    intent,
    confidence: opts.confidence ?? 0.86,
    shouldRespond: opts.shouldRespond ?? false,
    selectedEmployeeIds: opts.selectedEmployeeIds ?? [],
    offerOnlyEmployeeIds: opts.offerOnlyEmployeeIds ?? [],
    responseStyle: opts.responseStyle ?? "silent",
    reason,
    pendingQuestionUpdates: opts.pendingQuestionUpdates ?? [],
    newPendingQuestions: opts.newPendingQuestions,
    suppressedEmployeeIds: opts.suppressedEmployeeIds,
    participation,
    costPolicy: {
      stewardModel: "efficient",
      maxEmployeeCalls: maxEmployeeCallsForMode(participation),
      estimatedEmployeeCalls: 0,
      stewardCall: true,
      selectedEmployeeCalls: 0,
      suppressedEmployeeCount: 0,
    },
  });
}

function maxEmployeeCallsForMode(mode: RoomStewardParticipationMode): number {
  if (mode === "manual_only") return 3;
  if (mode === "active_team") return 3;
  if (mode === "talent_observation") return 1;
  return 2;
}

function limitSelectionForMode(
  ids: string[],
  mode: RoomStewardParticipationMode,
  isExplicitMention: boolean,
): string[] {
  const limit = isExplicitMention ? Math.min(3, Math.max(1, ids.length)) : maxEmployeeCallsForMode(mode);
  if (mode === "talent_observation" && !isExplicitMention) return [];
  return uniqueIds(ids).slice(0, limit);
}

function finalizeDecision(
  input: RoomStewardInput,
  decision: RoomStewardDecision,
  isExplicitMention = false,
): RoomStewardDecision {
  const valid = rosterById(input);
  const participation = decision.participation ?? normalizeParticipationMode(input.participationMode);
  const selectedEmployeeIds = limitSelectionForMode(
    decision.selectedEmployeeIds.filter((id) => valid.has(id)),
    participation,
    isExplicitMention,
  );
  const offerLimit = participation === "talent_observation" ? 1 : maxEmployeeCallsForMode(participation);
  const offerOnlyEmployeeIds = uniqueIds(decision.offerOnlyEmployeeIds)
    .filter((id) => valid.has(id) && !selectedEmployeeIds.includes(id))
    .slice(0, offerLimit);

  const shouldRespond = decision.shouldRespond && selectedEmployeeIds.length > 0;
  const suppressedEmployeeIds = input.roster
    .map((employee) => employee.employeeId)
    .filter((id) => !selectedEmployeeIds.includes(id) && !offerOnlyEmployeeIds.includes(id));
  const costPolicy = {
    stewardModel: "efficient" as const,
    maxEmployeeCalls: maxEmployeeCallsForMode(participation),
    estimatedEmployeeCalls: selectedEmployeeIds.length,
    stewardCall: true as const,
    selectedEmployeeCalls: selectedEmployeeIds.length,
    suppressedEmployeeCount: suppressedEmployeeIds.length,
    estimatedCostSavedBySuppression: undefined,
  };

  return {
    ...decision,
    participation,
    selectedEmployeeIds,
    offerOnlyEmployeeIds,
    shouldRespond,
    suppressedEmployeeIds,
    costPolicy,
  };
}

function classifyRoomMessageDeterministic(input: RoomStewardInput): RoomStewardDecision {
  const text = input.messageContent.trim();
  const participation = normalizeParticipationMode(input.participationMode);
  const mentions = mentionedEmployees(input);
  const mentionSelected = mentions.length > 0;

  if (input.authorType !== "human") {
    const newPendingQuestions =
      input.authorEmployeeId && text
        ? extractPendingQuestionsFromAiMessage({
            content: text,
            askedByEmployeeId: input.authorEmployeeId,
            askedAtMessageId: input.messageId,
          })
        : [];
    return baseDecision(input, "silent_note", "AI message recorded for room thread state.", {
      confidence: 0.92,
      newPendingQuestions,
    });
  }

  if (!text) {
    return baseDecision(input, "silent_note", "Empty message - no AI response.", {
      confidence: 0.95,
    });
  }

  if (
    (input.mentionedHumanIds?.length ?? 0) > 0 &&
    !mentionSelected
  ) {
    const professionMatch = rankEmployeesForMessage(
      text,
      toEmployeeProfiles(input),
    ).find((candidate) => candidate.score >= 12);
    if (!professionMatch) {
      return baseDecision(
        input,
        "silent_note",
        "Human-only @mention — AI employees stay silent.",
        {
          confidence: 0.97,
          shouldRespond: false,
        },
      );
    }
    return finalizeDecision(
      input,
      baseDecision(
        input,
        "direct_question",
        "Human-only @mention, but one employee has a strong professional role match.",
        {
          confidence: 0.82,
          shouldRespond: true,
          selectedEmployeeIds: [professionMatch.employeeId],
          responseStyle: "answer",
        },
      ),
    );
  }

  if (mentionSelected) {
    return finalizeDecision(
      input,
      baseDecision(input, "direct_question", "Direct @mention - selected mentioned employee(s).", {
        confidence: 0.96,
        shouldRespond: true,
        selectedEmployeeIds: mentions,
        responseStyle: mentions.length > 1 ? "panel" : "answer",
      }),
      true,
    );
  }

  if (isGroupGreeting(text) || isBroadcastToEveryone(text)) {
    if (participation === "manual_only" || participation === "talent_observation") {
      return baseDecision(input, "social_ack", "Social greeting - no AI response in this mode.", {
        confidence: 0.9,
      });
    }
    const greeterId = pickGreeterEmployeeId(input);
    if (!greeterId) {
      return baseDecision(input, "social_ack", "No eligible employee for greeting.", {
        confidence: 0.8,
      });
    }
    return finalizeDecision(
      input,
      baseDecision(input, "social_broadcast", "Social greeting - one concise reply.", {
        confidence: 0.95,
        shouldRespond: true,
        selectedEmployeeIds: [greeterId],
        responseStyle: "answer",
      }),
    );
  }

  if (isSilentContextNote(text)) {
    return baseDecision(input, "work_update", "Saved as context; no employee needs to respond.", {
      confidence: 0.88,
    });
  }

  const pendingMatches = findPendingAnswerMatches(text, input.topicState);
  if (pendingMatches.length) {
    return decisionForPendingAnswerMatches(input, pendingMatches);
  }

  if (participation === "manual_only") {
    if (isExplicitManualHelp(text)) {
      const selected = selectRelevantEmployees(input, 1);
      if (selected.length) {
        return baseDecision(input, "direct_question", "Manual Only explicit room help request - one relevant employee selected.", {
          confidence: 0.82,
          shouldRespond: true,
          selectedEmployeeIds: selected,
          responseStyle: "answer",
        });
      }
    }
    return baseDecision(input, "silent_note", "Manual Only - no @mention or manual trigger.", {
      confidence: 0.92,
    });
  }

  if (isSocialAck(text)) {
    return baseDecision(input, "social_ack", "Social acknowledgement - no AI response needed.", {
      confidence: 0.9,
    });
  }

  if (
    input.roster.length === 1 &&
    participation !== "talent_observation" &&
    (isTaskRequest(text) || isDirectQuestion(text) || wordCount(text) <= 24)
  ) {
    return baseDecision(input, "direct_question", "Single eligible employee in topic - deterministic reply.", {
      confidence: 0.9,
      shouldRespond: true,
      selectedEmployeeIds: [input.roster[0].employeeId],
      responseStyle: "answer",
    });
  }

  if (isTopicShift(text)) {
    return baseDecision(input, "topic_shift", "The message appears to start or shift to a new project/topic.", {
      confidence: 0.86,
      responseStyle: "silent",
    });
  }

  if (isCorrection(text)) {
    const active = activeAiParticipants(input).slice(0, participation === "active_team" ? 2 : 1);
    if (participation === "talent_observation") {
      return baseDecision(input, "correction_or_clarification", "Clarification noted; talent observation offers help instead of doing the work.", {
        confidence: 0.83,
        offerOnlyEmployeeIds: active.slice(0, 1),
        responseStyle: "offer_help",
      });
    }
    return baseDecision(input, "correction_or_clarification", "The human clarified or corrected active project context.", {
      confidence: 0.83,
      shouldRespond: active.length > 0,
      selectedEmployeeIds: active,
      responseStyle: active.length ? "continue_thread" : "silent",
    });
  }

  if (isOpinionRequest(text)) {
    const limit = participation === "active_team" ? 3 : 1;
    const selected = selectRelevantEmployees(input, limit, activeAiParticipants(input));
    if (participation === "talent_observation") {
      return baseDecision(input, "offer_help", "Open room opinion request - offer help without taking over.", {
        confidence: 0.84,
        offerOnlyEmployeeIds: selected.slice(0, 1),
        responseStyle: "offer_help",
      });
    }
    return baseDecision(input, selected.length > 1 ? "multi_employee_collaboration" : "ask_for_opinion", "The human asked for AI perspective.", {
      confidence: 0.86,
      shouldRespond: selected.length > 0,
      selectedEmployeeIds: selected,
      responseStyle: selected.length > 1 ? "panel" : "answer",
    });
  }

  if (isTaskRequest(text) || isDirectQuestion(text)) {
    const limit = participation === "active_team" ? 3 : 1;
    const selected = selectRelevantEmployees(input, limit, activeAiParticipants(input));
    if (participation === "talent_observation") {
      return baseDecision(input, "offer_help", "Relevant employee can offer help in Talent Observation mode.", {
        confidence: 0.8,
        offerOnlyEmployeeIds: selected.slice(0, 1),
        responseStyle: "offer_help",
      });
    }
    return baseDecision(input, isTaskRequest(text) ? "task_request" : "direct_question", "The message asks for help or a direct answer.", {
      confidence: 0.8,
      shouldRespond: selected.length > 0,
      selectedEmployeeIds: selected,
      responseStyle: selected.length > 1 ? "panel" : "answer",
    });
  }

  const rankedRoleMatches = rankEmployeesForMessage(text, toEmployeeProfiles(input));
  const topMatch = rankedRoleMatches[0];
  const runnerUp = rankedRoleMatches[1];
  const strongSingleRoleMatch =
    topMatch &&
    topMatch.score >= 14 &&
    (!runnerUp || topMatch.score >= runnerUp.score * 1.35);

  if (strongSingleRoleMatch) {
    if (participation === "talent_observation") {
      return baseDecision(input, "offer_help", "Strong role match found; offer help in Talent Observation mode.", {
        confidence: 0.82,
        offerOnlyEmployeeIds: [topMatch.employeeId],
        responseStyle: "offer_help",
      });
    }
    return baseDecision(input, "direct_question", `Strong deterministic role match: ${topMatch.reason}.`, {
      confidence: 0.84,
      shouldRespond: true,
      selectedEmployeeIds: [topMatch.employeeId],
      responseStyle: "answer",
    });
  }

  const active = activeAiParticipants(input);
  const looksLikeImportantProjectInfo =
    /\b(it'?s|it is|they are|for|target|price|cost|budget|customer|product|feature)\b/i.test(text) &&
    wordCount(text) <= 16;
  if (looksLikeImportantProjectInfo && active.length) {
    if (participation === "talent_observation") {
      return baseDecision(input, "offer_help", "Important project information noted; observer can offer help.", {
        confidence: 0.76,
        offerOnlyEmployeeIds: active.slice(0, 1),
        responseStyle: "offer_help",
      });
    }
    return baseDecision(input, "employee_followup_needed", "The human supplied project information that advances the active thread.", {
      confidence: 0.77,
      shouldRespond: true,
      selectedEmployeeIds: active.slice(0, participation === "active_team" ? 2 : 1),
      responseStyle: "continue_thread",
    });
  }

  return baseDecision(input, "silent_note", "No clear orchestration signal.", {
    confidence: 0.85,
  });
}

function buildStewardPrompt(input: RoomStewardInput): string {
  const participation = normalizeParticipationMode(input.participationMode);
  const roster = input.roster
    .map(
      (employee) =>
        `- ${employee.employeeId}: ${employee.name} (${employee.roleTitle}; ${employee.roleKey}) active=${employee.isActiveInTopic}`,
    )
    .join("\n");
  const pending = input.topicState.pendingQuestions
    .filter((question) => question.status === "open")
    .map(
      (question) =>
        `- ${question.id}: askedBy=${question.askedByEmployeeId}, type=${question.expectedAnswerType}, text="${question.questionText}"`,
    )
    .join("\n");
  const recent = input.recentMessages
    .slice(-10)
    .map((message) => `${message.authorType}:${message.authorName}: ${message.content}`)
    .join("\n");

  return `You are AdeHQ's private Room Steward. Decide whether AI employees should respond to the latest room message.

Use the smallest useful employee set. Never fan out to the full roster. Participation mode: ${participation}.

Mode rules:
- manual_only: respond only to @mentions or explicit manual help triggers.
- smart_assist: continue pending questions, answer direct questions, and select normally one employee, max two.
- active_team: can involve multiple relevant employees, max three.
- talent_observation: prefer offerOnlyEmployeeIds instead of doing full work.
- Multi-step objectives do not require the human to type /autopilot. Select the best employee owner when the request sounds like real work; the employee will decide whether to answer normally, ask one clarifying question, offer autopilot, or start autonomous work.

Open pending questions:
${pending || "- none"}

Roster:
${roster || "- none"}

Recent messages:
${recent || "- none"}

Latest message from ${input.authorType}:
${input.messageContent}

Return JSON only.`;
}

function runtimeDecisionLooksLikePlaceholder(decision: Partial<RoomStewardDecision>): boolean {
  return (
    decision.reason === "mock" ||
    decision.confidence === 0 ||
    (decision.selectedEmployeeIds?.length === 1 && decision.selectedEmployeeIds[0] === "mock")
  );
}

async function classifyWithRuntimeSteward(
  input: RoomStewardInput,
  options: RoomStewardClassifyOptions,
): Promise<Partial<RoomStewardDecision> | null> {
  if (roomStewardTestHooks?.forceRuntimeFailure) {
    throw roomStewardTestHooks.forceRuntimeFailure instanceof Error
      ? roomStewardTestHooks.forceRuntimeFailure
      : new Error("Forced room steward runtime failure (test hook)");
  }

  if (roomStewardTestHooks?.stubRuntimeDecision !== undefined) {
    return roomStewardTestHooks.stubRuntimeDecision;
  }

  const flags = getRuntimeFlags({
    mode: options.forceMode,
    providerPref: options.forceProviderPref,
  });
  if (flags.mode === "off" && !options.forceMode) return null;

  const prompt = buildStewardPrompt(input);
  const result = await runtimeGenerateObject(
    {
      workspaceId: input.workspaceId,
      capability: "classification",
      runtimeMode: "efficient",
      reasoningProfile: "none",
      schema: stewardRuntimeSchema,
      prompt,
      preferJsonMode: true,
      metadata: {
        workType: "room_steward_classify",
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        topicId: input.topicId,
        messageId: input.messageId,
        rosterSize: input.roster.length,
      },
    },
    {
      forceMode: options.forceMode,
      forceProviderPref: options.forceProviderPref,
    },
  );

  recordAiRuntime({
    provider: result.usage.providerName,
    model: result.usage.modelId,
    mode: result.shadow ? "fallback" : "live",
    fallbackReason: result.shadow ? "room_steward_shadow_plan" : undefined,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.totalCostUsd,
    durationMs: result.usage.latencyMs,
  });

  const parsed = stewardRuntimeSchema.safeParse(result.object);
  if (!parsed.success || runtimeDecisionLooksLikePlaceholder(parsed.data)) return null;
  return parsed.data;
}

function shouldInvokeRuntimeSteward(
  deterministic: RoomStewardDecision,
  options: RoomStewardClassifyOptions,
): boolean {
  if (options.forceMode) return true;
  if (deterministic.shouldRespond) return false;
  if (deterministic.offerOnlyEmployeeIds.length > 0) return false;
  return deterministic.intent === "silent_note";
}

/**
 * Genuinely-undecided intents: the deterministic classifier recognized
 * *something* worth acting on (a task, a question, an opinion request, an
 * in-progress thread) but its regex role-ranking couldn't confidently name
 * who should own it (selectedEmployeeIds ended up empty). This is broader
 * than shouldInvokeRuntimeSteward's "silent_note only" gate on purpose — an
 * embedding lookup is cheap enough to also try here, whereas the LLM steward
 * (much slower/costlier) still only fires for the narrower silent_note case.
 * Deliberately excludes confidently-silent intents (social_ack, topic_shift,
 * manual_only's own silence) — those are real decisions, not "we don't know".
 */
function shouldTryEmbeddingRoleMatch(
  deterministic: RoomStewardDecision,
  options: RoomStewardClassifyOptions,
): boolean {
  if (options.forceMode) return false;
  if (deterministic.shouldRespond) return false;
  if (deterministic.offerOnlyEmployeeIds.length > 0) return false;
  return (
    deterministic.intent === "silent_note" ||
    deterministic.intent === "task_request" ||
    deterministic.intent === "direct_question" ||
    deterministic.intent === "ask_for_opinion" ||
    deterministic.intent === "employee_followup_needed"
  );
}

function mergeRuntimeStewardDecision(
  input: RoomStewardInput,
  deterministic: RoomStewardDecision,
  runtimeDecision: Partial<RoomStewardDecision>,
  options: RoomStewardClassifyOptions,
): RoomStewardDecision {
  const flags = getRuntimeFlags({
    mode: options.forceMode,
    providerPref: options.forceProviderPref,
  });
  if (isRuntimeShadowMode(flags.mode) && !options.forceMode) {
    return deterministic;
  }

  if (!runtimeDecision.shouldRespond || (runtimeDecision.confidence ?? 0) < 0.7) {
    return deterministic;
  }

  return finalizeDecision(input, {
    ...deterministic,
    ...runtimeDecision,
    participation: normalizeParticipationMode(input.participationMode),
    pendingQuestionUpdates:
      runtimeDecision.pendingQuestionUpdates?.length
        ? runtimeDecision.pendingQuestionUpdates
        : deterministic.pendingQuestionUpdates,
    newPendingQuestions: deterministic.newPendingQuestions,
  });
}

// Cosine-similarity thresholds for treating an embedding match as confident
// enough to skip the LLM steward entirely. Deliberately conservative: a false
// deterministic pick (wrong employee replies) is worse than the ~1-3s cost of
// falling through to the LLM, so we only trust a clear, well-separated winner.
const EMBEDDING_MATCH_MIN_SIMILARITY = 0.5;
const EMBEDDING_MATCH_MIN_MARGIN = 0.08;

/**
 * Phase 3a — before paying for an LLM classification call, try a cheap
 * (~50-150ms) embedding cosine-similarity match against the roster's cached
 * role embeddings. Only fires for messages the regex heuristics in
 * classifyRoomMessageDeterministic couldn't resolve (shouldInvokeRuntimeSteward
 * already gates this to the "silent_note, no signal" case). Returns null when
 * embeddings aren't available/configured or no candidate is confident enough
 * — the caller falls through to the LLM steward as before.
 */
async function tryEmbeddingRoleMatch(
  input: RoomStewardInput,
  options: RoomStewardClassifyOptions,
): Promise<RoomStewardDecision | null> {
  if (!options.client || options.forceMode) return null;

  try {
    const ranked = await rankEmployeesByRoleEmbedding(
      options.client,
      input.workspaceId,
      input.messageContent,
      input.roster,
    );
    if (!ranked.length) return null;

    const [top, runnerUp] = ranked;
    const confidentWinner =
      top.similarity >= EMBEDDING_MATCH_MIN_SIMILARITY &&
      (!runnerUp || top.similarity - runnerUp.similarity >= EMBEDDING_MATCH_MIN_MARGIN);
    if (!confidentWinner) return null;

    roomStewardTestHooks?.onEmbeddingMatch?.({ employeeId: top.employeeId, similarity: top.similarity });

    const participation = normalizeParticipationMode(input.participationMode);
    if (participation === "manual_only" || participation === "talent_observation") {
      // These modes have their own strict rules about when to act at all —
      // let the existing deterministic/LLM path own the decision instead of
      // an embedding match overriding participation policy.
      return null;
    }

    return finalizeDecision(
      input,
      baseDecision(
        input,
        "direct_question",
        `Embedding role match (similarity ${top.similarity.toFixed(2)}) — no regex signal, but clearly this specialist's lane.`,
        {
          confidence: Math.min(0.88, 0.6 + top.similarity * 0.3),
          shouldRespond: true,
          selectedEmployeeIds: [top.employeeId],
          responseStyle: "answer",
        },
      ),
    );
  } catch (error) {
    console.warn("[AdeHQ room steward] embedding role match failed", error);
    return null;
  }
}

export async function classifyRoomMessageWithSteward(
  input: RoomStewardInput,
  options: RoomStewardClassifyOptions = {},
): Promise<RoomStewardDecision> {
  const deterministic = classifyRoomMessageDeterministic(input);

  if (shouldTryEmbeddingRoleMatch(deterministic, options)) {
    const embeddingMatch = await tryEmbeddingRoleMatch(input, options);
    if (embeddingMatch) return embeddingMatch;
  }

  if (!shouldInvokeRuntimeSteward(deterministic, options)) {
    return deterministic;
  }

  roomStewardTestHooks?.onRuntimeCall?.(input);

  try {
    const runtimeDecision = await classifyWithRuntimeSteward(input, options);
    if (!runtimeDecision) return deterministic;
    return mergeRuntimeStewardDecision(input, deterministic, runtimeDecision, options);
  } catch (error) {
    if (!(error instanceof RuntimeDisabledError)) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "auto",
        model: "room-steward",
        mode: "fallback",
        fallbackReason: "room_steward_classify_runtime_failed",
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        error: message,
      });
      roomStewardTestHooks?.onFallback?.({ reason: message });
    }
    return deterministic;
  }
}

export function applyRoomStewardDecisionToState(
  state: TopicOrchestrationState,
  decision: RoomStewardDecision,
  params: { messageId: string; messageContent: string },
): TopicOrchestrationState {
  const updatesById = new Map(decision.pendingQuestionUpdates.map((update) => [update.questionId, update]));
  const now = new Date().toISOString();
  const pendingQuestions = state.pendingQuestions.map((question) => {
    const update = updatesById.get(question.id);
    if (!update) return question;
    return {
      ...question,
      status: update.status,
      answeredAtMessageId: update.answeredAtMessageId ?? question.answeredAtMessageId,
    };
  });
  for (const question of decision.newPendingQuestions ?? []) {
    if (!pendingQuestions.some((existing) => existing.id === question.id)) {
      pendingQuestions.push(question);
    }
  }

  const activeEmployeeIds = uniqueIds([
    ...decision.selectedEmployeeIds,
    ...decision.offerOnlyEmployeeIds,
    ...state.activeEmployeeIds,
  ]).slice(0, 8);

  return {
    ...state,
    activeEmployeeIds,
    lastHumanMessageId: params.messageId,
    pendingQuestions: pendingQuestions.slice(-20),
    currentWorkIntent: inferCurrentWorkIntent(params.messageContent, state.currentWorkIntent),
    lastDecision: `${decision.intent}: ${decision.reason}`,
    lastProjectEntity: inferProjectEntity(params.messageContent, state.lastProjectEntity),
    updatedAt: now,
  };
}

export function planRoomStewardRouteEstimate(input: RoomStewardInput) {
  return planRoute(
    {
      workspaceId: input.workspaceId,
      capability: "classification",
      runtimeMode: "efficient",
      taskType: "room_steward_classify",
      message: input.messageContent.slice(0, 500),
    },
    { forceMode: "shadow" },
  );
}
