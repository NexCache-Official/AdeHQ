"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectRoom, RoomTopic, type ConversationPlan } from "@/lib/types";
import { useOrchestrationUi } from "@/components/orchestration/OrchestrationUiContext";
import { fetchTopicOrchestrations } from "@/lib/orchestration/orchestration-client";
import { readDismissedOrchestrationIds } from "@/lib/orchestration/dismissed-orchestrations";
import { enrichHumanSeenBy } from "@/lib/message-read-receipts";
import { notifyTopicSummaryUpdated } from "@/lib/topic-summary/client";
import {
  TopicSuggestionCard,
  acceptTopicSuggestionApi,
  dismissTopicSuggestionApi,
  type TopicSuggestionPayload,
} from "./orchestration/TopicSuggestionCard";
import type { SuggestedConversationAction } from "@/lib/orchestration/types";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { useResponder } from "@/lib/ai/use-responder";
import { authHeaders } from "@/lib/api/auth-client";
import { isGeneralTopic, mainChatLabel } from "@/lib/topics";
import { RoomMessageItem } from "./RoomMessageItem";
import { ChatComposer, type SlashCommandResult } from "./ChatComposer";
import { EmptyState } from "./States";
import { Button } from "./ui";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { extractMentions, uid } from "@/lib/utils";
import { readDebugMode } from "@/lib/debug-trace";
import { useDebugTrace } from "./DebugProvider";
import {
  AlertCircle,
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
import { STATUS_META } from "@/lib/icons";
import { effectiveEmployeeStatus, isMayaEmployee } from "@/lib/maya-employee";
import { MayaDmEmptyState } from "@/components/maya/MayaDmEmptyState";

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

export function RoomChat({
  room,
  topic,
  draftText,
  onDraftConsumed,
  onSlashCommand,
  isDm = false,
  onSummarize,
  summarizing = false,
}: {
  room: ProjectRoom;
  topic?: RoomTopic;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
  isDm?: boolean;
  onSummarize?: () => void;
  summarizing?: boolean;
}) {
  const { state, actions, backend } = useStore();
  const { trace } = useDebugTrace();
  const respond = useResponder();
  const router = useRouter();
  const orchestrationUi = useOrchestrationUi();
  const triggerMessageIdRef = useRef<string | null>(null);
  const [failedSend, setFailedSend] = useState<PendingSend | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [collaborationPlan, setCollaborationPlan] = useState<ConversationPlan | null>(null);
  const [orchestratorDebug, setOrchestratorDebug] = useState<Record<string, unknown> | null>(null);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestionPayload[]>([]);
  const [smartAssistSuggestions, setSmartAssistSuggestions] = useState<SuggestedConversationAction[]>([]);
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allTopicMessages = topic
    ? room.messages.filter((m) => m.topicId === topic.id)
    : [];
  const topicMessages = allTopicMessages.slice(-messageLimit);
  const hasOlder = allTopicMessages.length > messageLimit;

  const topicMembersForTopic = useMemo(
    () => (topic ? state.topicMembers.filter((m) => m.topicId === topic.id) : []),
    [state.topicMembers, topic],
  );

  const displayMessages = useMemo(
    () =>
      topicMessages.map((message) => ({
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

  const roomEmployees = room.aiEmployees
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [topicMessages.length, activeRuns.length]);

  useEffect(() => {
    if (!topic || backend !== "supabase") return;
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
  }, [topic?.id, backend, roomEmployees.length]);

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

  const useServerApi = backend === "supabase";

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
        orchestrationUi.updateEmployeePhase(waiting.employeeId, "waiting", undefined);
        if (waiting.waitingOnEmployeeName) {
          orchestrationUi.updateEmployeePhase(
            waiting.employeeId,
            "waiting",
            `Waiting for ${waiting.waitingOnEmployeeName}`,
          );
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
          trace("agent-run", "info", `${run.employeeName} → reading context`, { runId: run.runId });
          if (triggerId) {
            markMessageSeenByEmployee(triggerId, run.employeeId, run.employeeName);
          }
          orchestrationUi.updateEmployeePhase(run.employeeId, "reading", undefined, undefined, run.runId);
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "reading" } : r,
            ),
          );

          orchestrationUi.updateEmployeePhase(run.employeeId, "replying", undefined, undefined, run.runId);
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "thinking" } : r,
            ),
          );

          const started = Date.now();
          try {
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "typing" } : r,
              ),
            );

            trace("agent-run", "info", `POST /api/agent-runs/${run.runId}/process`, {
              workspaceId: state.workspace.id,
            });

            const res = await fetch(`/api/agent-runs/${run.runId}/process`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                workspaceId: state.workspace.id,
                mode: "live",
              }),
            });

            const data = await res.json();
            const ms = Date.now() - started;

            if (res.status === 409) {
              trace("agent-run", "info", `${run.employeeName} already claimed or not ready`, {
                runId: run.runId,
                code: data.code,
              });
              setActiveRuns((prev) => prev.filter((r) => r.runId !== run.runId));
              return;
            }

            if (!res.ok || !data.ok) {
              trace("agent-run", "error", `${run.employeeName} process failed (${ms}ms)`, {
                status: res.status,
                runId: run.runId,
                response: data,
              });
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
              artifacts: data.aiMessage?.artifacts?.map((a: { type: string; label: string }) => ({
                type: a.type,
                label: a.label,
              })),
            });

            if (data.aiMessage) {
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
            }

            orchestrationUi.markEmployeeCompleted(run.employeeId);
            void actions.refreshTopics(room.id);
            void actions.refreshWorkLogForTopic(topic.id);
            notifyTopicSummaryUpdated(topic.id);

            if (Array.isArray(data.activatedRuns) && data.activatedRuns.length) {
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
          } catch (err) {
            const message = err instanceof Error ? err.message : "AI response failed";
            console.error("[AdeHQ process run]", err);
            trace("agent-run", "error", `${run.employeeName} couldn't respond`, {
              runId: run.runId,
              error: message,
            });
            orchestrationUi.updateEmployeePhase(run.employeeId, "failed", message, undefined, run.runId);
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
        orchestrationUi.markSessionCompleted();
        void actions.refreshWorkLogForTopic(topic.id);
        notifyTopicSummaryUpdated(topic.id);
      }, 4000);

      void actions.refreshTopics(room.id);
    },
    [
      actions,
      markMessageSeenByEmployee,
      orchestrationUi,
      room.id,
      room.status,
      state.workspace.id,
      topic,
      trace,
    ],
  );

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
          (r: { status: string; stale?: boolean; processable?: boolean }) =>
            r.status === "queued" && !r.stale,
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
  ) => {
    if (!topic || topic.status === "archived" || room.status === "archived") return;
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
        mode: "live" as const,
      };

      trace("message", "info", `POST /api/rooms/${room.id}/messages`, body);

      const sendStarted = Date.now();
      const response = await fetch(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));

      trace(
        "message",
        response.ok || response.status === 207 ? "success" : "error",
        `Message API ${response.status} (${Date.now() - sendStarted}ms)`,
        {
          queuedRuns: payload.queuedRuns,
          blockedRuns: payload.blockedRuns,
          code: payload.code,
          hint: payload.hint,
          orchestratorDebug: payload.orchestratorDebug,
          error: payload.error,
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
        throw new Error(payload?.error ?? "Unable to send message.");
      }

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
        actions.updateMessage(room.id, messageId, {
          ...payload.humanMessage,
          pending: false,
          deliveryStatus: "delivered",
          deliveredAt: payload.humanMessage.createdAt ?? deliveredAt,
        });
      }

      const employeeNames = new Map(roomEmployees.map((e) => [e.id, e.name]));
      orchestrationUi.setOrchestrationFromSend({
        orchestrationId: payload.orchestrationId ?? null,
        triggerMessageId: payload.humanMessage?.id ?? messageId,
        orchestrationPlan: payload.orchestrationPlan ?? null,
        collaborationPlan: payload.collaborationPlan ?? null,
        employeeNames,
      });

      if (payload.collaborationPlan) {
        setCollaborationPlan(payload.collaborationPlan);
      }
      if (payload.orchestratorDebug) {
        setOrchestratorDebug(payload.orchestratorDebug);
      }
      if (payload.topicSuggestions?.length) {
        setTopicSuggestions((prev) => {
          const incoming = payload.topicSuggestions as TopicSuggestionPayload[];
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

      if (payload.queuedRuns?.length || waitingRuns.length) {
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
        setTimeout(() => void actions.refreshTopics(room.id), 4000);
      }
      void actions.refreshWorkLogForTopic(topic.id);

      void actions.refreshTopics(room.id);
    } catch (error) {
      actions.removeLocalMessage(room.id, messageId);
      setFailedSend({ clientMessageId: messageId, content: text });
      const msg = error instanceof Error ? error.message : "Unable to send message.";
      setSendError(msg);
      trace("message", "error", "Send failed", { error: msg });
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

  const handleCreateTopicFromSuggestion = async (title: string) => {
    if (!topic) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/rooms/${room.id}/topics`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: "", priority: "normal" }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error ?? "Could not create topic.");
    if (payload.topic) actions.upsertTopic(payload.topic);
  };

  const handleAcceptTopicSuggestion = async (suggestionId: string) => {
    await acceptTopicSuggestionApi(suggestionId, state.workspace.id);
    setTopicSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  };

  const handleDismissTopicSuggestion = async (suggestionId: string) => {
    await dismissTopicSuggestionApi(suggestionId, state.workspace.id);
    setTopicSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  };

  const handleSend = async (text: string, mentionsJson?: import("@/lib/types").MentionRef[]) => {
    if (!topic || topic.status === "archived" || room.status === "archived") return;
    if (useServerApi) {
      await sendViaServer(text, undefined, mentionsJson);
      return;
    }
    if (ENABLE_DEMO_MODE) {
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
          title="Choose or create a topic"
          description="Topics keep AI context focused. Select a topic from the list or create a new one to start messaging."
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
  const isChannelArchived = room.status === "archived";
  const chatDisabled = isTopicArchived || isChannelArchived;

  const placeholder = chatDisabled
    ? isChannelArchived
      ? "This channel is archived — restore it from the Channels page to send messages"
      : "This topic is archived — restore it to send messages"
    : isDm && dmEmployee
    ? `Message ${dmEmployee.name} directly… use @ to mention, / for commands`
    : isMainChat
      ? `Message ${mainChatLabel(isDm)}…`
      : `Discuss ${topic.title}… use @ to mention an employee`;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-canvas px-[18px]">
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
                <span className="truncate text-sm font-semibold text-ink">{dmEmployee.name}</span>
                <span className="rounded-[5px] bg-accent-soft px-[5px] py-0.5 text-[9px] font-bold text-accent">
                  AI
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                {dmEmployee && isMayaEmployee(dmEmployee) ? (
                  <>
                    <EmployeeStatusDot status={effectiveEmployeeStatus(dmEmployee)} />
                    Online · {dmEmployee.role}
                  </>
                ) : (
                  <>
                    <EmployeeStatusDot status={dmEmployee.status} />
                    {STATUS_META[dmEmployee.status].label} · {dmEmployee.provider} · {dmEmployee.model}
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="truncate">{displayTitle}</span>
              <span className="truncate text-[11px] font-medium text-ink-3">in {room.name}</span>
            </div>
            <p className="text-[11.5px] text-ink-2">
              {openTopicTasks} open task{openTopicTasks === 1 ? "" : "s"} · {roomEmployees.length}{" "}
              employee{roomEmployees.length === 1 ? "" : "s"}
            </p>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {onSummarize && (
            <button
              type="button"
              onClick={onSummarize}
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
              onClick={() => router.push("/workforce")}
              className="hidden items-center gap-1.5 rounded-[10px] border border-border bg-surface px-[11px] py-[7px] text-xs font-medium text-ink-2 transition-colors hover:bg-muted sm:inline-flex"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
              Add employee
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push(`/calls?room=${room.id}`)}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-border bg-surface text-ink-2 transition-colors hover:bg-muted"
            aria-label="Start call"
          >
            <Phone className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="hidden h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-border bg-surface text-ink-2 transition-colors hover:bg-muted xl:flex"
            aria-label="Inspector"
          >
            <PanelRight className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[26px] pb-2 pt-[18px]">
        {hasOlder && (
          <div className="mx-auto mb-3 max-w-3xl text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessageLimit((n) => n + MESSAGE_PAGE)}
            >
              Load older messages
            </Button>
          </div>
        )}
        {topicMessages.length === 0 ? (
          isDm && dmEmployee && isMayaEmployee(dmEmployee) && !chatDisabled ? (
            <MayaDmEmptyState
              firstName={state.user?.name?.split(" ")[0] ?? "there"}
              onSendMessage={(text) => {
                void handleSend(text);
              }}
            />
          ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <EmptyState
              icon={MessagesSquare}
              title={isDm && dmEmployee ? `Message ${dmEmployee.name}` : `Start ${displayTitle}`}
              description="Send a message here. Mention an AI employee with @ when you want help."
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
          <div className="mx-auto max-w-[760px]">
            <div className="mb-[18px] mt-1.5 text-center">
              <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-ink-3">Today</span>
            </div>
            {displayMessages.map((m) => (
              <RoomMessageItem key={m.id} message={m} isDm={isDm} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {failedSend && (
        <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm text-rose-800">
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

      <div className="shrink-0 px-[26px] pb-[18px] pt-1.5">
        <div className="mx-auto max-w-[760px]">
          {topicSuggestions.map((suggestion) => (
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
              {isChannelArchived
                ? "This channel is archived. Messaging and AI responses are paused until you restore it."
                : "This topic is archived. Messaging and AI responses are paused until you restore it."}
            </div>
          )}
          <ChatComposer
            employees={roomEmployees}
            onSend={handleSend}
            disabled={!topic || chatDisabled}
            placeholder={placeholder}
            draftText={draftText}
            onDraftConsumed={onDraftConsumed}
            onSlashCommand={onSlashCommand}
          />
          {!chatDisabled && (
          <p className="px-1.5 pt-[7px] text-[11px] text-ink-3">
            <span>
              <b className="font-mono text-ink-2">@</b> mention an employee
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
