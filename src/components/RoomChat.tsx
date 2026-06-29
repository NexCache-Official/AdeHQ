"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectRoom, RoomTopic } from "@/lib/types";
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
import {
  AlertCircle,
  Bot,
  ListChecks,
  Loader2,
  MessagesSquare,
  RotateCcw,
  UserPlus,
} from "lucide-react";

type PendingSend = {
  clientMessageId: string;
  content: string;
};

type ActiveRun = {
  runId: string;
  employeeId: string;
  employeeName: string;
  phase: "queued" | "reading" | "thinking" | "typing" | "done" | "failed";
};

const MESSAGE_PAGE = 50;

export function RoomChat({
  room,
  topic,
  draftText,
  onDraftConsumed,
  onSlashCommand,
  isDm = false,
}: {
  room: ProjectRoom;
  topic?: RoomTopic;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
  isDm?: boolean;
}) {
  const { state, actions, backend } = useStore();
  const respond = useResponder();
  const router = useRouter();
  const [failedSend, setFailedSend] = useState<PendingSend | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allTopicMessages = topic
    ? room.messages.filter((m) => m.topicId === topic.id)
    : [];
  const topicMessages = allTopicMessages.slice(-messageLimit);
  const hasOlder = allTopicMessages.length > messageLimit;

  const roomEmployees = room.aiEmployees
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [topicMessages.length, activeRuns.length]);

  useEffect(() => {
    if (!topic) return;
    const last = topicMessages[topicMessages.length - 1];
    if (last && backend === "supabase") {
      void markTopicRead(topic.id, last.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topicMessages.length]);

  const markTopicRead = async (topicId: string, lastReadMessageId: string) => {
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

  const processQueuedRuns = useCallback(
    async (
      queuedRuns: {
        runId: string;
        employeeId: string;
        employeeName: string;
      }[],
    ) => {
      if (!queuedRuns.length || !topic) return;

      setActiveRuns(
        queuedRuns.map((r) => ({
          ...r,
          phase: "queued" as const,
        })),
      );

      const headers = await authHeaders();

      await Promise.allSettled(
        queuedRuns.map(async (run) => {
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "reading" } : r,
            ),
          );

          await new Promise((r) => setTimeout(r, 300));
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.runId === run.runId ? { ...r, phase: "thinking" } : r,
            ),
          );

          try {
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "typing" } : r,
              ),
            );

            const res = await fetch(`/api/agent-runs/${run.runId}/process`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                workspaceId: state.workspace.id,
                mode: "live",
              }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error ?? "AI response failed");
            }

            if (data.aiMessage) {
              actions.addMessage(room.id, {
                id: data.aiMessage.id,
                topicId: topic.id,
                senderType: "ai",
                senderId: data.aiMessage.senderId,
                senderName: data.aiMessage.senderName,
                content: data.aiMessage.content,
                agentRunId: run.runId,
              });
            }

            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "done" } : r,
              ),
            );
          } catch (err) {
            console.error("[AdeHQ process run]", err);
            setActiveRuns((prev) =>
              prev.map((r) =>
                r.runId === run.runId ? { ...r, phase: "failed" } : r,
              ),
            );
          }
        }),
      );

      setTimeout(() => {
        setActiveRuns((prev) => prev.filter((r) => r.phase !== "done"));
      }, 3000);

      void actions.refreshTopics(room.id);
    },
    [actions, room.id, state.workspace.id, topic],
  );

  const sendViaServer = async (
    text: string,
    clientMessageId?: string,
    mentionsJson?: import("@/lib/types").MentionRef[],
  ) => {
    if (!topic) return;
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
    });

    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: text,
          topicId: topic.id,
          clientMessageId: messageId,
          mentionsJson,
          mode: "live",
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 207) {
        if (payload.code === "ai_runtime_failed_but_message_saved" || payload.humanMessage) {
          actions.updateMessage(room.id, messageId, { pending: false });
          if (payload.humanMessage) {
            actions.updateMessage(room.id, messageId, payload.humanMessage);
          }
          return;
        }
        throw new Error(payload?.error ?? "Unable to send message.");
      }

      actions.updateMessage(room.id, messageId, { pending: false });

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
        });
      }

      if (payload.queuedRuns?.length) {
        void processQueuedRuns(payload.queuedRuns);
      }

      void actions.refreshTopics(room.id);
    } catch (error) {
      actions.removeLocalMessage(room.id, messageId);
      setFailedSend({ clientMessageId: messageId, content: text });
      setSendError(error instanceof Error ? error.message : "Unable to send message.");
      if (process.env.NODE_ENV === "development") {
        console.error("[AdeHQ RoomChat send]", error);
      }
    }
  };

  const sendViaDemo = async (text: string) => {
    if (!topic) return;
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

  const handleSend = async (text: string, mentionsJson?: import("@/lib/types").MentionRef[]) => {
    if (!topic) return;
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

  const placeholder = isDm && dmEmployee
    ? `Message ${dmEmployee.name} directly…`
    : isMainChat
      ? `Message ${mainChatLabel(isDm)}…`
      : `Discuss ${topic.title}… use @ to mention an employee`;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-sm font-semibold text-slate-900">{displayTitle}</h2>
          {topic.description && !isMainChat && (
            <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{topic.description}</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
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
        ) : (
          <div className="mx-auto max-w-3xl">
            {topicMessages.map((m) => (
              <RoomMessageItem key={m.id} message={m} />
            ))}
            {activeRuns
              .filter((r) => r.phase !== "done")
              .map((run) => {
                const emp = roomEmployees.find((e) => e.id === run.employeeId);
                const phaseLabel =
                  run.phase === "queued"
                    ? "has seen your message"
                    : run.phase === "reading"
                      ? "is reading…"
                      : run.phase === "thinking"
                        ? "is thinking…"
                        : run.phase === "typing"
                          ? "is typing…"
                          : run.phase === "failed"
                            ? "couldn't respond"
                            : "";
                return (
                  <div
                    key={run.runId}
                    className="flex items-center gap-2 px-1 py-2 text-xs text-slate-500"
                  >
                    {emp && <EmployeeAvatar employee={emp} size="xs" />}
                    <Loader2 className="h-3 w-3 animate-spin text-accent-600" />
                    <span>
                      <span className="font-medium text-slate-700">{run.employeeName}</span>{" "}
                      {phaseLabel}
                    </span>
                  </div>
                );
              })}
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

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            employees={roomEmployees}
            onSend={handleSend}
            disabled={!topic}
            placeholder={placeholder}
            draftText={draftText}
            onDraftConsumed={onDraftConsumed}
            onSlashCommand={onSlashCommand}
          />
          {useServerApi && roomEmployees.length > 0 && (
            <p className="mt-2 px-1 text-[11px] text-slate-600">
              {roomEmployees.length} AI employee{roomEmployees.length === 1 ? "" : "s"} in this room · mention with @ for a reply · type /help for commands
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
