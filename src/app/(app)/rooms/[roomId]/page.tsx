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
import { MayaRoomCoordinator } from "@/components/maya/MayaRoomCoordinator";
import {
  ParticipantAvatarStack,
  RoomMembersPopover,
} from "@/components/people/RoomMembersPopover";
import { OrchestrationUiProvider } from "@/components/orchestration/OrchestrationUiContext";
import { roomAssignableEmployees, isMayaEmployee } from "@/lib/maya-employee";
import { notifyTopicSummaryUpdated } from "@/lib/topic-summary/client";
import {
  JUMP_TO_SOURCE_EVENT,
  requestScrollToMessage,
  type JumpSource,
} from "@/lib/navigation/jump-to-source";
import type { AiParticipationMode, TopicPriority, WorkspaceFile, SavedArtifactType, RoomMessage, RoomTopic } from "@/lib/types";
import type { SlashCommandResult } from "@/components/ChatComposer";
import {
  artifactSourcesFromMessage,
  firstArtifactFromMessage,
  quoteMessageText,
  taskTitleFromMessage,
  titleFromMessageContent,
  type MessageActionHandlers,
} from "@/lib/message-actions";
import { saveFileMemorySuggestionClient } from "@/lib/topic-summary/client";
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
  const [composerContextFiles, setComposerContextFiles] = useState<Array<{ id: string; displayName: string }>>([]);
  const [composerArtifactIntent, setComposerArtifactIntent] = useState<{
    type: SavedArtifactType;
    label: string;
  } | null>(null);
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addingEmployeeId, setAddingEmployeeId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

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
  const messageFromUrl = searchParams.get("message");
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(topicFromUrl ?? undefined);

  const selectedTopic = roomTopics.find((t) => t.id === selectedTopicId) ?? roomTopics[0];

  const roomHumanParticipants = useMemo(
    () =>
      room?.humans.map((id) => {
        const member = state.workspaceMembers.find((m) => m.userId === id);
        return {
          id,
          name: member?.name ?? (id === state.user?.id ? "You" : "Teammate"),
        };
      }) ?? [],
    [room?.humans, state.workspaceMembers, state.user?.id],
  );

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

  useEffect(() => {
    const onJump = (event: Event) => {
      const source = (event as CustomEvent<JumpSource>).detail;
      if (source.roomId && source.roomId !== roomId) {
        const params = new URLSearchParams();
        if (source.topicId) params.set("topic", source.topicId);
        if (source.messageId) params.set("message", source.messageId);
        router.push(`/rooms/${source.roomId}?${params.toString()}`);
        return;
      }
      if (source.topicId) setSelectedTopicId(source.topicId);
      if (source.messageId) {
        window.setTimeout(() => requestScrollToMessage(source.messageId!), 350);
      }
    };
    window.addEventListener(JUMP_TO_SOURCE_EVENT, onJump);
    return () => window.removeEventListener(JUMP_TO_SOURCE_EVENT, onJump);
  }, [roomId, router]);

  useEffect(() => {
    if (!messageFromUrl) return;
    window.setTimeout(() => requestScrollToMessage(messageFromUrl), 500);
  }, [messageFromUrl, selectedTopicId]);

  const createTopic = async (payload: {
    title: string;
    description: string;
    priority: TopicPriority;
    aiEmployeeIds: string[];
    starterMessage?: string;
    workflowType?: string;
  }) => {
    setTopicCreateError(null);
    setCreatingTopic(true);
    try {
      if (!isDm) {
        for (const employeeId of payload.aiEmployeeIds) {
          if (!room?.aiEmployees.includes(employeeId)) {
            actions.addEmployeeToRoom(roomId, employeeId);
          }
        }
      }

      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/rooms/${roomId}/topics`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...payload,
            aiEmployeeIds: isDm ? [] : payload.aiEmployeeIds,
            metadata: payload.workflowType ? { dmWorkflowType: payload.workflowType } : undefined,
          }),
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

  const renameTopicById = async (topic: RoomTopic, newTitle: string) => {
    if (!newTitle.trim() || isGeneralTopic(topic)) return;
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${topic.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to rename topic");
        }
        const { topic: updated } = await response.json();
        actions.upsertTopic(updated);
      } else {
        actions.upsertTopic({ ...topic, title: newTitle.trim(), updatedAt: new Date().toISOString() });
      }
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to rename topic");
      throw e;
    } finally {
      setTopicActionBusy(false);
    }
  };

  const archiveTopicById = async (topic: RoomTopic) => {
    if (isGeneralTopic(topic)) return;
    const prev = selectedTopic?.id;
    if (prev === topic.id) {
      await archiveTopic();
      return;
    }
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${topic.id}`, { method: "DELETE", headers });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to archive topic");
        }
        const { topic: updated } = await response.json();
        actions.upsertTopic(updated);
      } else {
        actions.upsertTopic({ ...topic, status: "archived", updatedAt: new Date().toISOString() });
      }
      if (selectedTopic?.id === topic.id) {
        const general = generalTopicForRoom(roomTopics, roomId);
        if (general) selectTopic(general.id);
      }
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to archive topic");
      throw e;
    } finally {
      setTopicActionBusy(false);
    }
  };

  const deleteTopicById = async (topic: RoomTopic) => {
    if (isGeneralTopic(topic)) return;
    setTopicActionError(null);
    setTopicActionBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const response = await fetch(`/api/topics/${topic.id}?permanent=true`, {
          method: "DELETE",
          headers,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to delete topic");
        }
      }
      actions.removeTopicPermanently(roomId, topic.id);
      await actions.refreshTopics(roomId);
      if (selectedTopic?.id === topic.id) {
        const general = generalTopicForRoom(roomTopics, roomId);
        if (general) selectTopic(general.id);
      }
    } catch (e) {
      setTopicActionError(e instanceof Error ? e.message : "Failed to delete topic");
      throw e;
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
        setSlashNotice("Commands: /task /memory /summarize /prd /report /brief /proposal /checklist /ask /archive /assign.");
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
    setComposerContextFiles([{ id: file.id, displayName: file.displayName }]);
    setComposerArtifactIntent(null);
    setComposerDraft(`${prefix}What does ${file.displayName} say? Summarize the key points with sources.`);
  };

  const generateReportFromFile = (file: WorkspaceFile) => {
    const teammate = roomEmployees.find((e) => e?.roleKey === "research" || e?.roleKey === "pm") ?? roomEmployees[0];
    const prefix = teammate ? `@${teammate.name} ` : "";
    setComposerContextFiles([{ id: file.id, displayName: file.displayName }]);
    setComposerArtifactIntent({ type: "report", label: "Generate report" });
    setComposerDraft(`${prefix}Turn ${file.displayName} into a report with sources.`);
  };

  const clearComposerContext = () => {
    setComposerContextFiles([]);
    setComposerArtifactIntent(null);
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

  const messageActions = useMemo<MessageActionHandlers>(
    () => ({
      onQuoteReply: (message: RoomMessage) => {
        setComposerDraft(quoteMessageText(message));
      },
      onCreateTaskFromMessage: (message: RoomMessage) => {
        if (!room || !selectedTopic) return;
        const title = taskTitleFromMessage(message.content);
        const description =
          message.content.trim().length > title.length ? message.content.trim() : undefined;
        actions.createTask({
          roomId,
          topicId: selectedTopic.id,
          title,
          description,
          status: "open",
          createdFrom: message.id,
          assigneeType: "human",
          assigneeId: state.user?.id ?? "user",
          priority: "medium",
        });
        void actions.refreshWorkLogForTopic(selectedTopic.id);
        setSlashNotice(`Task created: ${title}`);
        setTimeout(() => setSlashNotice(null), 3500);
      },
      onSaveMessageToMemory: async (message: RoomMessage) => {
        if (!room || !selectedTopic) return;
        const text = message.content.trim().slice(0, 2000);
        if (!text) return;
        const title = titleFromMessageContent(text);
        const sourceCitation = message.artifacts?.find(
          (artifact) => artifact.type === "file" && artifact.meta?.fileId,
        );

        try {
          if (backend === "supabase") {
            await saveFileMemorySuggestionClient(selectedTopic.id, {
              text,
              reason: `Saved from ${message.senderName}'s message`,
              sourceFileId: sourceCitation?.meta?.fileId,
              sourceChunkId: sourceCitation?.meta?.chunkId,
            });
          } else {
            actions.createMemory({
              roomId,
              topicId: selectedTopic.id,
              title,
              content: text,
              type: "general",
              status: "approved",
              createdByType: "human",
              createdById: state.user?.id ?? "user",
            });
          }

          void actions.refreshWorkLogForTopic(selectedTopic.id);
          setSlashNotice("Saved to memory.");
          setTimeout(() => setSlashNotice(null), 3500);
        } catch (error) {
          setTopicActionError(
            error instanceof Error ? error.message : "Unable to save to memory.",
          );
        }
      },
      onCreateArtifactFromMessage: async (message: RoomMessage) => {
        if (!room || !selectedTopic) return;
        const existing = firstArtifactFromMessage(message);
        if (existing) {
          window.dispatchEvent(
            new CustomEvent("adehq:open-artifact", {
              detail: { artifactId: existing.id, topicId: selectedTopic.id },
            }),
          );
          return;
        }

        const title = titleFromMessageContent(message.content);
        const { sourceFileIds, sourceChunkIds, sourceCitations } =
          artifactSourcesFromMessage(message);

        try {
          if (backend === "supabase") {
            const headers = await authHeaders();
            const response = await fetch("/api/artifacts", {
              method: "POST",
              headers,
              body: JSON.stringify({
                workspaceId: state.workspace.id,
                roomId,
                topicId: selectedTopic.id,
                title,
                artifactType: "note",
                contentMarkdown: message.content,
                sourceMessageIds: [message.id],
                sourceFileIds,
                sourceChunkIds,
                sourceCitations,
                status: "draft",
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.error ?? "Unable to create artifact.");
            }
            window.dispatchEvent(
              new CustomEvent("adehq:topic-artifacts-changed", {
                detail: { topicId: selectedTopic.id },
              }),
            );
            if (payload.artifact?.id) {
              window.dispatchEvent(
                new CustomEvent("adehq:open-artifact", {
                  detail: { artifactId: payload.artifact.id, topicId: selectedTopic.id },
                }),
              );
            }
          } else {
            setSlashNotice("Artifacts require Supabase backend.");
            setTimeout(() => setSlashNotice(null), 3500);
            return;
          }

          setSlashNotice(`Artifact created: ${title}`);
          setTimeout(() => setSlashNotice(null), 3500);
        } catch (error) {
          setTopicActionError(
            error instanceof Error ? error.message : "Unable to create artifact.",
          );
        }
      },
      onAskFollowUp: (message: RoomMessage) => {
        const employee = roomEmployees.find((e) => e?.id === message.senderId) ?? roomEmployees[0];
        const prefix = employee ? `@${employee.name} ` : "";
        setComposerContextFiles([]);
        setComposerArtifactIntent(null);
        setComposerDraft(`${prefix}Can you expand on this with more detail?\n\n`);
      },
      onOpenArtifactFromMessage: (message: RoomMessage) => {
        const artifact = firstArtifactFromMessage(message);
        if (!artifact || !selectedTopic) return;
        window.dispatchEvent(
          new CustomEvent("adehq:open-artifact", {
            detail: { artifactId: artifact.id, topicId: selectedTopic.id },
          }),
        );
      },
    }),
    [
      actions,
      backend,
      room,
      roomEmployees,
      roomId,
      selectedTopic,
      state.user?.id,
      state.workspace.id,
    ],
  );

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
          {!isDm && (
            <ParticipantAvatarStack
              humans={roomHumanParticipants}
              employees={roomEmployees.filter((e): e is NonNullable<typeof e> => !!e)}
              onClick={() => setMembersOpen(true)}
              className="mt-1"
            />
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
            room={room}
            dmEmployee={isDm ? roomEmployees[0] : undefined}
            roomHumans={roomHumanParticipants}
            roomEmployees={roomEmployees.filter((e): e is NonNullable<typeof e> => !!e)}
            onOpenMembers={!isDm ? () => setMembersOpen(true) : undefined}
            onSelect={selectTopic}
            onNewTopic={() => setNewTopicOpen(true)}
            onRenameTopic={renameTopicById}
            onArchiveTopic={archiveTopicById}
            onDeleteTopic={deleteTopicById}
            topicActionBusy={topicActionBusy}
          />
        </div>

        {isMayaDm ? (
          <MayaRoomCoordinator
            mayaRoomId={roomId}
            selectedTopic={selectedTopic}
            onSelectTopic={selectTopic}
          >
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
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
                  contextFiles={composerContextFiles}
                  artifactIntent={composerArtifactIntent}
                  onContextConsumed={clearComposerContext}
                  onSummarize={summarizeTopic}
                  summarizing={summarizing}
                  onAddEmployee={() => setAddEmployeeOpen(true)}
                  messageActions={messageActions}
                />
              </div>
              <div className="hidden w-[344px] shrink-0 xl:block">
                {selectedTopic ? (
                  <TopicPanel
                    topic={selectedTopic}
                    room={room}
                    employees={state.employees}
                    topicMembers={roomTopicMembers.filter((m) => m.topicId === selectedTopic.id)}
                    topicMessages={room.messages.filter((m) => m.topicId === selectedTopic.id)}
                    tasks={state.tasks}
                    memory={state.memory}
                    approvals={state.approvals}
                    workLog={state.workLog}
                    workspaceMembers={state.workspaceMembers}
                    isDm={isDm}
                    isMayaDm
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
                    onGenerateReportFromFile={generateReportFromFile}
                    onAddEmployee={() => setAddEmployeeOpen(true)}
                    summarizing={summarizing}
                    topicActionBusy={topicActionBusy}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-xs text-ink-3">
                    Select a topic to see context
                  </div>
                )}
              </div>
            </div>
          </MayaRoomCoordinator>
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
                contextFiles={composerContextFiles}
                artifactIntent={composerArtifactIntent}
                onContextConsumed={clearComposerContext}
                onSummarize={summarizeTopic}
                summarizing={summarizing}
                onAddEmployee={() => setAddEmployeeOpen(true)}
                messageActions={messageActions}
              />
        </div>

        <div className="hidden w-[344px] shrink-0 xl:block">
          {selectedTopic ? (
            <TopicPanel
              topic={selectedTopic}
              room={room}
              employees={state.employees}
              topicMembers={roomTopicMembers.filter((m) => m.topicId === selectedTopic.id)}
              topicMessages={room.messages.filter((m) => m.topicId === selectedTopic.id)}
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
              onGenerateReportFromFile={generateReportFromFile}
              onAddEmployee={() => setAddEmployeeOpen(true)}
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
        assignableEmployees={isDm ? [] : assignableEmployees}
        isDm={isDm}
        dmEmployee={isDm ? roomEmployees[0] : undefined}
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
      <RoomMembersPopover
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        room={room}
        employees={state.employees}
        workspaceMembers={state.workspaceMembers}
        currentUserId={state.user?.id}
      />
    </div>
  );
}
