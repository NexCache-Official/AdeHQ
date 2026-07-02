"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { RoomChat } from "@/components/RoomChat";
import { TopicList } from "@/components/TopicList";
import { TopicPanel } from "@/components/TopicPanel";
import { NewTopicModal } from "@/components/NewTopicModal";
import { AddEmployeeToRoomModal } from "@/components/AddEmployeeToRoomModal";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { authHeaders } from "@/lib/api/auth-client";
import { generalTopicForRoom, isGeneralTopic, topicsForRoom } from "@/lib/topics";
import { MayaDmHiringLayout } from "@/components/maya/MayaDmHiringWorkspace";
import { OrchestrationUiProvider } from "@/components/orchestration/OrchestrationUiContext";
import { roomAssignableEmployees, isMayaEmployee } from "@/lib/maya-employee";
import { notifyTopicSummaryUpdated } from "@/lib/topic-summary/client";
import type { AiParticipationMode, TopicPriority, WorkspaceFile } from "@/lib/types";
import type { SlashCommandResult } from "@/components/ChatComposer";
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
  const [topicCreateError, setTopicCreateError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [topicActionBusy, setTopicActionBusy] = useState(false);
  const [topicActionError, setTopicActionError] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addingEmployeeId, setAddingEmployeeId] = useState<string | null>(null);

  const room = state.rooms.find((r) => r.id === roomId);
  const isDm = room?.kind === "dm";
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

  const roomEmployees = useMemo(
    () => (room ? room.aiEmployees.map((id) => state.employees.find((e) => e.id === id)).filter(Boolean) : []),
    [room, state.employees],
  );
  const assignableEmployees = useMemo(
    () => roomAssignableEmployees(state.employees),
    [state.employees],
  );
  const addableEmployees = useMemo(
    () => (room ? assignableEmployees.filter((employee) => !room.aiEmployees.includes(employee.id)) : []),
    [assignableEmployees, room],
  );
  const isMayaDm = Boolean(
    isDm && roomEmployees[0] && isMayaEmployee(roomEmployees[0]),
  );

  useEffect(() => {
    if (backend !== "supabase" && !isMayaDm) return;
    void actions.refreshTopics(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, backend, isMayaDm]);

  useEffect(() => {
    if (roomTopics.length === 0) return;
    const selectedExists = selectedTopicId
      ? roomTopics.some((t) => t.id === selectedTopicId)
      : false;
    if (!selectedExists) {
      const general = generalTopicForRoom(roomTopics, roomId);
      const nextId = general?.id ?? roomTopics[0].id;
      setSelectedTopicId(nextId);
      router.replace(`/rooms/${roomId}?topic=${nextId}`, { scroll: false });
    }
  }, [roomTopics, roomId, selectedTopicId, router]);

  const selectTopic = useCallback(
    (topicId: string) => {
      setSelectedTopicId(topicId);
      router.replace(`/rooms/${roomId}?topic=${topicId}`, { scroll: false });
    },
    [roomId, router],
  );

  const createTopic = async (payload: {
    title: string;
    description: string;
    priority: TopicPriority;
    aiEmployeeIds: string[];
    starterMessage?: string;
  }) => {
    setTopicCreateError(null);
    setCreatingTopic(true);
    try {
      for (const employeeId of payload.aiEmployeeIds) {
        if (!room?.aiEmployees.includes(employeeId)) {
          actions.addEmployeeToRoom(roomId, employeeId);
        }
      }

      if (backend === "supabase") {
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
        void actions.flushRemote();
        setNewTopicOpen(false);
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
      setNewTopicOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create topic";
      setTopicCreateError(message);
      throw e;
    } finally {
      setCreatingTopic(false);
    }
  };

  const summarizeTopic = async () => {
    if (!room) return;

    setSummarizing(true);
    try {
      let topicId = selectedTopic?.id;

      if (backend === "supabase") {
        if (isMayaDm) {
          const headers = await authHeaders();
          await fetch("/api/workspaces/ensure-maya", { method: "POST", headers });
          await actions.refreshTopics(roomId);
          const topicsResponse = await fetch(`/api/rooms/${roomId}/topics`, { headers });
          if (topicsResponse.ok) {
            const payload = await topicsResponse.json();
            const topics = (payload.topics ?? []) as typeof roomTopics;
            const general = generalTopicForRoom(topics, roomId);
            if (general) {
              topicId = general.id;
              if (selectedTopicId !== general.id) {
                selectTopic(general.id);
              }
            }
          }
        }

        if (!topicId) return;

        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${topicId}/summary/refresh`, {
          method: "POST",
          headers,
          body: JSON.stringify({ manual: true }),
        });
        if (!response.ok) throw new Error("Summarize failed");
        const payload = await response.json();
        if (payload.topic) actions.upsertTopic(payload.topic);
        notifyTopicSummaryUpdated(topicId);
        void actions.refreshWorkLogForTopic(topicId);
        return;
      }

      if (!selectedTopic) return;
      const recent = room.messages
        .filter((message) => message.topicId === selectedTopic.id)
        .slice(-12)
        .map((message) => `[${message.senderName}] ${message.content}`)
        .join("\n");
      const summary = [
        "What happened:",
        recent || "No messages yet in this conversation.",
        "",
        "Current decision:",
        "(Add manually after reviewing the thread.)",
        "",
        "Open questions:",
        "-",
        "",
        "Next tasks:",
        "-",
        "",
        "Risks:",
        "-",
      ].join("\n");
      actions.setTopicSummary(selectedTopic.id, summary);
    } catch (e) {
      console.error(e);
    } finally {
      setSummarizing(false);
    }
  };

  const archiveTopic = async () => {
    if (!selectedTopic || isGeneralTopic(selectedTopic)) return;
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${selectedTopic.id}`, {
          method: "DELETE",
          headers,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to archive topic");
        }
        const { topic } = await response.json();
        actions.upsertTopic(topic);
      } else {
        actions.upsertTopic({ ...selectedTopic, status: "archived", updatedAt: new Date().toISOString() });
      }
      const general = generalTopicForRoom(roomTopics, roomId);
      if (general) selectTopic(general.id);
      setSlashNotice("Topic archived.");
      setTimeout(() => setSlashNotice(null), 4000);
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to archive topic");
    } finally {
      setTopicActionBusy(false);
    }
  };

  const unarchiveTopic = async () => {
    if (!selectedTopic) return;
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${selectedTopic.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "active" }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to restore topic");
        }
        const { topic } = await response.json();
        actions.upsertTopic(topic);
      } else {
        actions.upsertTopic({ ...selectedTopic, status: "active", updatedAt: new Date().toISOString() });
      }
      setSlashNotice("Topic restored.");
      setTimeout(() => setSlashNotice(null), 4000);
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to restore topic");
    } finally {
      setTopicActionBusy(false);
    }
  };

  const deleteTopicPermanently = async () => {
    if (!selectedTopic || isGeneralTopic(selectedTopic)) return;
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${selectedTopic.id}?permanent=true`, {
          method: "DELETE",
          headers,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to delete topic");
        }
      }
      actions.removeTopicPermanently(roomId, selectedTopic.id);
      await actions.refreshTopics(roomId);
      const general = generalTopicForRoom(roomTopics, roomId);
      if (general) selectTopic(general.id);
      setSlashNotice("Topic deleted permanently.");
      setTimeout(() => setSlashNotice(null), 4000);
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to delete topic");
    } finally {
      setTopicActionBusy(false);
    }
  };

  const setParticipationMode = async (mode: AiParticipationMode) => {
    if (!selectedTopic || backend !== "supabase") return;
    const headers = await authHeaders();
    const response = await fetch(`/api/topics/${selectedTopic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ aiParticipationMode: mode }),
    });
    if (response.ok) {
      const { topic } = await response.json();
      actions.upsertTopic(topic);
    }
  };

  const handleAiControl = async (action: "stop_all" | "resume") => {
    if (!selectedTopic || backend !== "supabase") return;
    const headers = await authHeaders();
    const response = await fetch(`/api/topics/${selectedTopic.id}/ai-control`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action }),
    });
    if (response.ok) {
      const { topic } = await response.json();
      actions.upsertTopic(topic);
    }
  };

  const handleSlashCommand = async (result: SlashCommandResult) => {
    if (!selectedTopic || !room) return;

    switch (result.type) {
      case "help":
        setSlashNotice("Commands: /task /memory /summarize /ask /archive /assign. Artifact commands unlock in Phase 3.");
        break;
      case "task":
        actions.createTask({
          roomId,
          topicId: selectedTopic.id,
          title: result.title,
          status: "open",
          createdFrom: "slash_command",
        });
        setSlashNotice(`Task created: ${result.title}`);
        break;
      case "memory":
        actions.createMemory({
          roomId,
          topicId: selectedTopic.id,
          title: `Memory — ${selectedTopic.title}`,
          content: result.content,
          type: "general",
          status: "approved",
          createdByType: "human",
          createdById: state.user?.id ?? "user",
        });
        setSlashNotice("Saved to topic memory.");
        break;
      case "summary":
        await summarizeTopic();
        setSlashNotice("Topic summary updated.");
        break;
      case "ask":
        askAiAboutTopic();
        setSlashNotice("Draft inserted — review and send.");
        break;
      case "archive":
        if (isGeneralTopic(selectedTopic)) {
          setSlashNotice("General/Direct Chat cannot be archived.");
          return;
        }
        await archiveTopic();
        setSlashNotice("Topic archived.");
        break;
      case "assign":
        if (backend === "supabase") {
          const headers = await authHeaders();
          await fetch(`/api/topics/${selectedTopic.id}/members`, {
            method: "POST",
            headers,
            body: JSON.stringify({ employeeId: result.employeeId }),
          });
          await actions.refreshTopics(roomId);
        }
        setSlashNotice(`${result.employeeName} added to topic.`);
        break;
      default:
        break;
    }
    setTimeout(() => setSlashNotice(null), 4000);
  };

  const addEmployeeToRoom = async (employeeId: string, addToTopic: boolean) => {
    if (!room) return;
    setAddingEmployeeId(employeeId);
    try {
      actions.addEmployeeToRoom(roomId, employeeId);

      if (backend === "supabase") {
        const headers = await authHeaders();
        const roomResponse = await fetch(`/api/rooms/${roomId}/members`, {
          method: "POST",
          headers,
          body: JSON.stringify({ employeeId }),
        });
        if (!roomResponse.ok) {
          const payload = await roomResponse.json().catch(() => null);
          throw new Error(payload?.error ?? "Unable to add employee to room.");
        }

        if (addToTopic && selectedTopic) {
          const topicResponse = await fetch(`/api/topics/${selectedTopic.id}/members`, {
            method: "POST",
            headers,
            body: JSON.stringify({ employeeId }),
          });
          if (!topicResponse.ok) {
            const payload = await topicResponse.json().catch(() => null);
            throw new Error(payload?.error ?? "Unable to add employee to topic.");
          }
          await actions.refreshTopics(roomId);
        }
      }

      const employee = state.employees.find((candidate) => candidate.id === employeeId);
      setSlashNotice(`${employee?.name ?? "Employee"} added to ${room.name}.`);
      setTimeout(() => setSlashNotice(null), 3500);
    } catch (error) {
      setTopicActionError(error instanceof Error ? error.message : "Unable to add employee.");
    } finally {
      setAddingEmployeeId(null);
    }
  };

  const askAiAboutTopic = () => {
    const pm = roomEmployees.find((e) => e?.roleKey === "pm") ?? roomEmployees[0];
    if (!pm || !selectedTopic) return;
    const text = `@${pm.name} summarize the current state of this topic and suggest next steps.`;
    setComposerDraft(text);
  };

  const askAiAboutFile = (file: WorkspaceFile) => {
    const teammate = roomEmployees.find((e) => e?.roleKey === "research" || e?.roleKey === "pm") ?? roomEmployees[0];
    const prefix = teammate ? `@${teammate.name} ` : "";
    setComposerDraft(
      `${prefix}review ${file.displayName} and tell me the key points, risks, and recommended next steps for this topic.`,
    );
  };

  const saveSummaryToMemory = () => {
    if (!selectedTopic) return;
    void actions.refreshWorkLogForTopic(selectedTopic.id);
  };

  const createTaskFromSummary = (title: string, ownerEmployeeId?: string) => {
    if (!room || !selectedTopic) return;
    actions.createTask({
      roomId,
      topicId: selectedTopic.id,
      title,
      status: "open",
      assigneeType: ownerEmployeeId ? "ai" : "human",
      assigneeId: ownerEmployeeId ?? state.user?.id ?? "user",
      priority: "medium",
    });
    void actions.refreshWorkLogForTopic(selectedTopic.id);
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
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6 lg:hidden">
        <button
          onClick={() => router.push("/rooms")}
          className="rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-ink lg:hidden"
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
          <h1 className="truncate text-base font-semibold text-ink">{room.name}</h1>
          <p className="truncate text-xs text-ink-3">
            {isDm
              ? `Direct message with ${roomEmployees[0]?.name ?? "AI employee"}`
              : `${roomTopics.length} topic${roomTopics.length === 1 ? "" : "s"} · you + ${roomEmployees.length} AI employee${roomEmployees.length === 1 ? "" : "s"}`}
          </p>
          {!isDm && roomEmployees.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {roomEmployees.slice(0, 4).map((employee) => (
                <span key={employee?.id} className="chip bg-white">
                  {employee?.name}
                </span>
              ))}
              {roomEmployees.length > 4 && (
                <span className="text-[11px] text-ink-3">+{roomEmployees.length - 4} more</span>
              )}
            </div>
          )}
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

      <OrchestrationUiProvider>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden w-[266px] shrink-0 lg:block">
          <TopicList
            topics={roomTopics}
            topicMembers={roomTopicMembers}
            messages={room.messages}
            selectedTopicId={selectedTopic?.id}
            userId={state.user?.id}
            isDm={isDm}
            room={isDm && !isMayaDm ? undefined : room}
            dmEmployee={isDm ? roomEmployees[0] : undefined}
            onSelect={selectTopic}
            onNewTopic={() => setNewTopicOpen(true)}
          />
        </div>

        {isMayaDm ? (
          <MayaDmHiringLayout
            mayaRoomId={roomId}
            selectedTopic={selectedTopic}
            onSelectTopic={selectTopic}
            firstName={state.user?.name?.split(" ")[0]}
          />
        ) : (
          <>
        <div className="min-w-0 flex-1 border-r border-border bg-canvas">
              {slashNotice && (
                <div className="border-b border-accent-200 bg-accent-50 px-4 py-1.5 text-center text-xs text-accent-800">
                  {slashNotice}
                </div>
              )}
              {topicActionError && (
                <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-center text-xs text-red-800">
                  {topicActionError}
                </div>
              )}
              <RoomChat
                room={room}
                topic={selectedTopic}
                isDm={isDm}
                draftText={composerDraft}
                onDraftConsumed={() => setComposerDraft("")}
                onSlashCommand={handleSlashCommand}
                onSummarize={summarizeTopic}
                summarizing={summarizing}
                onAddEmployee={() => setAddEmployeeOpen(true)}
              />
        </div>

        <div className="hidden w-[344px] shrink-0 xl:block">
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
              workspaceMembers={state.workspaceMembers}
              isDm={isDm}
              onSummarize={summarizeTopic}
              onArchive={archiveTopic}
              onUnarchive={unarchiveTopic}
              onDeletePermanently={deleteTopicPermanently}
              onSaveSummaryToMemory={saveSummaryToMemory}
              onWorkLogRefresh={saveSummaryToMemory}
              onCreateTaskFromSummary={createTaskFromSummary}
              onParticipationChange={setParticipationMode}
              onAiControl={handleAiControl}
              onAskAboutFile={askAiAboutFile}
              summarizing={summarizing}
              topicActionBusy={topicActionBusy}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-ink-3">
              Select a topic to see context
            </div>
          )}
        </div>
          </>
        )}
      </div>
      </OrchestrationUiProvider>

      <NewTopicModal
        open={newTopicOpen}
        onClose={() => {
          setNewTopicOpen(false);
          setTopicCreateError(null);
        }}
        assignableEmployees={assignableEmployees}
        onCreate={createTopic}
        busy={creatingTopic}
        error={topicCreateError}
      />
      {!isDm && (
        <AddEmployeeToRoomModal
          open={addEmployeeOpen}
          onClose={() => setAddEmployeeOpen(false)}
          roomName={room.name}
          topicTitle={selectedTopic && !isGeneralTopic(selectedTopic) ? selectedTopic.title : undefined}
          employees={addableEmployees}
          currentEmployeeIds={room.aiEmployees}
          onAdd={addEmployeeToRoom}
          busyEmployeeId={addingEmployeeId}
        />
      )}
    </div>
  );
}
