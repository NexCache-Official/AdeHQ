"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { RoomChat } from "@/components/RoomChat";
import { TopicList } from "@/components/TopicList";
import { TopicPanel } from "@/components/TopicPanel";
import { NewTopicModal } from "@/components/NewTopicModal";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { authHeaders } from "@/lib/api/auth-client";
import { generalTopicForRoom, topicsForRoom } from "@/lib/topics";
import type { TopicPriority } from "@/lib/types";
import {
  ArrowLeft,
  Hash,
  Phone,
  Plus,
  UserPlus,
} from "lucide-react";

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const { state, actions, backend } = useStore();
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);

  const room = state.rooms.find((r) => r.id === roomId);
  const roomTopics = useMemo(
    () => topicsForRoom(state.topics, roomId),
    [state.topics, roomId],
  );
  const roomTopicMembers = useMemo(
    () => state.topicMembers.filter((m) => m.roomId === roomId),
    [state.topicMembers, roomId],
  );

  const topicFromUrl = searchParams.get("topic");
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(topicFromUrl ?? undefined);

  const selectedTopic = roomTopics.find((t) => t.id === selectedTopicId) ?? roomTopics[0];

  useEffect(() => {
    if (backend === "supabase") {
      void actions.refreshTopics(roomId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, backend]);

  useEffect(() => {
    if (!selectedTopicId && roomTopics.length > 0) {
      const general = generalTopicForRoom(roomTopics, roomId);
      setSelectedTopicId(general?.id ?? roomTopics[0].id);
    }
  }, [roomTopics, roomId, selectedTopicId]);

  const selectTopic = useCallback(
    (topicId: string) => {
      setSelectedTopicId(topicId);
      router.replace(`/rooms/${roomId}?topic=${topicId}`, { scroll: false });
    },
    [roomId, router],
  );

  const roomEmployees = useMemo(
    () => (room ? room.aiEmployees.map((id) => state.employees.find((e) => e.id === id)).filter(Boolean) : []),
    [room, state.employees],
  );

  const createTopic = async (payload: {
    title: string;
    description: string;
    priority: TopicPriority;
    aiEmployeeIds: string[];
    starterMessage?: string;
  }) => {
    if (backend === "supabase") {
      setCreatingTopic(true);
      try {
        const headers = await authHeaders();
        const response = await fetch(`/api/rooms/${roomId}/topics`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to create topic");
        }
        const { topic } = await response.json();
        actions.upsertTopic(topic);
        selectTopic(topic.id);
        await actions.refreshTopics(roomId);
      } finally {
        setCreatingTopic(false);
      }
      return;
    }

    const topicId = `topic-${Date.now()}`;
    const now = new Date().toISOString();
    actions.upsertTopic({
      id: topicId,
      workspaceId: state.workspace.id,
      roomId,
      title: payload.title,
      description: payload.description,
      status: "active",
      priority: payload.priority,
      createdByType: "human",
      createdById: state.user?.id,
      lastActivityAt: now,
      messageCount: 0,
      taskCount: 0,
      openTaskCount: 0,
      memoryCount: 0,
      approvalCount: 0,
      agentRunCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    selectTopic(topicId);
  };

  const summarizeTopic = async () => {
    if (!selectedTopic || backend !== "supabase") return;
    setSummarizing(true);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/topics/${selectedTopic.id}/summarize`, {
        method: "POST",
        headers,
      });
      if (!response.ok) throw new Error("Summarize failed");
      const { topic, summary } = await response.json();
      actions.upsertTopic(topic);
      actions.setTopicSummary(selectedTopic.id, summary);
    } catch (e) {
      console.error(e);
    } finally {
      setSummarizing(false);
    }
  };

  const resolveTopic = async () => {
    if (!selectedTopic || backend !== "supabase") return;
    const headers = await authHeaders();
    const response = await fetch(`/api/topics/${selectedTopic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "resolved" }),
    });
    if (response.ok) {
      const { topic } = await response.json();
      actions.upsertTopic(topic);
    }
  };

  const askAiAboutTopic = () => {
    const pm = roomEmployees.find((e) => e?.roleKey === "pm") ?? roomEmployees[0];
    if (!pm || !selectedTopic) return;
    const text = `@${pm.name} summarize the current state of this topic and suggest next steps.`;
    void document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    // User can paste via composer quick command — trigger via custom event would be overkill
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  const saveSummaryToMemory = () => {
    if (!selectedTopic?.summary || !room) return;
    actions.createMemory({
      roomId,
      topicId: selectedTopic.id,
      title: `Topic summary — ${selectedTopic.title}`,
      content: selectedTopic.summary,
      type: "general",
      status: "approved",
      createdByType: "human",
      createdById: state.user?.id ?? "user",
    });
  };

  if (!room) {
    return (
      <div className="p-10">
        <EmptyState
          icon={UserPlus}
          title="Room not found"
          description="This room may have been removed."
          action={{ label: "Back to rooms", onClick: () => router.push("/rooms") }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <button
          onClick={() => router.push("/rooms")}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {room.kind === "dm" && roomEmployees[0] ? (
          <EmployeeAvatar employee={roomEmployees[0]} size="sm" />
        ) : (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
            style={{ background: room.accent }}
          >
            <Hash className="h-5 w-5" strokeWidth={2.4} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{room.name}</h1>
          <p className="truncate text-xs text-slate-500">
            {roomTopics.length} topic{roomTopics.length === 1 ? "" : "s"} · {room.humans.length + roomEmployees.length} participants
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Button variant="ghost" size="sm" onClick={() => setNewTopicOpen(true)}>
            <Plus className="h-4 w-4" /> New topic
          </Button>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/calls?room=${roomId}`)}>
            <Phone className="h-4 w-4" /> Call
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[220px] shrink-0 lg:block xl:w-[260px]">
          <TopicList
            topics={roomTopics}
            topicMembers={roomTopicMembers}
            messages={room.messages}
            selectedTopicId={selectedTopic?.id}
            userId={state.user?.id}
            onSelect={selectTopic}
            onNewTopic={() => setNewTopicOpen(true)}
          />
        </div>

        <div className="min-w-0 flex-1 border-r border-slate-200">
          <RoomChat room={room} topic={selectedTopic} />
        </div>

        <div className="hidden w-[300px] shrink-0 xl:block xl:w-[340px]">
          {selectedTopic ? (
            <TopicPanel
              topic={selectedTopic}
              room={room}
              employees={state.employees}
              topicMembers={roomTopicMembers.filter((m) => m.topicId === selectedTopic.id)}
              tasks={state.tasks}
              memory={state.memory}
              approvals={state.approvals}
              workLog={state.workLog}
              onSummarize={summarizeTopic}
              onResolve={resolveTopic}
              onAskAi={askAiAboutTopic}
              onSaveSummaryToMemory={saveSummaryToMemory}
              summarizing={summarizing}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
              Select a topic to see context
            </div>
          )}
        </div>
      </div>

      <NewTopicModal
        open={newTopicOpen}
        onClose={() => setNewTopicOpen(false)}
        roomEmployees={roomEmployees.filter((e): e is NonNullable<typeof e> => !!e)}
        onCreate={createTopic}
        busy={creatingTopic}
      />
    </div>
  );
}
