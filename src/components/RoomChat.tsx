"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectRoom, RoomTopic, type ConversationPlan, type RoomMessage } from "@/lib/types";
import { useOrchestrationUi } from "@/components/orchestration/OrchestrationUiContext";
import { fetchTopicOrchestrations } from "@/lib/orchestration/orchestration-client";
import type { OrchestrationPlan } from "@/lib/orchestration/types";
import { readDismissedOrchestrationIds } from "@/lib/orchestration/dismissed-orchestrations";
import { enrichHumanSeenBy } from "@/lib/message-read-receipts";
import { notifyTopicSummaryUpdated, TOPIC_SUMMARY_UPDATED_EVENT } from "@/lib/topic-summary/client";
import { CHAT_CLEARED_METADATA_KEY } from "@/lib/topic-summary/persistence";
import {
  SCROLL_TO_MESSAGE_EVENT,
} from "@/lib/navigation/jump-to-source";
import {
  TopicSuggestionCard,
  acceptTopicSuggestionApi,
  dismissTopicSuggestionApi,
  type TopicSuggestionPayload,
} from "./orchestration/TopicSuggestionCard";
import { TopicContextImportCard } from "@/components/topics/TopicContextImportCard";
import type { TopicContextImportRecord } from "@/lib/topics/context-imports";
import type { SuggestedConversationAction } from "@/lib/orchestration/types";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import type { WorkMode } from "@/lib/ai/intelligence/intelligence-context";
import { useResponder } from "@/lib/ai/use-responder";
import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import { isGeneralTopic, mainChatLabel } from "@/lib/topics";
import { ROOM_CHAT_MAX_WIDTH, ROOM_CHAT_WIDE_MAX_WIDTH } from "@/lib/chat/layout";
import { RoomMessageItem } from "./RoomMessageItem";
import { StewardProgressCard } from "./StewardProgressCard";
import type { StewardProgressSnapshot } from "@/lib/brain/steward/types-execution";
import { ChatComposer, type ComposerUploadedFile, type SlashCommandResult } from "./ChatComposer";
import type { MessageActionHandlers } from "@/lib/message-actions";
import { EmptyState } from "./States";
import { Button } from "./ui";
import { WorkforceCallButton } from "@/components/calls/WorkforceCallButton";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { extractMentions, uid, cn } from "@/lib/utils";
import { readDebugMode } from "@/lib/debug-trace";
import { useDebugTrace } from "./DebugProvider";
import {
  AlertCircle,
  ArrowDown,
  Bot,
  ListChecks,
  Loader2,
  MessagesSquare,
  PanelRight,
  Phone,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { EmployeeStatusDot } from "./EmployeeStatusBadge";
import { formatEmployeeIntelligenceSummary } from "@/lib/ai/intelligence-policy";
import { canEmployeeUseBrowserResearch } from "@/lib/ai/browser-research/permissions";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import {
  fetchBrowserResearchRun,
  fetchBrowserResearchRuns,
  isActiveBrowserResearchRun,
  sortBrowserResearchRuns,
  upsertBrowserResearchRun,
  type BrowserResearchProviderConfig,
} from "@/lib/ai/browser-research/client-api";
import { useBrowserResearchRealtime } from "@/lib/ai/browser-research/use-browser-research-realtime";
import { useMessagesRealtime } from "@/lib/realtime/use-messages-realtime";
import { useAgentRunsRealtime } from "@/lib/realtime/use-agent-runs-realtime";
import { useTopicPresence } from "@/lib/realtime/use-topic-presence";
import {
  formatTypingHumansLabel,
  HUMAN_TYPING_QUIET_MS,
} from "@/lib/orchestration/human-burst";
import { BrowserResearchMessageCard } from "@/components/browser-research/BrowserResearchMessageCard";
import { STATUS_META } from "@/lib/icons";
import { effectiveEmployeeStatus, isMayaEmployee } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_SUBTITLE } from "@/lib/hiring/maya";
import { MayaDmEmptyState } from "@/components/maya/MayaDmEmptyState";
import { MayaHiringInlineCards } from "@/components/maya/MayaHiringInlineCards";
import { MayaHiringSuggestionChips } from "@/components/maya/MayaHiringSuggestionChips";
import { MayaHiringTopicSuggestionCard } from "@/components/maya/MayaHiringTopicSuggestionCard";
import { MayaEmployeePickerCard } from "@/components/maya/MayaArtifactCard";
import { useMayaRoomCoordinator } from "@/components/maya/MayaRoomCoordinator";
import { useMayaDmResponder } from "@/components/maya/useMayaDmResponder";
import { useOptionalMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { isHiringTopic } from "@/lib/topics";
import {
  ParticipantAvatarStack,
  requestOpenPeopleTab,
} from "@/components/people/RoomMembersPopover";
import { minimumReplyHoldMs } from "@/lib/ai/intelligence/adaptive-timing";
import type { ConversationDebugTrace } from "@/lib/ai/intelligence/intelligence-debug-trace";

type PendingSend = {
  clientMessageId: string;
  content: string;
};

type ActiveRun = {
  runId: string;
  employeeId: string;
  employeeName: string;
  phase:
    | "queued"
    | "reading"
    | "thinking"
    | "typing"
    | "waiting_on"
    | "done"
    | "failed"
    | "cancelled";
  error?: string;
  collaborationRole?: string;
  waitingOnEmployeeName?: string;
};

type QueuedRunClient = {
  runId: string;
  employeeId: string;
  employeeName: string;
  conversationMode?: string;
  collaborationId?: string;
  collaborationRole?: string;
  staggerIndex?: number;
};

const MESSAGE_PAGE = 50;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

type ProcessRequestResult = {
  status: number;
  ok: boolean;
  // Mirrors the JSON `done` payload / error body — consumed loosely downstream,
  // exactly as the previous `await res.json()` value was.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
};

/**
 * Runs the agent-run process request and resolves with the final reply payload
 * in one shot. Employee replies are intentionally delivered whole (Slack/iMessage
 * style), not revealed token-by-token — a live-typing placeholder that grows
 * character-by-character read as a chatbot-y typewriter effect, and (worse) could
 * briefly coexist with the persisted message once realtime delivered it, which is
 * where the "duplicate AI message" reports came from. The "AI is typing" dots
 * (driven by activeRuns phase, set independently of this request) already cover
 * the waiting state, so nothing is lost by not streaming tokens into the bubble.
 */
async function runAgentProcessRequest(params: {
  runId: string;
  workspaceId: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<ProcessRequestResult> {
  const attempt = async (): Promise<ProcessRequestResult> => {
    const res = await fetch(`/api/agent-runs/${params.runId}/process`, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        mode: "live",
      }),
      signal: params.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  };

  try {
    return await attempt();
  } catch (err) {
    // Transient network blips ("Failed to fetch") used to leave the employee
    // permanently silent for that run. Retry once unless the user/runtime
    // intentionally aborted.
    const aborted =
      params.signal?.aborted ||
      (err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message)));
    if (aborted) throw err;
    const transient =
      err instanceof TypeError ||
      (err instanceof Error && /failed to fetch|network|load failed/i.test(err.message));
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    if (params.signal?.aborted) throw err;
    return await attempt();
  }
}

function isSameCalendarDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function daySeparatorLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameCalendarDay(iso, today.toISOString())) return "Today";
  if (isSameCalendarDay(iso, yesterday.toISOString())) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function getTopicChatClearedAt(topic?: RoomTopic): string | null {
  if (!topic) return null;
  const fromMeta = topic.metadata?.[CHAT_CLEARED_METADATA_KEY];
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta;
  return null;
}

function filterBrowserResearchRunsAfterClear(
  runs: BrowserResearchRun[],
  chatClearedAt: string | null,
): BrowserResearchRun[] {
  if (!chatClearedAt) return runs;
  const clearedMs = +new Date(chatClearedAt);
  if (!Number.isFinite(clearedMs)) return runs;
  return runs.filter((run) => +new Date(run.createdAt) > clearedMs);
}

function shouldGroupWithPrevious(
  previous: import("@/lib/types").RoomMessage | undefined,
  current: import("@/lib/types").RoomMessage,
): boolean {
  if (!previous) return false;
  if (previous.senderType === "system" || current.senderType === "system") return false;
  if (previous.senderType !== current.senderType || previous.senderId !== current.senderId) return false;
  if (!isSameCalendarDay(previous.createdAt, current.createdAt)) return false;
  return Math.abs(+new Date(current.createdAt) - +new Date(previous.createdAt)) <= GROUP_WINDOW_MS;
}

export function RoomChat({
  room,
  topic,
  draftText,
  onDraftConsumed,
  onSlashCommand,
  contextFiles,
  artifactIntent,
  onContextConsumed,
  isDm = false,
  onSummarize,
  summarizing = false,
  onAddEmployee,
  messageActions,
  onSelectTopic,
}: {
  room: ProjectRoom;
  topic?: RoomTopic;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
  contextFiles?: Array<{ id: string; displayName: string }>;
  artifactIntent?: { type: import("@/lib/types").SavedArtifactType; label: string } | null;
  onContextConsumed?: () => void;
  isDm?: boolean;
  onSummarize?: (options?: { force?: boolean }) => void;
  summarizing?: boolean;
  onAddEmployee?: () => void;
  messageActions?: MessageActionHandlers;
  onSelectTopic?: (topicId: string) => void;
}) {
  const { state, actions, backend } = useStore();
  const { trace } = useDebugTrace();
  const respond = useResponder();
  const router = useRouter();
  const orchestrationUi = useOrchestrationUi();
  const triggerMessageIdRef = useRef<string | null>(null);
  const failedRunIdsRef = useRef(new Set<string>());
  const processingRunIdsRef = useRef(new Set<string>());
  const sendInFlightRef = useRef(false);
  const lastSendFingerprintRef = useRef<{ content: string; at: number } | null>(null);
  const processAbortByRunRef = useRef(new Map<string, AbortController>());
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBurstFlushRef = useRef(false);
  const flushInFlightRef = useRef(false);
  const lastHumanActivityAtRef = useRef(0);
  const [failedSend, setFailedSend] = useState<PendingSend | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [collaborationPlan, setCollaborationPlan] = useState<ConversationPlan | null>(null);
  const [stewardProgress, setStewardProgress] = useState<StewardProgressSnapshot | null>(null);
  const [orchestratorDebug, setOrchestratorDebug] = useState<Record<string, unknown> | null>(null);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestionPayload[]>([]);
  const [contextImports, setContextImports] = useState<TopicContextImportRecord[]>([]);
  const [contextImportWarning, setContextImportWarning] = useState<string | null>(null);
  const [smartAssistSuggestions, setSmartAssistSuggestions] = useState<SuggestedConversationAction[]>([]);
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE);
  const [browserResearchEnabled, setBrowserResearchEnabled] = useState(false);
  const [agentModeEnabled, setAgentModeEnabled] = useState(false);
  const [browserResearchConfig, setBrowserResearchConfig] =
    useState<BrowserResearchProviderConfig | null>(null);
  const [browserResearchRuns, setBrowserResearchRuns] = useState<BrowserResearchRun[]>([]);
  const [browserResearchBusy, setBrowserResearchBusy] = useState(false);
  const deliveredResearchRepliesRef = useRef(new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const scrollTopicKeyRef = useRef<string | null>(null);
  // Whether the viewport was already near the bottom before this update — new
  // messages only auto-scroll into view while the reader is caught up; if
  // they've scrolled up to read history, an incoming message shouldn't yank
  // them back down. Starts true so the first load / topic switch still jumps.
  const stickToBottomRef = useRef(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

  const useServerApi = backend === "supabase";
  const { typingHumans, setLocalTyping } = useTopicPresence({
    enabled: useServerApi && Boolean(topic?.id && state.workspace?.id && state.user?.id),
    workspaceId: state.workspace?.id,
    topicId: topic?.id,
    userId: state.user?.id,
    displayName: state.user?.name ?? "You",
  });
  const typingLabel = formatTypingHumansLabel(typingHumans, state.user?.id);

  const allTopicMessages = topic
    ? room.messages
        .filter((m) => m.topicId === topic.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  const topicMessages = allTopicMessages.slice(-messageLimit);
  const hasOlder = allTopicMessages.length > messageLimit;

  useEffect(() => {
    const onScrollToMessage = (event: Event) => {
      const { messageId } = (event as CustomEvent<{ messageId: string }>).detail;
      const highlight = (el: HTMLElement) => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("message-highlight");
        window.setTimeout(() => el.classList.remove("message-highlight"), 3200);
      };
      const tryScroll = () => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          highlight(el);
          return true;
        }
        return false;
      };
      if (!tryScroll() && hasOlder) {
        setMessageLimit((n) => Math.min(allTopicMessages.length, n + MESSAGE_PAGE));
        window.setTimeout(tryScroll, 250);
      }
    };
    window.addEventListener(SCROLL_TO_MESSAGE_EVENT, onScrollToMessage);
    return () => window.removeEventListener(SCROLL_TO_MESSAGE_EVENT, onScrollToMessage);
  }, [allTopicMessages.length, hasOlder, topic?.id]);

  const topicMembersForTopic = useMemo(
    () => (topic ? state.topicMembers.filter((m) => m.topicId === topic.id) : []),
    [state.topicMembers, topic],
  );

  const topicAiEmployees = useMemo(
    () =>
      topicMembersForTopic
        .filter((m) => m.memberType === "ai")
        .map((m) => state.employees.find((e) => e.id === m.memberId))
        .filter((e): e is NonNullable<typeof e> => !!e),
    [topicMembersForTopic, state.employees],
  );

  const displayMessages = useMemo(
    () =>
      topicMessages
        .filter((message) => !message.metadata?.hiddenFromFeed && !message.metadata?.stewardInternalStep)
        .map((message) => ({
          ...message,
          seenBy: enrichHumanSeenBy(
            message,
            topicMessages,
            topicMembersForTopic,
            state.workspaceMembers,
          ),
        })),
    [topicMessages, topicMembersForTopic, state.workspaceMembers],
  );

  const messageRows = useMemo(
    () =>
      displayMessages.map((message, index) => {
        const previous = displayMessages[index - 1];
        return {
          message,
          grouped: shouldGroupWithPrevious(previous, message),
          showDaySeparator: !previous || !isSameCalendarDay(previous.createdAt, message.createdAt),
        };
      }),
    [displayMessages],
  );

  const sortedBrowserResearchRuns = useMemo(
    () => sortBrowserResearchRuns(browserResearchRuns),
    [browserResearchRuns],
  );

  type ChatTimelineItem =
    | { kind: "message"; row: (typeof messageRows)[number] }
    | { kind: "research"; run: BrowserResearchRun };

  const chatTimelineItems = useMemo(() => {
    const items: ChatTimelineItem[] = [
      ...messageRows.map((row) => ({ kind: "message" as const, row })),
      ...sortedBrowserResearchRuns.map((run) => ({ kind: "research" as const, run })),
    ];
    return items.sort((a, b) => {
      const aTime = a.kind === "message" ? a.row.message.createdAt : a.run.createdAt;
      const bTime = b.kind === "message" ? b.row.message.createdAt : b.run.createdAt;
      return aTime.localeCompare(bTime);
    });
  }, [messageRows, sortedBrowserResearchRuns]);

  const roomEmployees = room.aiEmployees
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  const mentionHumans = useMemo(
    () =>
      room.humans
        .map((id) => {
          const member = state.workspaceMembers.find((m) => m.userId === id);
          return {
            id,
            name: member?.name ?? member?.email ?? "Teammate",
            email: member?.email,
            role: member?.role,
          };
        })
        .filter((h) => h.name),
    [room.humans, state.workspaceMembers],
  );

  // Reset pagination when switching room/topic so we always show the latest page.
  useEffect(() => {
    setMessageLimit(MESSAGE_PAGE);
  }, [room.id, topic?.id]);

  useEffect(() => {
    const key = `${room.id}:${topic?.id ?? ""}`;
    const switched = scrollTopicKeyRef.current !== key;
    scrollTopicKeyRef.current = key;
    const scroller = messagesScrollRef.current;
    const jumpToBottom = (behavior: ScrollBehavior) => {
      if (!scroller) {
        bottomRef.current?.scrollIntoView({ behavior, block: "end" });
        return;
      }
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    };

    if (switched) {
      // Instant jump + re-jump a frame later on chat switch — layout (file
      // viewers, chips) often settles after the first paint, otherwise we'd
      // leave a gap above the composer.
      stickToBottomRef.current = true;
      setHasNewMessagesBelow(false);
      jumpToBottom("auto");
      requestAnimationFrame(() => {
        jumpToBottom("auto");
        requestAnimationFrame(() => jumpToBottom("auto"));
      });
      return;
    }

    // Your own outgoing message always pulls you to the bottom, even if you'd
    // scrolled up — you just acted, you want to see it land. Everything else
    // (an AI reply, a teammate's message) only auto-scrolls if the reader was
    // already caught up; otherwise it surfaces a "New messages" pill instead
    // of yanking their view away from whatever they're reading.
    const latest = displayMessages.at(-1);
    const isOwnMessage = latest?.senderType === "human" && latest.senderId === state.user?.id;
    if (stickToBottomRef.current || isOwnMessage) {
      setHasNewMessagesBelow(false);
      jumpToBottom("smooth");
    } else if (latest) {
      setHasNewMessagesBelow(true);
    }
  }, [
    room.id,
    topic?.id,
    topicMessages.length,
    activeRuns.length,
    browserResearchRuns.length,
    displayMessages.at(-1)?.id,
    state.user?.id,
  ]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 120;
    stickToBottomRef.current = atBottom;
    if (atBottom) setHasNewMessagesBelow(false);
  }, []);

  const scrollToBottomNow = useCallback(() => {
    stickToBottomRef.current = true;
    setHasNewMessagesBelow(false);
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, []);

  useEffect(() => {
    if (!topic || backend !== "supabase" || !state.workspace?.id) {
      setContextImports([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(
          `/api/rooms/${room.id}/topics/${topic.id}/context-imports`,
          { headers },
        );
        const payload = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setContextImports(Array.isArray(payload.imports) ? payload.imports : []);
      } catch {
        if (!cancelled) setContextImports([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, room.id, state.workspace?.id, topic?.id]);

  // Pending topic suggestions must survive refresh — they live in DB, not only
  // in the send-message response payload.
  useEffect(() => {
    if (!topic || backend !== "supabase" || !state.workspace?.id || isDm) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/rooms/${room.id}/topic-suggestions`, { headers });
        const payload = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const incoming = Array.isArray(payload.suggestions)
          ? (payload.suggestions as TopicSuggestionPayload[])
          : [];
        // Only show suggestions that belong to the currently open topic.
        setTopicSuggestions(
          incoming.filter((s) => !s.topic_id || s.topic_id === topic.id),
        );
      } catch {
        // non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, room.id, state.workspace?.id, topic?.id, isDm]);

  useEffect(() => {
    if (!topic || backend !== "supabase" || isDm) return;
    orchestrationUi.clearSession();
    let cancelled = false;

    const hydrate = async () => {
      try {
        const dismissed = readDismissedOrchestrationIds(topic.id);
        const { active, history } = await fetchTopicOrchestrations(topic.id, dismissed);
        if (cancelled) return;
        const employeeNames = new Map(roomEmployees.map((e) => [e.id, e.name]));
        orchestrationUi.hydrateFromRecords(active, history, employeeNames, topic.id);
        const triggerId = active?.triggerMessageId ?? history[0]?.triggerMessageId ?? null;
        if (triggerId) triggerMessageIdRef.current = triggerId;
        void actions.refreshWorkLogForTopic(topic.id);
      } catch {
        // non-blocking
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, backend, roomEmployees.length, isDm]);

  useEffect(() => {
    if (!topic) return;
    const last = topicMessages[topicMessages.length - 1];
    const userId = state.user?.id;
    if (last && backend === "supabase" && userId) {
      void markTopicRead(topic.id, last.id, userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topicMessages.length]);

  const markTopicRead = async (
    topicId: string,
    lastReadMessageId: string,
    userId: string,
  ) => {
    actions.setTopicMemberRead(topicId, userId, lastReadMessageId);
    try {
      const headers = await authHeaders();
      await fetch(`/api/topics/${topicId}/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ lastReadMessageId }),
      });
    } catch {
      // non-blocking
    }
  };

  const dmEmployee = isDm
    ? roomEmployees.find((e) => e.id === room.dmEmployeeId) ?? roomEmployees[0]
    : undefined;

  const isMayaDmEmployee = Boolean(dmEmployee && isMayaEmployee(dmEmployee));
  const coordinator = useMayaRoomCoordinator();
  const mayaHiring = useOptionalMayaDmHiringContext();
  const isMayaHiringMode = Boolean(
    isMayaDmEmployee &&
      topic &&
      (coordinator?.isHiringTopic || coordinator?.isDirectChatHiring || isHiringTopic(topic)),
  );
  const isMayaGeneralChat = Boolean(
    isMayaDmEmployee && topic && isGeneralTopic(topic) && !coordinator?.isDirectChatHiring,
  );

  const mayaResponder = useMayaDmResponder({
    mayaRoomId: room.id,
    topicId: topic?.id ?? "",
    workspaceId: state.workspace?.id,
    backend,
    firstName: state.user?.name?.split(" ")[0],
    onCreateHiringTopic: coordinator?.handleCreateHiringTopic,
    onContinueHiringHere: coordinator?.handleContinueHiringHere,
    // Production: Maya Direct Chat is answered by the agent-run brain. Keep the
    // scripted hire/improve UI branches; suppress canned guide replies so we
    // don't double-bubble with the real LLM response.
    suppressGenericReplies: useServerApi,
  });

  const researchEmployee = useMemo(() => {
    if (dmEmployee && canEmployeeUseBrowserResearch(dmEmployee)) return dmEmployee;
    return roomEmployees.find(canEmployeeUseBrowserResearch);
  }, [dmEmployee, roomEmployees]);

  const browserResearchAvailable = Boolean(researchEmployee && useServerApi && !isMayaHiringMode);
  const topicChatClearedAt = getTopicChatClearedAt(topic);

  useEffect(() => {
    if (!browserResearchAvailable || !topic || !state.workspace?.id || !researchEmployee) return;
    let cancelled = false;
    void (async () => {
      try {
        const { runs, config } = await fetchBrowserResearchRuns({
          workspaceId: state.workspace!.id,
          employeeId: researchEmployee.id,
          topicId: topic.id,
        });
        if (cancelled) return;
        const visibleRuns = filterBrowserResearchRunsAfterClear(
          runs.slice(0, 5),
          topicChatClearedAt,
        );
        setBrowserResearchRuns(sortBrowserResearchRuns(visibleRuns));
        if (config) setBrowserResearchConfig(config);
      } catch {
        // non-blocking — browse mode still usable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browserResearchAvailable, researchEmployee, state.workspace?.id, topic?.id, topicChatClearedAt]);

  useEffect(() => {
    if (!topic?.id) return;
    const onTopicSummaryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ topicId?: string; cleared?: boolean }>).detail;
      if (detail?.topicId !== topic.id || !detail.cleared) return;
      setBrowserResearchRuns([]);
      deliveredResearchRepliesRef.current.clear();
    };
    window.addEventListener(TOPIC_SUMMARY_UPDATED_EVENT, onTopicSummaryUpdated);
    return () => window.removeEventListener(TOPIC_SUMMARY_UPDATED_EVENT, onTopicSummaryUpdated);
  }, [topic?.id]);

  const handleResearchRunUpdated = useCallback((run: BrowserResearchRun) => {
    if (topicChatClearedAt && +new Date(run.createdAt) <= +new Date(topicChatClearedAt)) {
      return;
    }
    setBrowserResearchRuns((current) => upsertBrowserResearchRun(current, run));
  }, [topicChatClearedAt]);

  const handleResearchChatReply = useCallback(
    (message: RoomMessage) => {
      if (!topic) return;
      if (deliveredResearchRepliesRef.current.has(message.id)) return;
      deliveredResearchRepliesRef.current.add(message.id);
      actions.addMessage(room.id, { ...message, topicId: topic.id });
      notifyTopicSummaryUpdated(topic.id);
    },
    [actions, room.id, topic],
  );

  useBrowserResearchRealtime({
    enabled: browserResearchAvailable && backend === "supabase",
    workspaceId: state.workspace?.id,
    topicId: topic?.id,
    onRunUpdated: handleResearchRunUpdated,
    onChatReply: handleResearchChatReply,
  });

  // Primary live-delivery path for ordinary chat messages — not gated behind
  // any feature flag, unlike useBrowserResearchRealtime above. Without this,
  // rooms/DMs with no research-capable employee had no realtime delivery at
  // all and depended on a manual reload or the heavy whole-workspace refetch.
  const scheduleBurstFlushRef = useRef<(() => void) | null>(null);

  const handleMessageInsert = useCallback(
    (message: RoomMessage) => {
      if (!topic) return;
      // A live-typing placeholder for this same run may still be showing locally
      // (e.g. the sending tab's own SSE reader hasn't finished yet) — this event
      // can arrive over the realtime channel first. Clear it so the final
      // persisted message never renders alongside its own in-progress ghost.
      if (message.agentRunId) {
        actions.removeLocalMessage(room.id, `stream-${message.agentRunId}`);
      }
      actions.addMessage(room.id, { ...message, topicId: topic.id });
      notifyTopicSummaryUpdated(topic.id);
    },
    [actions, room.id, topic],
  );

  const handleMessageUpdate = useCallback(
    (message: RoomMessage) => {
      if (!topic) return;
      actions.updateLocalMessage(room.id, message.id, {
        content: message.content,
        artifacts: message.artifacts,
        pending: message.pending,
      });
    },
    [actions, room.id, topic],
  );

  useMessagesRealtime({
    enabled: backend === "supabase",
    workspaceId: state.workspace?.id,
    topicId: topic?.id,
    onInsert: handleMessageInsert,
    onUpdate: handleMessageUpdate,
  });

  const handleAgentRunRealtime = useCallback(
    (run: {
      runId: string;
      status: string;
      cancelReason?: string | null;
    }) => {
      if (run.status !== "cancelled" && run.status !== "failed") return;
      const controller = processAbortByRunRef.current.get(run.runId);
      if (controller) {
        controller.abort();
        processAbortByRunRef.current.delete(run.runId);
      }
      actions.removeLocalMessage(room.id, `stream-${run.runId}`);
      processingRunIdsRef.current.delete(run.runId);
      setActiveRuns((prev) => prev.filter((r) => r.runId !== run.runId));
    },
    [actions, room.id],
  );

  useAgentRunsRealtime({
    enabled: backend === "supabase",
    workspaceId: state.workspace?.id,
    topicId: topic?.id,
    onUpdate: handleAgentRunRealtime,
  });

  const activeResearchRunIds = useMemo(
    () => browserResearchRuns.filter(isActiveBrowserResearchRun).map((run) => run.id),
    [browserResearchRuns],
  );

  // Fallback poll when Realtime misses an update (e.g. brief disconnect).
  useEffect(() => {
    if (!state.workspace?.id || !activeResearchRunIds.length || !topic) return;

    let cancelled = false;
    const pollRuns = async () => {
      for (const runId of activeResearchRunIds) {
        if (cancelled) return;
        try {
          const { run, chatReply } = await fetchBrowserResearchRun({
            workspaceId: state.workspace!.id,
            runId,
          });
          if (cancelled) return;
          setBrowserResearchRuns((current) => upsertBrowserResearchRun(current, run));
          if (
            chatReply &&
            !deliveredResearchRepliesRef.current.has(chatReply.id)
          ) {
            handleResearchChatReply(chatReply);
          }
        } catch {
          // non-blocking fallback
        }
      }
    };

    const interval = window.setInterval(() => void pollRuns(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activeResearchRunIds,
    handleResearchChatReply,
    state.workspace?.id,
    topic?.id,
  ]);

  const withDebugHeaders = async () => {
    const headers = (await authHeaders()) as Record<string, string>;
    if (readDebugMode()) headers["X-AdeHQ-Debug"] = "true";
    return headers;
  };

  const markMessageSeenByEmployee = useCallback(
    (messageId: string, employeeId: string, employeeName: string) => {
      const msg = room.messages.find((m) => m.id === messageId);
      const existing = msg?.seenBy ?? [];
      if (existing.some((s) => s.id === employeeId)) return;
      actions.updateMessage(room.id, messageId, {
        seenBy: [...existing, { id: employeeId, name: employeeName, type: "ai" }],
      });
    },
    [actions, room.id, room.messages],
  );

  const flushBurstOrchestration = useCallback(async () => {
    if (!topic || !useServerApi || !state.workspace?.id) return;
    if (flushInFlightRef.current) return;
    if (Date.now() - lastHumanActivityAtRef.current < HUMAN_TYPING_QUIET_MS) return;

    flushInFlightRef.current = true;
    pendingBurstFlushRef.current = false;
    try {
      const headers = await withDebugHeaders();
      const res = await fetch(`/api/rooms/${room.id}/topics/${topic.id}/orchestrate-burst`, {
        method: "POST",
        headers,
      });
      const payload = await parseJsonResponse<{
        queuedRuns?: QueuedRunClient[];
        skipped?: boolean;
        skipReason?: string;
        error?: string;
      }>(res);
      if (!res.ok) {
        if (payload.skipReason === "still_hot" || payload.skipReason === "lock_held") {
          pendingBurstFlushRef.current = true;
          // Re-arm quiet timer — previously we only set a flag and never retried.
          if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
          quietTimerRef.current = setTimeout(() => {
            void flushBurstOrchestration();
          }, HUMAN_TYPING_QUIET_MS);
          return;
        }
        trace("agent-run", "warn", "Burst orchestrate failed", payload);
        return;
      }
      if (payload.skipReason === "still_hot" || payload.skipReason === "lock_held") {
        pendingBurstFlushRef.current = true;
        if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
        quietTimerRef.current = setTimeout(() => {
          void flushBurstOrchestration();
        }, HUMAN_TYPING_QUIET_MS);
        return;
      }
      trace("agent-run", "info", "Burst orchestrate result", {
        queued: payload.queuedRuns?.length ?? 0,
        skipped: payload.skipped,
        skipReason: payload.skipReason,
      });
      if (payload.queuedRuns?.length) {
        // processQueuedRuns is defined below — call via ref after assignment
        await processQueuedRunsRef.current?.(payload.queuedRuns, []);
      } else if (payload.skipReason && payload.skipReason !== "no_pending_messages") {
        trace("agent-run", "warn", `Burst produced no runs (${payload.skipReason})`, payload);
      }
    } catch (error) {
      console.warn("[AdeHQ] orchestrate-burst failed", error);
      pendingBurstFlushRef.current = true;
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      quietTimerRef.current = setTimeout(() => {
        void flushBurstOrchestration();
      }, HUMAN_TYPING_QUIET_MS);
    } finally {
      flushInFlightRef.current = false;
    }
  }, [room.id, state.workspace?.id, topic, trace, useServerApi]);

  const processQueuedRunsRef = useRef<
    ((queued: QueuedRunClient[], waiting?: ActiveRun[]) => Promise<void>) | null
  >(null);

  const scheduleBurstFlush = useCallback(() => {
    lastHumanActivityAtRef.current = Date.now();
    pendingBurstFlushRef.current = true;
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => {
      void flushBurstOrchestration();
    }, HUMAN_TYPING_QUIET_MS);
  }, [flushBurstOrchestration]);

  scheduleBurstFlushRef.current = scheduleBurstFlush;

  const processQueuedRuns = useCallback(
    async (queuedRuns: QueuedRunClient[], waitingRuns: ActiveRun[] = []) => {
      if ((!queuedRuns.length && !waitingRuns.length) || !topic) return;
      if (topic.status === "archived" || room.status === "archived") return;

      trace("agent-run", "info", `Processing ${queuedRuns.length} queued run(s)`, {
        runs: queuedRuns,
        roomId: room.id,
        topicId: topic.id,
      });

      for (const waiting of waitingRuns) {
        if (!isDm) {
          orchestrationUi.updateEmployeePhase(waiting.employeeId, "waiting", undefined);
          if (waiting.waitingOnEmployeeName) {
            orchestrationUi.updateEmployeePhase(
              waiting.employeeId,
              "waiting",
              `Waiting for ${waiting.waitingOnEmployeeName}`,
            );
          }
        }
      }

      setActiveRuns([
        ...queuedRuns.map((r) => ({
          ...r,
          phase: "queued" as const,
          collaborationRole: r.collaborationRole,
        })),
        ...waitingRuns,
      ]);

      const headers = await withDebugHeaders();
      const triggerId = triggerMessageIdRef.current;

      const processOneRun = async (run: QueuedRunClient) => {
          if (failedRunIdsRef.current.has(run.runId)) return;
          if (processingRunIdsRef.current.has(run.runId)) return;
          processingRunIdsRef.current.add(run.runId);

          trace("agent-run", "info", `${run.employeeName} → reading context`, { runId: run.runId });
          if (triggerId) {
            markMessageSeenByEmployee(triggerId, run.employeeId, run.employeeName);
            actions.updateMessage(room.id, triggerId, {
              pending: false,
              deliveryStatus: "delivered",
              deliveredAt: new Date().toISOString(),
            });
          }
          if (!isDm) {
            orchestrationUi.updateEmployeePhase(run.employeeId, "reading", undefined, undefined, run.runId);
          }
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "reading" } : r,
            ),
          );

          if (!isDm) {
            orchestrationUi.updateEmployeePhase(run.employeeId, "replying", undefined, undefined, run.runId);
          }
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "thinking" } : r,
            ),
          );

          const started = Date.now();
          const abortController = new AbortController();
          processAbortByRunRef.current.set(run.runId, abortController);
          try {
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "typing" } : r,
              ),
            );

            trace("agent-run", "info", `POST /api/agent-runs/${run.runId}/process`, {
              workspaceId: state.workspace.id,
            });

            const result = await runAgentProcessRequest({
              runId: run.runId,
              workspaceId: state.workspace.id,
              headers,
              signal: abortController.signal,
            });
            processAbortByRunRef.current.delete(run.runId);

            if (result.data?.code === "aborted" || abortController.signal.aborted) {
              setActiveRuns((prev) => prev.filter((r) => r.runId !== run.runId));
              return;
            }
            const data = result.data;
            const responseStatus = result.status;
            const responseOk = result.ok;
            const ms = Date.now() - started;

            if (responseStatus === 409) {
              trace("agent-run", "info", `${run.employeeName} already claimed or not ready`, {
                runId: run.runId,
                code: data.code,
              });
              processingRunIdsRef.current.delete(run.runId);
              setActiveRuns((prev) => prev.filter((r) => r.runId !== run.runId));
              return;
            }

            if (!responseOk || !data.ok) {
              trace("agent-run", "error", `${run.employeeName} process failed (${ms}ms)`, {
                status: responseStatus,
                runId: run.runId,
                response: data,
              });
              failedRunIdsRef.current.add(run.runId);
              processingRunIdsRef.current.delete(run.runId);
              throw new Error(data.error ?? data.debug?.hint ?? "AI response failed");
            }

            trace("agent-run", "success", `${run.employeeName} replied (${ms}ms)`, {
              runId: run.runId,
              responseReason: data.responseReason,
              agentRunId: run.runId,
              usageId: data.metrics?.usageId,
              aiMode: data.aiMode,
              provider: data.metrics?.provider,
              model: data.metrics?.model,
              modelMode: data.metrics?.modelMode,
              inputTokens: data.metrics?.inputTokens,
              outputTokens: data.metrics?.outputTokens,
              cachedTokens: data.metrics?.cachedTokens,
              estimatedCostUsd: data.metrics?.estimatedCostUsd,
              latencyMs: data.metrics?.durationMs ?? ms,
              fallbackUsed: data.metrics?.fallbackUsed,
              fallbackTier: data.metrics?.fallbackTier,
              aiMessageId: data.aiMessage?.id,
              replyPreview: data.aiMessage?.content?.slice(0, 120),
              searchMeta: data.searchMeta ?? data.metrics?.searchMeta,
              dmSteward: data.dmSteward,
              artifacts: data.aiMessage?.artifacts?.map((a: { type: string; label: string }) => ({
                type: a.type,
                label: a.label,
              })),
            });

            const intelligenceTrace = data.intelligenceTrace as ConversationDebugTrace | undefined;
            if (intelligenceTrace) {
              trace("intelligence", "info", `${run.employeeName} intelligence pipeline (${intelligenceTrace.roomKind})`, {
                runId: run.runId,
                roomKind: intelligenceTrace.roomKind,
                workMode: intelligenceTrace.workMode,
                researchLevel: intelligenceTrace.researchLevel,
                aiMode: intelligenceTrace.aiMode,
                intelligence: intelligenceTrace.intelligence,
                dmSteward: intelligenceTrace.dmSteward,
                gatewaySearch: intelligenceTrace.gatewaySearch,
                timeline: intelligenceTrace.timeline,
              });
            }

            // Minimum human-paced hold before the reply pops in — the "typing"
            // dots (shown independently, via activeRuns phase) already covered
            // the wait, this just avoids an instant, jarring appearance.
            const holdMs = minimumReplyHoldMs(undefined, data.aiMode as string | undefined);
            const elapsed = Date.now() - started;
            if (holdMs > elapsed) {
              await new Promise((resolve) => setTimeout(resolve, holdMs - elapsed));
            }

            if (data.researchRun) {
              setBrowserResearchRuns((current) =>
                upsertBrowserResearchRun(current, data.researchRun as BrowserResearchRun),
              );
            }

            if (data.aiMessage?.content) {
              actions.addMessage(room.id, {
                id: data.aiMessage.id,
                topicId: topic.id,
                senderType: "ai",
                senderId: data.aiMessage.senderId,
                senderName: data.aiMessage.senderName,
                content: data.aiMessage.content,
                artifacts: data.aiMessage.artifacts,
                agentRunId: run.runId,
                responseReason: data.responseReason ?? data.reason,
              });
              if (triggerId) {
                actions.updateMessage(room.id, triggerId, {
                  pending: false,
                  deliveryStatus: "delivered",
                  deliveredAt: new Date().toISOString(),
                });
              }
              notifyTopicSummaryUpdated(topic.id);
            } else if (triggerId) {
              actions.updateMessage(room.id, triggerId, {
                pending: false,
                deliveryStatus: "delivered",
                deliveredAt: new Date().toISOString(),
              });
            }

            if (!isDm) {
              orchestrationUi.markEmployeeCompleted(run.employeeId);
            }
            void actions.refreshTopics(room.id);
            if (!isDm) {
              void actions.refreshWorkLogForTopic(topic.id);
            }

            if (!isDm && Array.isArray(data.activatedRuns) && data.activatedRuns.length) {
              for (const activated of data.activatedRuns as QueuedRunClient[]) {
                orchestrationUi.updateEmployeePhase(
                  activated.employeeId,
                  "waiting",
                  `Reviewing ${run.employeeName}'s response…`,
                  run.employeeName,
                  activated.runId,
                );
              }
              setActiveRuns((prev) =>
                prev
                  .filter((r) => !r.runId.startsWith("waiting_"))
                  .map((r) =>
                    r.runId === run.runId ? { ...r, phase: "done", error: undefined } : r,
                  ),
              );
              await processQueuedRuns(data.activatedRuns as QueuedRunClient[]);
            } else if (Array.isArray(data.followUpRuns) && data.followUpRuns.length) {
              void processQueuedRuns(data.followUpRuns as QueuedRunClient[]);
            }

            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "done", error: undefined } : r,
              ),
            );
            processingRunIdsRef.current.delete(run.runId);
          } catch (err) {
            processAbortByRunRef.current.delete(run.runId);
            processingRunIdsRef.current.delete(run.runId);
            const aborted =
              (err instanceof Error &&
                (err.name === "AbortError" || /abort|paused/i.test(err.message))) ||
              abortController.signal.aborted;
            if (aborted) {
              actions.removeLocalMessage(room.id, `stream-${run.runId}`);
              setActiveRuns((prev) => prev.filter((r) => r.runId !== run.runId));
              return;
            }
            const message = err instanceof Error ? err.message : "AI response failed";
            console.error("[AdeHQ process run]", err);
            failedRunIdsRef.current.add(run.runId);
            trace("agent-run", "error", `${run.employeeName} couldn't respond`, {
              runId: run.runId,
              error: message,
            });
            if (!isDm) {
              orchestrationUi.updateEmployeePhase(run.employeeId, "failed", message, undefined, run.runId);
            }
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "failed", error: message } : r,
              ),
            );
          }
      };

      for (const run of queuedRuns) {
        await processOneRun(run);
      }

      setTimeout(() => {
        setActiveRuns((prev) =>
          prev.filter((r) => r.phase !== "done" && r.phase !== "waiting_on"),
        );
        if (!isDm) {
          orchestrationUi.markSessionCompleted();
        }
        void actions.refreshWorkLogForTopic(topic.id);
        notifyTopicSummaryUpdated(topic.id);
      }, 4000);

      void actions.refreshTopics(room.id);
    },
    [
      actions,
      markMessageSeenByEmployee,
      isDm,
      orchestrationUi,
      room.id,
      room.status,
      state.workspace.id,
      topic,
      trace,
    ],
  );

  processQueuedRunsRef.current = processQueuedRuns;

  useEffect(() => {
    if (!topic || backend !== "supabase") return;
    if (topic.status === "archived" || room.status === "archived") return;
    let cancelled = false;

    const recoverRuns = async () => {
      try {
        const headers = await withDebugHeaders();
        const res = await fetch(
          `/api/rooms/${room.id}/topics/${topic.id}/agent-runs?status=queued,waiting,running&since=10m`,
          { headers },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.collaborationPlan && !cancelled) {
          setCollaborationPlan(data.collaborationPlan);
        }
        const queued = (data.runs ?? []).filter(
          (r: { runId: string; status: string; stale?: boolean; processable?: boolean }) =>
            r.status === "queued" &&
            !r.stale &&
            !failedRunIdsRef.current.has(r.runId) &&
            !processingRunIdsRef.current.has(r.runId),
        );
        const waiting = (data.collaborationPlan?.pendingParticipants ?? []).map(
          (p: {
            employeeId: string;
            employeeName: string;
            waitingOnEmployeeName?: string;
            role?: string;
          }) => ({
            runId: `waiting_${p.employeeId}`,
            employeeId: p.employeeId,
            employeeName: p.employeeName,
            phase: "waiting_on" as const,
            waitingOnEmployeeName: p.waitingOnEmployeeName,
            collaborationRole: p.role,
          }),
        );
        if ((queued.length || waiting.length) && !cancelled) {
          trace("agent-run", "info", `Recovering ${queued.length} queued run(s)`, {
            topicId: topic.id,
          });
          void processQueuedRuns(queued, waiting);
        }
      } catch {
        // non-blocking
      }
    };

    void recoverRuns();
    return () => {
      cancelled = true;
    };
  }, [topic?.id, topic?.status, room.id, room.status, backend, processQueuedRuns, trace]);

  const retryRun = (run: ActiveRun) => {
    failedRunIdsRef.current.delete(run.runId);
    trace("agent-run", "info", `Retrying ${run.employeeName}`, { runId: run.runId });
    void processQueuedRuns([
      { runId: run.runId, employeeId: run.employeeId, employeeName: run.employeeName },
    ]);
  };

  useEffect(() => {
    orchestrationUi.registerRetryHandler((runId, employeeId, employeeName) => {
      retryRun({ runId, employeeId, employeeName, phase: "failed" });
    });
  }, [orchestrationUi, processQueuedRuns]);

  const sendViaServer = async (
    text: string,
    clientMessageId?: string,
    mentionsJson?: import("@/lib/types").MentionRef[],
    attachmentFileIds?: string[],
    contextFileIds?: string[],
    options?: {
      skipOrchestration?: boolean;
      throwOnError?: boolean;
      preferTavily?: boolean;
      preferAgentMode?: boolean;
      workMode?: WorkMode;
    },
  ) => {
    if (!topic || topic.status === "archived" || room.status === "archived") return;

    const trimmed = text.trim();
    if (!trimmed && !(attachmentFileIds?.length)) return;

    const now = Date.now();
    const fingerprint = `${trimmed}::${attachmentFileIds?.join(",") ?? ""}`;
    if (
      sendInFlightRef.current ||
      (lastSendFingerprintRef.current?.content === fingerprint &&
        now - lastSendFingerprintRef.current.at < 2500)
    ) {
      return;
    }

    sendInFlightRef.current = true;
    lastSendFingerprintRef.current = { content: fingerprint, at: now };

    setFailedSend(null);
    setSendError(null);
    const messageId = clientMessageId ?? uid("msg");
    const mentions = extractMentions(
      text,
      roomEmployees.map((e) => ({ id: e.id, name: e.name })),
    );

    actions.addLocalMessage(room.id, {
      id: messageId,
      topicId: topic.id,
      senderType: "human",
      senderId: state.user?.id ?? "unknown",
      senderName: state.user?.name ?? "You",
      content: text,
      mentions,
      artifacts: options?.workMode
        ? [
            {
              type: "work_mode",
              id: `work-mode-${messageId}`,
              label: options.workMode,
              meta: { workMode: options.workMode },
            },
          ]
        : undefined,
      pending: true,
      deliveryStatus: "sending",
    });
    triggerMessageIdRef.current = messageId;

    try {
      const headers = await withDebugHeaders();
      const body = {
        content: text,
        topicId: topic.id,
        clientMessageId: messageId,
        mentionsJson,
        attachmentFileIds,
        contextFileIds,
        ...(options?.skipOrchestration ? { skipAiOrchestration: true } : {}),
        ...(options?.preferTavily ? { preferTavily: true } : {}),
        ...(options?.preferAgentMode ? { preferAgentMode: true } : {}),
        ...(options?.workMode ? { workMode: options.workMode } : {}),
      };

      trace("message", "info", `POST /api/rooms/${room.id}/messages`, body);

      const sendStarted = Date.now();
      const response = await fetch(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const payload = await parseJsonResponse<{
        queuedRuns?: QueuedRunClient[];
        blockedRuns?: Array<{ employeeName?: string; reason: string }>;
        cancelledResearchRuns?: BrowserResearchRun[];
        deferred?: boolean;
        workStop?: {
          detected: boolean;
          target: string;
          reason: string;
          cancelledBrowserResearchCount: number;
          cancelledAgentRunCount: number;
        };
        code?: string;
        hint?: string;
        orchestratorDebug?: Record<string, unknown> | null;
        orchestrationId?: string | null;
        orchestrationPlan?: OrchestrationPlan | null;
        collaborationPlan?: ConversationPlan | null;
        stewardProgress?: StewardProgressSnapshot | null;
        stewardBrainRunId?: string | null;
        topicSuggestions?: TopicSuggestionPayload[];
        smartAssistSuggestions?: SuggestedConversationAction[];
        error?: string;
        humanMessage?: RoomMessage;
        skippedOrchestration?: boolean;
      }>(response);

      trace(
        "message",
        response.ok || response.status === 207 ? "success" : "error",
        `Message API ${response.status} (${Date.now() - sendStarted}ms)`,
        {
          workMode: options?.workMode,
          roomKind: isDm ? "dm" : "room",
          deferred: payload.deferred,
          queuedRuns: payload.queuedRuns,
          blockedRuns: payload.blockedRuns,
          code: payload.code,
          hint: payload.hint,
          orchestratorDebug: payload.orchestratorDebug,
          error: payload.error,
          debug: (payload as { debug?: unknown }).debug,
          skippedOrchestration: payload.skippedOrchestration,
        },
      );

      if (!response.ok && response.status !== 207) {
        if (payload.code === "ai_runtime_failed_but_message_saved" || payload.humanMessage) {
          actions.updateMessage(room.id, messageId, {
            pending: false,
            deliveryStatus: "delivered",
            deliveredAt: payload.humanMessage?.createdAt ?? new Date().toISOString(),
          });
          if (payload.humanMessage) {
            actions.updateMessage(room.id, messageId, payload.humanMessage);
          }
          return;
        }
        actions.updateMessage(room.id, messageId, {
          pending: false,
          failed: true,
          deliveryStatus: "failed",
        });
        const msg = payload?.error ?? "Unable to send message.";
        throw new Error(msg);
      }

      if (options?.skipOrchestration || payload.skippedOrchestration) {
        const deliveredAt =
          payload.humanMessage?.createdAt ?? new Date().toISOString();
        actions.updateMessage(room.id, messageId, {
          pending: false,
          deliveryStatus: "delivered",
          deliveredAt,
        });
        if (payload.humanMessage && payload.humanMessage.id !== messageId) {
          actions.removeLocalMessage(room.id, messageId);
          actions.addMessage(room.id, {
            ...payload.humanMessage,
            topicId: topic.id,
          });
        } else if (payload.humanMessage) {
          actions.updateMessage(room.id, messageId, payload.humanMessage);
        }
        return;
      }

      const deliveredAt =
        payload.humanMessage?.createdAt ?? new Date().toISOString();

      actions.updateMessage(room.id, messageId, {
        pending: false,
        deliveryStatus: "delivered",
        deliveredAt,
      });

      if (payload.cancelledResearchRuns?.length) {
        setBrowserResearchRuns((current) => {
          let next = current;
          for (const run of payload.cancelledResearchRuns ?? []) {
            next = upsertBrowserResearchRun(next, run);
          }
          return next;
        });
      }

      if (payload.humanMessage && payload.humanMessage.id !== messageId) {
        actions.removeLocalMessage(room.id, messageId);
        actions.addMessage(room.id, {
          ...payload.humanMessage,
          topicId: topic.id,
        });
      } else if (payload.humanMessage) {
        actions.updateMessage(room.id, messageId, {
          ...payload.humanMessage,
          pending: false,
          deliveryStatus: "delivered",
          deliveredAt: payload.humanMessage.createdAt ?? deliveredAt,
        });
      }

      const employeeNames = new Map(roomEmployees.map((e) => [e.id, e.name]));
      if (!isDm) {
        orchestrationUi.setOrchestrationFromSend({
          orchestrationId: payload.orchestrationId ?? null,
          triggerMessageId: payload.humanMessage?.id ?? messageId,
          orchestrationPlan: payload.orchestrationPlan ?? null,
          collaborationPlan: payload.collaborationPlan ?? null,
          employeeNames,
        });
      }

      if (payload.collaborationPlan) {
        setCollaborationPlan(payload.collaborationPlan);
      }
      if (payload.stewardProgress) {
        setStewardProgress(payload.stewardProgress);
      }
      if (payload.orchestratorDebug) {
        setOrchestratorDebug(payload.orchestratorDebug);
      }
      if (payload.topicSuggestions?.length) {
        setTopicSuggestions((prev) => {
          const incoming = (payload.topicSuggestions as TopicSuggestionPayload[]).filter(
            (s) => !s.topic_id || s.topic_id === topic?.id,
          );
          const ids = new Set(prev.map((s) => s.id));
          return [...prev, ...incoming.filter((s) => !ids.has(s.id))];
        });
      }
      if (payload.smartAssistSuggestions?.length) {
        setSmartAssistSuggestions(payload.smartAssistSuggestions);
      } else if (payload.hint) {
        setSendError(null);
      }

      const waitingRuns: ActiveRun[] = (payload.collaborationPlan?.pendingParticipants ?? []).map(
        (p: {
          employeeId: string;
          employeeName: string;
          waitingOnEmployeeName?: string;
          role?: string;
        }) => ({
          runId: `waiting_${p.employeeId}`,
          employeeId: p.employeeId,
          employeeName: p.employeeName,
          phase: "waiting_on" as const,
          waitingOnEmployeeName: p.waitingOnEmployeeName,
          collaborationRole: p.role,
        }),
      );

      if (payload.deferred) {
        // Wait for room-wide quiet, then flush one steward turn for the burst.
        scheduleBurstFlush();
      } else if (payload.queuedRuns?.length || waitingRuns.length) {
        void processQueuedRuns(payload.queuedRuns ?? [], waitingRuns);
      } else if (payload.blockedRuns?.length) {
        const reason = payload.blockedRuns
          .map((b: { employeeName?: string; reason: string }) => b.reason)
          .join("; ");
        setSendError(`AI could not respond: ${reason}`);
        trace("message", "warn", "AI runs blocked at queue", payload.blockedRuns);
      }

      // Background server processing may complete shortly — refresh to pick up AI replies.
      if (payload.queuedRuns?.length) {
        setTimeout(() => void actions.refreshTopics(room.id), 1800);
      }
      void actions.refreshWorkLogForTopic(topic.id);

      void actions.refreshTopics(room.id);
    } catch (error) {
      actions.removeLocalMessage(room.id, messageId);
      setFailedSend({ clientMessageId: messageId, content: text });
      const msg = error instanceof Error ? error.message : "Unable to send message.";
      setSendError(msg);
      trace("message", "error", "Send failed", { error: msg });
      if (options?.throwOnError) throw error;
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const sendViaDemo = async (text: string) => {
    if (!topic || topic.status === "archived" || room.status === "archived") return;
    const candidates = roomEmployees.map((e) => ({ id: e.id, name: e.name }));
    const mentions = extractMentions(text, candidates);

    actions.addMessage(room.id, {
      topicId: topic.id,
      senderType: "human",
      senderId: state.user?.id ?? "demo-user",
      senderName: state.user?.name ?? "You",
      content: text,
      mentions,
    });

    const responders = mentions.length > 0 ? mentions : [];
    if (responders.length === 0) return;

    for (const employeeId of responders) {
      await respond(room.id, employeeId, text);
    }
  };

  const handleCreateTopicFromSuggestion = async (suggestion: TopicSuggestionPayload) => {
    if (!topic || !suggestion.title) return;
    // Stop showing source-topic typing UI immediately — server cancels those runs.
    setActiveRuns([]);
    const triggerMessageId =
      suggestion.metadata?.triggerMessageId ??
      suggestion.message_ids?.[suggestion.message_ids.length - 1];
    const headers = await authHeaders();
    const res = await fetch(`/api/rooms/${room.id}/topics`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: suggestion.title,
        description: suggestion.metadata?.description?.trim() || "",
        priority: "normal",
        aiEmployeeIds: roomEmployees.map((employee) => employee.id),
        contextImport: {
          suggestionId: suggestion.id,
          sourceRoomId: room.id,
          sourceTopicId: topic.id,
          sourceDmId: isDm ? room.id : undefined,
          triggerMessageId,
          sourceMessageIds: suggestion.message_ids ?? [],
          suggestedTitle: suggestion.title,
          sourceScope:
            suggestion.metadata?.sourceScope ??
            (isGeneralTopic(topic) ? "room" : "topic"),
          migrateMessages: suggestion.metadata?.migrateMessages !== false,
        },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error ?? "Could not create topic.");
    if (payload.topic) actions.upsertTopic(payload.topic);
    if (payload.contextImportWarning) {
      setContextImportWarning(String(payload.contextImportWarning));
    } else {
      setContextImportWarning(null);
    }
    const migratedIds =
      Array.isArray(payload.migratedMessageIds) && payload.migratedMessageIds.length
        ? (payload.migratedMessageIds as string[])
        : suggestion.message_ids ?? [];
    const migratedMessages = Array.isArray(payload.migratedMessages)
      ? (payload.migratedMessages as Array<Record<string, unknown>>)
      : [];
    if (payload.topic?.id && (migratedIds.length || migratedMessages.length)) {
      if (migratedMessages.length) {
        for (const message of migratedMessages) {
          const id = String(message.id);
          const existing = room.messages.find((m) => m.id === id);
          if (existing) {
            actions.updateLocalMessage(room.id, id, { topicId: payload.topic.id });
          } else {
            actions.addLocalMessage(room.id, {
              id,
              topicId: payload.topic.id,
              senderType: message.senderType as "human" | "ai" | "system",
              senderId: String(message.senderId ?? ""),
              senderName: String(message.senderName ?? "Unknown"),
              content: String(message.content ?? ""),
              mentions: Array.isArray(message.mentions) ? (message.mentions as string[]) : [],
              createdAt: String(message.createdAt ?? new Date().toISOString()),
            });
          }
        }
      } else {
        for (const messageId of migratedIds) {
          actions.updateLocalMessage(room.id, messageId, { topicId: payload.topic.id });
        }
      }
      // No imported-context card when chats were actually moved.
      setContextImports([]);
    }
    if (payload.systemMessage && payload.topic?.id) {
      actions.addLocalMessage(room.id, {
        id: String(payload.systemMessage.id),
        topicId: payload.topic.id,
        senderType: "system",
        senderId: "system",
        senderName: "AdeHQ",
        content: String(payload.systemMessage.content ?? ""),
        mentions: [],
        createdAt: String(payload.systemMessage.createdAt ?? new Date().toISOString()),
      });
    }
    if (payload.topic?.id) {
      await actions.refreshTopics(room.id);
      onSelectTopic?.(payload.topic.id);
      const continuedTrigger =
        (payload.continuedWork?.triggerMessageId as string | undefined) ??
        (typeof triggerMessageId === "string" ? triggerMessageId : undefined);
      if (continuedTrigger) {
        triggerMessageIdRef.current = continuedTrigger;
      }
      const queuedRuns = Array.isArray(payload.queuedRuns)
        ? (payload.queuedRuns as QueuedRunClient[])
        : [];
      // Let the topic switch commit before processing continued runs so reply
      // placeholders land on the new topic id.
      if (queuedRuns.length) {
        window.setTimeout(() => {
          void processQueuedRuns(queuedRuns);
        }, 0);
      }
    }
  };

  const handleAcceptTopicSuggestion = async (suggestionId: string) => {
    await acceptTopicSuggestionApi(suggestionId, state.workspace.id);
    setTopicSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  };

  const handleDismissTopicSuggestion = async (suggestionId: string) => {
    await dismissTopicSuggestionApi(suggestionId, state.workspace.id);
    setTopicSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  };

  const uploadFiles = async (files: File[]): Promise<ComposerUploadedFile[]> => {
    if (!topic) return [];
    const auth = (await authHeaders()) as Record<string, string>;
    const { "Content-Type": _contentType, ...headers } = auth;
    const results: ComposerUploadedFile[] = [];

    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      form.set("workspaceId", state.workspace.id);
      form.set("roomId", room.id);
      form.set("topicId", topic.id);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        headers,
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "File upload failed.");
      }
      results.push(payload.file as ComposerUploadedFile);
    }

    void actions.refreshWorkLogForTopic(topic.id);
    window.dispatchEvent(new CustomEvent("adehq:topic-files-changed", { detail: { topicId: topic.id } }));
    return results;
  };

  const handleSend = async (
    text: string,
    mentionsJson?: import("@/lib/types").MentionRef[],
    attachmentFileIds?: string[],
    contextFileIds?: string[],
    workMode?: WorkMode,
  ) => {
    if (!topic || topic.status === "archived" || room.status === "archived") return;

    if (isMayaHiringMode && mayaHiring) {
      await mayaHiring.sendUserMessage(text);
      return;
    }

    if (useServerApi) {
      await sendViaServer(text, undefined, mentionsJson, attachmentFileIds, contextFileIds, {
        preferTavily: browserResearchEnabled && browserResearchAvailable,
        preferAgentMode:
          agentModeEnabled &&
          browserResearchAvailable &&
          (browserResearchConfig?.liveReady ?? false),
        workMode,
      });
      if (isMayaGeneralChat && topic.id) {
        await mayaResponder.handleUserMessage(text);
      }
      return;
    }
    if (ENABLE_DEMO_MODE) {
      if (isMayaGeneralChat) {
        await mayaResponder.sendWithUserEcho(text);
        return;
      }
      await sendViaDemo(text);
    }
  };

  const retryFailed = async () => {
    if (!failedSend) return;
    const { clientMessageId, content } = failedSend;
    actions.removeLocalMessage(room.id, clientMessageId);
    setFailedSend(null);
    await sendViaServer(content, clientMessageId);
  };

  if (!topic) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={MessagesSquare}
          eyebrow={isDm ? "Status · opening DM" : "Status · no topic selected"}
          title={isDm ? "Opening chat…" : "Choose or create a topic"}
          description={
            isDm
              ? "Setting up your direct message thread. This usually takes a moment."
              : "Topics keep AI context focused. Select a topic from the list or create a new one to start messaging."
          }
        />
      </div>
    );
  }

  const isMainChat = isGeneralTopic(topic);
  const displayTitle = isMainChat ? mainChatLabel(isDm) : topic.title;
  const openTopicTasks = state.tasks.filter(
    (t) => t.topicId === topic.id && t.status !== "done",
  ).length;

  const isTopicArchived = topic.status === "archived";
  const isRoomArchived = room.status === "archived";
  const chatDisabled = isTopicArchived || isRoomArchived;

  const placeholder = chatDisabled
    ? isRoomArchived
      ? "This room is archived — restore it from the Rooms page to send messages"
      : "This topic is archived — restore it to send messages"
    : agentModeEnabled && browserResearchAvailable
      ? `Agent mode — ${researchEmployee?.name ?? "this employee"} will browse live…`
      : browserResearchEnabled && browserResearchAvailable
        ? `Fast search with ${researchEmployee?.name ?? "this employee"}…`
      : isMayaDmEmployee && isMainChat
        ? "Ask Maya about hiring, your workforce, or AdeHQ…"
        : isMayaHiringMode
          ? "What job do you need done? e.g. sales outreach, market research…"
          : isDm && dmEmployee
            ? `Message ${dmEmployee.name}… ask for a draft, summary, or artifact`
            : isMainChat
              ? `Message ${mainChatLabel(isDm)}…`
              : `Ask the ${topic.title} topic… mention an employee or start with /`;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex min-h-[58px] shrink-0 items-center gap-2.5 border-b border-border bg-canvas px-4 py-2.5">
        {isDm && dmEmployee ? (
          <>
            <EmployeeAvatar
              employee={dmEmployee}
              size="sm"
              showStatus={false}
              className="!h-[34px] !w-[34px] !rounded-[10px] !text-xs"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold text-ink">{dmEmployee.name}</span>
                <span className="rounded-[5px] bg-accent-soft px-[5px] py-0.5 text-[9.5px] font-bold text-accent">
                  AI
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
                {dmEmployee && isMayaEmployee(dmEmployee) ? (
                  <>
                    <EmployeeStatusDot status={effectiveEmployeeStatus(dmEmployee)} />
                    Online · {dmEmployee.role}
                  </>
                ) : dmEmployee ? (
                  <>
                    <EmployeeStatusDot status={dmEmployee.status} />
                    {STATUS_META[dmEmployee.status].label} · {formatEmployeeIntelligenceSummary(dmEmployee)}
                  </>
                ) : null}
              </div>
              {isMayaDmEmployee && isMainChat && (
                <p className="truncate text-[11px] text-ink-3">{MAYA_EMPLOYEE_SUBTITLE}</p>
              )}
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <span className="truncate">{displayTitle}</span>
                  <span className="truncate text-[11px] font-medium text-ink-3">in {room.name}</span>
                </div>
                <p className="text-[11.5px] text-ink-2">
                  {openTopicTasks} open task{openTopicTasks === 1 ? "" : "s"} ·{" "}
                  {topicAiEmployees.length} employee{topicAiEmployees.length === 1 ? "" : "s"}
                </p>
              </div>
              {topicAiEmployees.length > 0 && (
                <button
                  type="button"
                  onClick={requestOpenPeopleTab}
                  className="ml-auto rounded-lg p-0.5 hover:bg-muted"
                  title="View participants"
                >
                  <ParticipantAvatarStack employees={topicAiEmployees} humans={[]} max={3} size="xs" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {onSummarize && (
            <button
              type="button"
              onClick={() => onSummarize({ force: true })}
              disabled={summarizing || chatDisabled}
              className="hidden items-center gap-1.5 rounded-[10px] border border-border bg-surface px-[11px] py-[7px] text-xs font-medium text-ink-2 transition-colors hover:bg-muted disabled:opacity-50 sm:inline-flex"
            >
              {summarizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M3 7h18M3 12h18M3 17h12" />
                </svg>
              )}
              Summarize
            </button>
          )}
          {!isDm && (
            <button
              type="button"
              onClick={onAddEmployee ?? (() => router.push("/workforce"))}
              className="hidden items-center gap-1.5 rounded-[10px] border border-border bg-surface px-[11px] py-[7px] text-xs font-medium text-ink-2 transition-colors hover:bg-muted sm:inline-flex"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
              Add employee
            </button>
          )}
          <WorkforceCallButton roomId={room.id} iconOnly />
          <button
            type="button"
            className="hidden h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-border bg-surface text-ink-2 transition-colors hover:bg-muted xl:flex"
            aria-label="Inspector"
          >
            <PanelRight className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      {isMayaHiringMode && mayaHiring?.session.error && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-xs text-rose-800">
          {mayaHiring.session.error}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="h-full overflow-y-auto px-7 pb-4 pt-4"
      >
        {isMayaHiringMode && !mayaHiring ? (
          <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting hiring session…
          </div>
        ) : (
        <>
        {hasOlder && (
          <div className={cn("mx-auto mb-3", ROOM_CHAT_WIDE_MAX_WIDTH, "text-center")}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessageLimit((n) => n + MESSAGE_PAGE)}
            >
              Load older messages
            </Button>
          </div>
        )}
        {topicMessages.length === 0 && contextImports.length === 0 ? (
          isDm && dmEmployee && isMayaEmployee(dmEmployee) && isMainChat && !chatDisabled && !isMayaHiringMode ? (
            <MayaDmEmptyState
              firstName={state.user?.name?.split(" ")[0] ?? "there"}
              onSendMessage={(text) => {
                void handleSend(text);
              }}
            />
          ) : isDm && dmEmployee && isMayaEmployee(dmEmployee) && !isMainChat && !chatDisabled ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
              <h3 className="text-base font-semibold text-ink">This topic is for {displayTitle}</h3>
              <p className="text-sm leading-relaxed text-ink-2">
                Ask Maya a question or continue the workflow here.
              </p>
            </div>
          ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <EmptyState
              icon={MessagesSquare}
              eyebrow={
                isDm && dmEmployee
                  ? `Status · desk open for ${dmEmployee.name}`
                  : "Status · empty workstream"
              }
              title={isDm && dmEmployee ? `Message ${dmEmployee.name}` : `Start ${displayTitle}`}
              description={
                isDm && dmEmployee
                  ? `Ask ${dmEmployee.name} to draft, research, summarize, or turn a file into an artifact.`
                  : "Start this workstream by asking an employee for help, uploading a file, or creating a task."
              }
            />
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => router.push("/settings")}>
                <UserPlus className="h-4 w-4" /> Invite humans
              </Button>
              <Button variant="secondary" size="sm" onClick={() => router.push("/workforce")}>
                <Bot className="h-4 w-4" /> Add AI employee
              </Button>
              <Button variant="secondary" size="sm" onClick={() => router.push("/tasks")}>
                <ListChecks className="h-4 w-4" /> Create first task
              </Button>
            </div>
          </div>
          )
        ) : (
          <div className={cn("mx-auto", ROOM_CHAT_MAX_WIDTH)}>
            {/* Receipt card only when chats were NOT moved (legacy / failed migrate). */}
            {topicMessages.length === 0
              ? contextImports.map((contextImport) => (
                  <TopicContextImportCard
                    key={contextImport.id}
                    contextImport={contextImport}
                    sourceLabel={
                      contextImport.sourceTopicId && contextImport.sourceTopicId !== topic?.id
                        ? "previous topic"
                        : "previous conversation"
                    }
                    onViewSource={
                      contextImport.sourceTopicId
                        ? () => {
                            if (contextImport.sourceTopicId) {
                              onSelectTopic?.(contextImport.sourceTopicId);
                            }
                          }
                        : undefined
                    }
                  />
                ))
              : null}
            {topicMessages.length === 0 && contextImports.length > 0 ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-6 text-center">
                <h3 className="text-base font-semibold text-ink">Continue this workstream</h3>
                <p className="text-sm leading-relaxed text-ink-2">
                  Context from the previous conversation is above. Send a message to continue.
                </p>
              </div>
            ) : null}
            {stewardProgress ? <StewardProgressCard progress={stewardProgress} /> : null}
            {chatTimelineItems.map((item) =>
              item.kind === "message" ? (
                <div key={item.row.message.id}>
                  {item.row.showDaySeparator && (
                    <div className="mb-[18px] mt-1.5 text-center">
                      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-ink-3">
                        {daySeparatorLabel(item.row.message.createdAt)}
                      </span>
                    </div>
                  )}
                  <RoomMessageItem
                    message={item.row.message}
                    isDm={isDm}
                    grouped={item.row.grouped}
                    messageActions={messageActions}
                    actionsDisabled={chatDisabled}
                  />
                </div>
              ) : state.workspace?.id ? (
                <div key={item.run.id} className={cn("mx-auto mb-3", ROOM_CHAT_WIDE_MAX_WIDTH)}>
                  <BrowserResearchMessageCard
                    run={item.run}
                    workspaceId={state.workspace.id}
                    topicId={topic.id}
                    employeeName={researchEmployee?.name}
                    pending={
                      item.run.id === "pending" ||
                      item.run.status === "running" ||
                      item.run.status === "planning"
                    }
                  />
                </div>
              ) : null,
            )}
            {activeRuns
              .filter((run) => ["reading", "thinking", "typing", "queued"].includes(run.phase))
              .map((run) => {
                const employee = roomEmployees.find((e) => e.id === run.employeeId);
                return (
                  <div
                    key={run.runId}
                    className="chat-message-enter group/msg relative flex gap-3 rounded-[10px] px-0 py-1"
                  >
                    <div className="shrink-0">
                      {employee ? (
                        <EmployeeAvatar employee={employee} size="md" showStatus={false} />
                      ) : (
                        <span className="inline-block h-9 w-9 rounded-full bg-muted" />
                      )}
                    </div>
                    <div className="flex w-fit items-center gap-2 rounded-[13px] border border-border bg-surface px-3.5 py-2.5">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                );
              })}
            {isMayaGeneralChat && mayaResponder.phase !== "idle" && dmEmployee && (
              <div className="chat-message-enter group/msg relative flex gap-3 rounded-[10px] px-0 py-1">
                <div className="shrink-0">
                  <EmployeeAvatar employee={dmEmployee} size="md" showStatus={false} />
                </div>
                <div className="flex w-fit items-center gap-1.5 rounded-[13px] border border-border bg-surface px-3.5 py-2.5">
                  <span className="text-[11px] text-ink-3">
                    {mayaResponder.phase === "reading"
                      ? "Reading…"
                      : mayaResponder.phase === "thinking"
                        ? "Thinking…"
                        : "Typing…"}
                  </span>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            {isMayaGeneralChat && mayaResponder.pendingProposal && (
              <div className={cn("mx-auto", ROOM_CHAT_WIDE_MAX_WIDTH)}>
                <MayaHiringTopicSuggestionCard
                  roleTitle={mayaResponder.pendingProposal.roleTitle}
                  activeAction={mayaResponder.activeProposalAction}
                  disabled={mayaResponder.busy}
                  onAction={(action) => void mayaResponder.handleProposalAction(action)}
                  className="max-w-lg"
                />
              </div>
            )}
            {isMayaGeneralChat && mayaResponder.employeePickerRoster.length > 0 && (
              <div className={cn("mx-auto", ROOM_CHAT_WIDE_MAX_WIDTH)}>
                <MayaEmployeePickerCard
                  employees={mayaResponder.employeePickerRoster}
                  disabled={mayaResponder.busy}
                  onSelect={(id) => void mayaResponder.handleEmployeePick(id)}
                />
              </div>
            )}
            {isMayaHiringMode && mayaHiring && (mayaHiring.session.busy || mayaHiring.generatingCandidates) && dmEmployee && (
              <div className="chat-message-enter group/msg relative flex gap-3 rounded-[10px] px-0 py-1">
                <div className="shrink-0">
                  <EmployeeAvatar employee={dmEmployee} size="md" showStatus={false} />
                </div>
                <div className="flex w-fit items-center gap-1.5 rounded-[13px] border border-border bg-surface px-3.5 py-2.5">
                  <span className="text-[11px] text-ink-3">
                    {mayaHiring.generatingCandidates
                      ? "Preparing candidates…"
                      : mayaHiring.mayaState === "acknowledging"
                        ? "Reviewing the role…"
                        : mayaHiring.mayaState === "updating_brief"
                          ? "Updating the brief…"
                          : mayaHiring.mayaState === "thinking"
                            ? "Thinking…"
                            : "Typing…"}
                  </span>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            {isMayaHiringMode && <MayaHiringInlineCards />}
            <div ref={bottomRef} />
          </div>
        )}
        </>
        )}
      </div>
      {hasNewMessagesBelow && (
        <button
          type="button"
          onClick={scrollToBottomNow}
          className="animate-in fade-in slide-in-from-bottom-2 absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-2 shadow-md transition-colors duration-200 hover:bg-muted"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          New messages
        </button>
      )}
      </div>

      {failedSend && (
        <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 sm:px-6">
          <div className={cn("mx-auto flex items-center gap-3 text-sm text-rose-800", ROOM_CHAT_WIDE_MAX_WIDTH)}>
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Message failed to send{sendError ? `: ${sendError}` : "."}
            </span>
            <Button size="sm" variant="secondary" onClick={retryFailed}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </div>
      )}

      <div className="shrink-0 px-7 pb-4 pt-1.5">
        <div className={cn("mx-auto", ROOM_CHAT_MAX_WIDTH)}>
          {contextImportWarning ? (
            <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {contextImportWarning}
            </div>
          ) : null}
          {topicSuggestions
            .filter((suggestion) => !suggestion.topic_id || suggestion.topic_id === topic?.id)
            .map((suggestion) => (
            <TopicSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onCreateTopic={handleCreateTopicFromSuggestion}
              onAccept={handleAcceptTopicSuggestion}
              onDismiss={handleDismissTopicSuggestion}
            />
          ))}
          {smartAssistSuggestions.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {smartAssistSuggestions.map((action) =>
                action.type === "invite_employee" ? (
                  <button
                    key={action.employeeId}
                    type="button"
                    className="rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-xs font-medium text-accent-800 hover:bg-accent-100"
                    onClick={() => {
                      const name = action.employeeName ?? "employee";
                      void handleSend(`@${name} ${action.reason}`);
                    }}
                  >
                    Ask {action.employeeName ?? "employee"} to help
                  </button>
                ) : null,
              )}
            </div>
          )}
          {chatDisabled && (
            <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {isRoomArchived
                ? "This room is archived. Messaging and AI responses are paused until you restore it."
                : "This topic is archived. Messaging and AI responses are paused until you restore it."}
            </div>
          )}
          {sendError && !failedSend && (
            <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {sendError}
            </div>
          )}
          {typingLabel && (
            <p className="mb-1.5 px-1 text-[12.5px] text-ink-3">{typingLabel}</p>
          )}
          {isMayaHiringMode && <MayaHiringSuggestionChips />}
          <ChatComposer
            employees={roomEmployees}
            mentionHumans={mentionHumans}
            onSend={handleSend}
            onTypingChange={useServerApi ? setLocalTyping : undefined}
            onUploadFiles={useServerApi ? uploadFiles : undefined}
            onAddEmployee={onAddEmployee}
            disabled={!topic || chatDisabled}
            placeholder={placeholder}
            draftText={draftText}
            onDraftConsumed={onDraftConsumed}
            onSlashCommand={onSlashCommand}
            contextFiles={contextFiles}
            artifactIntent={artifactIntent}
            onContextConsumed={onContextConsumed}
            browserResearchAvailable={browserResearchAvailable}
            browserResearchEnabled={browserResearchEnabled}
            onBrowserResearchEnabledChange={setBrowserResearchEnabled}
            agentModeEnabled={agentModeEnabled}
            onAgentModeEnabledChange={setAgentModeEnabled}
            browserResearchEffectiveProvider={browserResearchConfig?.effectiveProvider}
            browserResearchTavilyConfigured={browserResearchConfig?.tavilyConfigured ?? false}
            browserResearchLiveReady={browserResearchConfig?.liveReady ?? false}
            browserResearchBusy={browserResearchBusy}
            workspaceId={state.workspace?.id}
            roomId={room.id}
            topicId={topic?.id}
            voiceEnabled={process.env.NEXT_PUBLIC_ADEHQ_BRAIN_VOICE_V1 === "1"}
          />
          {!chatDisabled && (
          <p className="px-1.5 pt-1.5 text-[11px] text-ink-3">
            <span>
              <b className="font-mono text-ink-2">@</b> mention someone
            </span>
            <span className="mx-3.5">
              <b className="font-mono text-ink-2">/</b> run a command
            </span>
            <span className="float-right hidden sm:inline">Enter to send · Shift+Enter for newline</span>
          </p>
          )}
        </div>
      </div>
    </div>
  );
}
