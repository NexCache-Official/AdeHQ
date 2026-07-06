"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AIEmployee,
  AiParticipationMode,
  Approval,
  MemoryEntry,
  ProjectRoom,
  RoomMessage,
  RoomTopic,
  Task,
  TopicMember,
  WorkLogEvent,
  SavedArtifact,
  WorkspaceFile,
  WorkspaceMember,
} from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { TaskCard } from "./TaskCard";
import { MemoryCard } from "./MemoryCard";
import { ApprovalCard } from "./ApprovalCard";
import { WorkLogTimeline } from "./WorkLogTimeline";
import { ArtifactCard, FileArtifactCard } from "./ArtifactCard";
import { MessageMarkdown } from "./MessageMarkdown";
import { shouldShowWorkLogInTopic } from "@/lib/work-log-labels";
import { OPEN_PEOPLE_TAB_EVENT } from "@/components/people/RoomMembersPopover";
import { OrchestrationSidebarStatus } from "@/components/orchestration/OrchestrationSidebarStatus";
import { MayaTopicOverview } from "@/components/maya/MayaTopicOverview";
import { isActiveMemory } from "@/lib/memory/active-filter";
import { useDebugTrace } from "@/components/DebugProvider";
import { ArtifactViewerModal } from "@/components/artifacts/ArtifactViewerModal";
import { TopicSummaryPanel } from "@/components/topic-summary/TopicSummaryPanel";
import { MEMORY_UPDATED_EVENT, saveTopicSummaryToMemoryClient } from "@/lib/topic-summary/client";
import { useTopicSummary } from "@/components/topic-summary/useTopicSummary";
import { EmptyState } from "./States";
import { Button, Modal, ModalHeader } from "./ui";
import { authHeaders } from "@/lib/api/auth-client";
import { cn, formatTime, timeAgo } from "@/lib/utils";
import {
  getAiParticipationMode,
  isGeneralTopic,
  isSmartAssistMode,
  mainChatLabel,
  participationModeLabel,
  resolveParticipationModeForTopic,
} from "@/lib/topics";
import { getTopicAiControlState } from "@/lib/topic-ai-control";
import {
  ArchiveRestore,
  BookText,
  BrainCircuit,
  CheckSquare,
  ChevronDown,
  FileText,
  ListChecks,
  Loader2,
  Paperclip,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Users,
  WandSparkles,
} from "lucide-react";

const TABS = [
  { id: "overview", label: "Overview", icon: BookText },
  { id: "work", label: "Work", icon: CheckSquare },
  { id: "memory", label: "Memory", icon: BrainCircuit },
  { id: "files", label: "Files", icon: Paperclip },
  { id: "activity", label: "Activity", icon: ScrollText },
  { id: "people", label: "People", icon: Users },
] as const;

const PARTICIPATION_MODES: { id: AiParticipationMode; label: string; hint: string }[] = [
  {
    id: "smart_assist",
    label: "Smart assist",
    hint: "Continues active threads and answers relevant questions",
  },
  {
    id: "active_team",
    label: "Active team",
    hint: "More proactive - up to 3 relevant employees may contribute",
  },
  {
    id: "manual_only",
    label: "Manual only",
    hint: "AI responds only when @mentioned",
  },
  {
    id: "talent_observation",
    label: "Talent observation",
    hint: "Employees mostly observe and offer help when it matters",
  },
];

function modeIsSelected(current: AiParticipationMode, option: AiParticipationMode): boolean {
  if (option === "smart_assist") return isSmartAssistMode(current);
  if (option === "talent_observation") {
    return current === "talent_observation" || current === "silent_observation";
  }
  return current === option;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function artifactCardType(type: SavedArtifact["artifactType"]) {
  if (type === "research_summary" || type === "strategy_memo") return "report";
  if (type === "meeting_notes" || type === "checklist" || type === "email_draft" || type === "other") return "note";
  return type;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

export function TopicPanel({
  topic,
  room,
  employees,
  topicMembers,
  tasks,
  memory,
  approvals,
  workLog,
  workspaceMembers = [],
  isDm = false,
  isMayaDm = false,
  onSummarize,
  onArchive,
  onUnarchive,
  onDeletePermanently,
  onClearTopicChat,
  onClearRoomChat,
  onSaveSummaryToMemory,
  onWorkLogRefresh,
  onCreateTaskFromSummary,
  onParticipationChange,
  onAiControl,
  onAskAboutFile,
  onGenerateReportFromFile,
  topicMessages = [],
  onAddEmployee,
  summarizing,
  topicActionBusy,
}: {
  topic: RoomTopic;
  room: ProjectRoom;
  employees: AIEmployee[];
  topicMembers: TopicMember[];
  tasks: Task[];
  memory: MemoryEntry[];
  approvals: Approval[];
  workLog: WorkLogEvent[];
  workspaceMembers?: WorkspaceMember[];
  topicMessages?: RoomMessage[];
  isDm?: boolean;
  isMayaDm?: boolean;
  onSummarize: () => void;
  onArchive: () => void;
  onUnarchive?: () => void;
  onDeletePermanently?: () => void;
  onClearTopicChat?: () => void | Promise<void>;
  onClearRoomChat?: () => void | Promise<void>;
  onSaveSummaryToMemory: () => void;
  onWorkLogRefresh?: () => void;
  onCreateTaskFromSummary?: (title: string, ownerEmployeeId?: string) => void;
  onParticipationChange?: (mode: AiParticipationMode) => void;
  onAiControl?: (action: "stop_all" | "resume") => void;
  onAskAboutFile?: (file: WorkspaceFile) => void;
  onGenerateReportFromFile?: (file: WorkspaceFile) => void;
  onAddEmployee?: () => void;
  summarizing?: boolean;
  topicActionBusy?: boolean;
}) {
  const { actions } = useStore();
  const { enabled: debugEnabled } = useDebugTrace();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clearChatMenuOpen, setClearChatMenuOpen] = useState(false);
  const [clearChatPending, setClearChatPending] = useState<"topic" | "room" | null>(null);
  const [topicFiles, setTopicFiles] = useState<WorkspaceFile[]>([]);
  const [topicArtifacts, setTopicArtifacts] = useState<SavedArtifact[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<SavedArtifact | null>(null);
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const taskInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const openPeople = () => setTab("people");
    window.addEventListener(OPEN_PEOPLE_TAB_EVENT, openPeople);
    return () => window.removeEventListener(OPEN_PEOPLE_TAB_EVENT, openPeople);
  }, []);
  const isMainChat = isGeneralTopic(topic);
  const displayTitle = isMainChat ? mainChatLabel(isDm) : topic.title;
  const participation = getAiParticipationMode(topic);
  const aiControl = getTopicAiControlState(topic);
  const isArchived = topic.status === "archived";
  const canClearTopicChat = !isArchived && Boolean(onClearTopicChat);
  const canClearRoomChat = !isArchived && Boolean(onClearRoomChat) && !isDm;
  const showClearChatActions = canClearTopicChat || canClearRoomChat;
  const {
    summary: topicSummary,
    loading: summaryLoading,
    refreshing: summaryRefreshing,
    error: summaryError,
    refresh: refreshTopicSummary,
  } = useTopicSummary(topic.id);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFileError(null);
    try {
      const body = await apiJson<{ files: WorkspaceFile[] }>(`/api/topics/${topic.id}/files`);
      setTopicFiles(body.files ?? []);
    } catch (error) {
      setTopicFiles([]);
      setFileError(error instanceof Error ? error.message : "Could not load files.");
    } finally {
      setFilesLoading(false);
    }
  }, [topic.id]);

  const loadArtifacts = useCallback(async () => {
    setArtifactsLoading(true);
    setArtifactError(null);
    try {
      const body = await apiJson<{ artifacts: SavedArtifact[] }>(`/api/topics/${topic.id}/artifacts`);
      setTopicArtifacts(body.artifacts ?? []);
    } catch (error) {
      setTopicArtifacts([]);
      setArtifactError(error instanceof Error ? error.message : "Could not load artifacts.");
    } finally {
      setArtifactsLoading(false);
    }
  }, [topic.id]);

  useEffect(() => {
    const openArtifact = async (event: Event) => {
      const detail = (event as CustomEvent<{ artifactId?: string; topicId?: string }>).detail;
      if (!detail?.artifactId || detail.topicId !== topic.id) return;
      try {
        const body = await apiJson<{ artifact: SavedArtifact }>(`/api/artifacts/${detail.artifactId}`);
        setSelectedArtifact(body.artifact);
        setTab("files");
      } catch {
        // non-blocking
      }
    };
    window.addEventListener("adehq:open-artifact", openArtifact);
    return () => window.removeEventListener("adehq:open-artifact", openArtifact);
  }, [topic.id]);

  useEffect(() => {
    void loadFiles();
    void loadArtifacts();

    const refreshFiles = (event: Event) => {
      const detail = (event as CustomEvent<{ topicId?: string }>).detail;
      if (!detail?.topicId || detail.topicId === topic.id) void loadFiles();
    };
    const refreshArtifacts = (event: Event) => {
      const detail = (event as CustomEvent<{ topicId?: string }>).detail;
      if (!detail?.topicId || detail.topicId === topic.id) void loadArtifacts();
    };

    window.addEventListener("adehq:topic-files-changed", refreshFiles);
    window.addEventListener("adehq:topic-artifacts-changed", refreshArtifacts);
    return () => {
      window.removeEventListener("adehq:topic-files-changed", refreshFiles);
      window.removeEventListener("adehq:topic-artifacts-changed", refreshArtifacts);
    };
  }, [loadArtifacts, loadFiles, topic.id]);

  const handleSummarize = () => {
    void refreshTopicSummary(true).then((result) => {
      if (result?.refreshed) onWorkLogRefresh?.();
    });
  };

  const handleRefreshSummary = () => {
    void refreshTopicSummary(true).then((result) => {
      if (result?.refreshed) onWorkLogRefresh?.();
    });
  };

  const createSummaryArtifact = async (file: WorkspaceFile) => {
    setFileBusyId(file.id);
    setArtifactError(null);
    try {
      const content =
        file.extractedText?.trim() ||
        file.textPreview?.trim() ||
        "No extractable text was found for this file.";
      const clipped = content.length > 4200 ? `${content.slice(0, 4200).trim()}\n\n...` : content;
      const body = await apiJson<{ artifact: SavedArtifact }>("/api/artifacts", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: file.workspaceId,
          roomId: room.id,
          topicId: topic.id,
          title: `${file.displayName} summary`,
          artifactType: "research_summary",
          contentMarkdown: `# ${file.displayName} summary\n\n${clipped}`,
          sourceFileIds: [file.id],
          sourceCitations: file.textPreview
            ? [
                {
                  fileId: file.id,
                  fileName: file.displayName,
                  snippet: file.textPreview,
                },
              ]
            : [],
        }),
      });
      setTopicArtifacts((current) => [body.artifact, ...current.filter((a) => a.id !== body.artifact.id)]);
      setTab("files");
      window.dispatchEvent(new CustomEvent("adehq:topic-artifacts-changed", { detail: { topicId: topic.id } }));
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : "Could not create artifact.");
    } finally {
      setFileBusyId(null);
    }
  };

  const deleteFile = async (file: WorkspaceFile) => {
    setFileBusyId(file.id);
    setFileError(null);
    try {
      await apiJson(`/api/files/${file.id}`, { method: "DELETE" });
      await loadFiles();
      window.dispatchEvent(new CustomEvent("adehq:topic-files-changed", { detail: { topicId: topic.id } }));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not remove file.");
    } finally {
      setFileBusyId(null);
    }
  };

  const saveArtifact = async (artifact: SavedArtifact) => {
    setArtifactBusyId(artifact.id);
    setArtifactError(null);
    try {
      const body = await apiJson<{ artifact: SavedArtifact }>(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "saved" }),
      });
      setTopicArtifacts((current) => current.map((item) => (item.id === artifact.id ? body.artifact : item)));
      if (selectedArtifact?.id === artifact.id) setSelectedArtifact(body.artifact);
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : "Could not save artifact.");
    } finally {
      setArtifactBusyId(null);
    }
  };

  const saveArtifactToMemory = async (artifact: SavedArtifact) => {
    setArtifactBusyId(artifact.id);
    setArtifactError(null);
    try {
      const result = await apiJson<{ memory: MemoryEntry; duplicate?: boolean }>(
        `/api/artifacts/${artifact.id}/save-memory`,
        { method: "POST" },
      );
      if (result.memory) {
        actions.mergeMemoryEntry(result.memory);
        window.dispatchEvent(
          new CustomEvent(MEMORY_UPDATED_EVENT, {
            detail: { memoryId: result.memory.id, memory: result.memory },
          }),
        );
      }
      await loadArtifacts();
      setSelectedArtifact((prev) =>
        prev?.id === artifact.id
          ? { ...prev, memorySavedAt: new Date().toISOString(), status: "saved" }
          : prev,
      );
      onWorkLogRefresh?.();
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : "Could not save artifact to memory.");
    } finally {
      setArtifactBusyId(null);
    }
  };

  const topicEmployees = topicMembers
    .filter((m) => m.memberType === "ai")
    .map((m) => employees.find((e) => e.id === m.memberId))
    .filter((e): e is AIEmployee => !!e);

  const topicTasks = tasks.filter((t) => t.topicId === topic.id);
  const topicMemory = memory.filter(
    (m) =>
      isActiveMemory(m) &&
      (m.topicId === topic.id || (m.roomId === room.id && m.status === "pinned" && !m.topicId)),
  );
  const topicApprovals = approvals.filter((a) => a.topicId === topic.id);
  const topicLog = workLog
    .filter((w) => w.topicId === topic.id)
    .filter((w) => shouldShowWorkLogInTopic(w.action, w.summary, { isDm, debugEnabled }))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const roomAiEmployees = room.aiEmployees
    .map((id) => employees.find((e) => e.id === id))
    .filter((e): e is AIEmployee => !!e);

  const topicEmployeeIds = new Set(topicEmployees.map((e) => e.id));
  const availableInRoom = roomAiEmployees.filter((e) => !topicEmployeeIds.has(e.id));

  const humanParticipants = room.humans
    .map((id) => {
      const member = workspaceMembers.find((m) => m.userId === id);
      return {
        id,
        name: member?.name ?? (id === room.humans[0] ? "You" : "Teammate"),
        email: member?.email,
      };
    })
    .filter((h) => h.id);

  const counts: Record<string, number> = {
    work:
      topicTasks.filter((t) => t.status !== "done").length +
      topicApprovals.filter((a) => a.status === "pending").length,
    files: topicFiles.length + topicArtifacts.length,
    memory: topicMemory.length,
    activity: topicLog.length,
    people: humanParticipants.length + topicEmployees.length,
  };

  const openTaskCount = topicTasks.filter((t) => t.status !== "done").length;
  const workstreamSubtitle = isDm
    ? "Direct message"
    : isMainChat
      ? "Main room discussion"
      : `${room.name} workstream`;
  const panelTitle = isMainChat ? mainChatLabel(isDm) : displayTitle;
  const lastUpdatedLabel = topicSummary?.lastRefreshedAt
    ? timeAgo(topicSummary.lastRefreshedAt)
    : topic.updatedAt
      ? timeAgo(topic.updatedAt)
      : null;

  const handleMemorySaved = (saved?: MemoryEntry, duplicate?: boolean) => {
    if (saved) actions.mergeMemoryEntry(saved);
    onWorkLogRefresh?.();
    onSaveSummaryToMemory?.();
    void duplicate;
  };

  const handleQuickSaveMemory = async () => {
    if (!topicSummary?.summary?.trim()) {
      setTab("overview");
      return;
    }
    try {
      const result = await saveTopicSummaryToMemoryClient(topic.id);
      if (result.memory) actions.mergeMemoryEntry(result.memory);
      onWorkLogRefresh?.();
    } catch {
      // TopicSummaryPanel shows errors for detailed saves
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <nav className="flex w-[50px] shrink-0 flex-col items-center gap-1 border-r border-border-2 py-3">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            title={tb.label}
            onClick={() => setTab(tb.id)}
            className={cn(
              "insbtn relative flex h-9 w-9 items-center justify-center rounded-[10px] transition-all duration-150",
              tab === tb.id ? "ins-tab-active" : "text-ink-3 hover:bg-muted hover:text-ink-2",
            )}
          >
            <tb.icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
            {counts[tb.id] > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-bold text-white">
                {counts[tb.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-2 px-4 pb-3 pt-[15px]">
          <h2 className="truncate text-[14.5px] font-bold tracking-tight text-ink">{panelTitle}</h2>
          <p className="text-[11.5px] text-ink-2">{workstreamSubtitle}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
            <span>
              {topicEmployees.length} employee{topicEmployees.length === 1 ? "" : "s"} active
            </span>
            <span>
              {openTaskCount} open task{openTaskCount === 1 ? "" : "s"}
            </span>
            <span>
              {topicMemory.length} saved memor{topicMemory.length === 1 ? "y" : "ies"}
            </span>
            {lastUpdatedLabel && <span>Updated {lastUpdatedLabel}</span>}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSummarize}
              disabled={summarizing || summaryRefreshing || summaryLoading || isArchived}
            >
              {summarizing || summaryRefreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Summarize
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTab("work");
                requestAnimationFrame(() => taskInputRef.current?.focus());
              }}
              disabled={isArchived}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Create task
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleQuickSaveMemory()}>
              <BrainCircuit className="h-3.5 w-3.5" />
              Save memory
            </Button>
            {onAddEmployee && !isDm && (
              <Button variant="ghost" size="sm" onClick={onAddEmployee}>
                <Plus className="h-3.5 w-3.5" />
                Add employee
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3.5">
          {tab === "overview" && (
            <div className="space-y-4">
              {isArchived && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This topic is archived. Restore it to continue working, or delete it permanently to
                  free the title and remove all history.
                </div>
              )}
              {!isMainChat &&
                (isArchived ? (
                  <div className="flex flex-wrap gap-1.5">
                    {onUnarchive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onUnarchive}
                        disabled={topicActionBusy}
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" /> Restore topic
                      </Button>
                    )}
                    {onDeletePermanently && !confirmDelete && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmDelete(true)}
                        disabled={topicActionBusy}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete permanently
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={onArchive} disabled={topicActionBusy}>
                      Archive
                    </Button>
                    {onDeletePermanently && !confirmDelete && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="text-xs text-ink-3 underline-offset-2 hover:text-red-600 hover:underline"
                      >
                        Delete topic permanently…
                      </button>
                    )}
                  </div>
                ))}
              {showClearChatActions && !clearChatPending && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (canClearTopicChat && !canClearRoomChat) {
                        setClearChatPending("topic");
                        return;
                      }
                      setClearChatMenuOpen((open) => !open);
                    }}
                    disabled={topicActionBusy}
                    className="inline-flex items-center gap-1 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                  >
                    Clear messages…
                    {canClearRoomChat ? <ChevronDown className="h-3 w-3" /> : null}
                  </button>
                  {clearChatMenuOpen && (
                    <>
                      <button
                        type="button"
                        aria-label="Close clear messages menu"
                        className="fixed inset-0 z-10"
                        onClick={() => setClearChatMenuOpen(false)}
                      />
                      <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                        {canClearTopicChat && (
                          <button
                            type="button"
                            disabled={topicActionBusy}
                            onClick={() => {
                              setClearChatPending("topic");
                              setClearChatMenuOpen(false);
                            }}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-muted"
                          >
                            <span className="text-sm font-medium text-ink">This topic only</span>
                            <span className="text-xs text-ink-3">
                              Clear messages in <strong>{displayTitle}</strong>
                            </span>
                          </button>
                        )}
                        {canClearRoomChat && (
                          <button
                            type="button"
                            disabled={topicActionBusy}
                            onClick={() => {
                              setClearChatPending("room");
                              setClearChatMenuOpen(false);
                            }}
                            className="flex w-full flex-col items-start gap-0.5 border-t border-border px-3 py-2.5 text-left hover:bg-amber-50"
                          >
                            <span className="text-sm font-medium text-amber-950">Entire room</span>
                            <span className="text-xs text-amber-900/80">
                              Clear messages in every topic (admin)
                            </span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {clearChatPending === "topic" && onClearTopicChat && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <p className="text-sm text-ink">
                    Clear all messages in <strong>{displayTitle}</strong>? The{" "}
                    {isMainChat ? "conversation" : "topic"} stays — chat history and the workstream
                    summary are removed. Saved memory, tasks, files, and work log are kept.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={topicActionBusy}
                      onClick={() => {
                        void onClearTopicChat();
                        setClearChatPending(null);
                      }}
                    >
                      Clear this topic
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setClearChatPending(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {clearChatPending === "room" && onClearRoomChat && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-950">
                    Clear messages in <strong>every topic</strong> in this room? Topics, saved memory,
                    tasks, and files stay — only chat history and workstream summaries are removed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={topicActionBusy}
                      onClick={() => {
                        void onClearRoomChat();
                        setClearChatPending(null);
                      }}
                    >
                      Clear entire room
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setClearChatPending(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {!isMainChat && isArchived && confirmDelete && onDeletePermanently && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-800">
                    Delete <strong>{topic.title}</strong> permanently? This removes all messages,
                    tasks, memory, approvals, and work log entries for this topic.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        onDeletePermanently();
                        setConfirmDelete(false);
                      }}
                      disabled={topicActionBusy}
                    >
                      Yes, delete forever
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {!isMainChat && !isArchived && confirmDelete && onDeletePermanently && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-800">
                    Delete <strong>{topic.title}</strong> permanently? This cannot be undone.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        onDeletePermanently();
                        setConfirmDelete(false);
                      }}
                      disabled={topicActionBusy}
                    >
                      Yes, delete forever
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {isMayaDm && (
                <MayaTopicOverview topic={topic} employees={employees} />
              )}
              {onParticipationChange && !isMayaDm && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-ink-2 hover:bg-surface [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
                    <span className="font-medium">AI participation</span>
                    <span className="truncate text-ink-3">
                      — {aiControl.aiStopped ? "Stopped" : participationModeLabel(participation)}
                    </span>
                  </summary>
                  <div className="mt-1.5 space-y-1.5 rounded-lg border border-border bg-surface p-2">
                    {aiControl.aiStopped && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        All AI activity is stopped in this topic.
                      </p>
                    )}
                    <div className="flex flex-col gap-1">
                      {PARTICIPATION_MODES.map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() =>
                            onParticipationChange(resolveParticipationModeForTopic(topic, mode.id))
                          }
                          disabled={aiControl.aiStopped}
                          className={cn(
                            "rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                            modeIsSelected(participation, mode.id)
                              ? "border-accent-500/40 bg-accent-500/10 text-accent-800"
                              : "border-border bg-surface text-ink-2 hover:border-[var(--border)]",
                            aiControl.aiStopped && "opacity-50",
                          )}
                        >
                          <div className="font-medium">{mode.label}</div>
                          <div className="text-[10px] text-ink-3">{mode.hint}</div>
                        </button>
                      ))}
                    </div>
                    {onAiControl && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {aiControl.aiStopped ? (
                          <Button variant="secondary" size="sm" onClick={() => onAiControl("resume")}>
                            Resume AI
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onAiControl("stop_all")}>
                            Stop all AI
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              )}
              <TopicSummaryPanel
                topicId={topic.id}
                roomId={room.id}
                room={room}
                topic={topic}
                isDm={isDm}
                summary={topicSummary}
                employees={topicEmployees}
                messages={topicMessages}
                loading={summaryLoading}
                refreshing={summaryRefreshing}
                error={summaryError}
                onRefresh={handleRefreshSummary}
                onCreateTask={onCreateTaskFromSummary}
                onMemorySaved={handleMemorySaved}
                compactActions
              />
            </div>
          )}

          {tab === "work" && (
            <div className="space-y-4">
              <section>
                <div className="section-title mb-1.5">Tasks</div>
                {onCreateTaskFromSummary && !isArchived && (
                  <form
                    className="mb-2 flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const title = newTaskTitle.trim();
                      if (!title) return;
                      onCreateTaskFromSummary(title);
                      setNewTaskTitle("");
                    }}
                  >
                    <input
                      ref={taskInputRef}
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Add a task…"
                      className="input-field h-8 flex-1 text-[13px]"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={!newTaskTitle.trim()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </form>
                )}
                {topicTasks.length === 0 ? (
                  <p className="text-xs text-ink-3">No tasks in this topic yet.</p>
                ) : (
                  <div className="space-y-2">
                    {topicTasks.map((t) => (
                      <TaskCard key={t.id} task={t} compact deletable={!isArchived} />
                    ))}
                  </div>
                )}
              </section>
              <section>
                <div className="section-title mb-1.5">Approvals</div>
                {topicApprovals.length === 0 ? (
                  <p className="text-xs text-ink-3">No approvals in this topic.</p>
                ) : (
                  <div className="space-y-2">
                    {topicApprovals.map((a) => (
                      <ApprovalCard key={a.id} approval={a} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === "memory" && (
            <div className="space-y-3">
              {topicMemory.length === 0 ? (
                <EmptyState icon={BrainCircuit} title="No memory" description="Topic and pinned room memory appears here." />
              ) : (
                topicMemory.map((m) => <MemoryCard key={m.id} memory={m} />)
              )}
            </div>
          )}

          {tab === "files" && (
            <div className="space-y-4">
              <section>
                <div className="section-title mb-1.5">Uploaded files</div>
              {filesLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading files…
                </div>
              ) : topicFiles.length === 0 ? (
                <EmptyState
                  icon={Paperclip}
                  title="No files"
                  description="Upload a PDF, DOCX, spreadsheet, or CSV so your AI employees can work from source material."
                />
              ) : (
                topicFiles.map((file) => {
                  const isBusy = fileBusyId === file.id;
                  const canCreateArtifact = file.status === "ready" && file.parseStatus !== "no_text";
                  return (
                    <div key={file.id} className="rounded-xl border border-border bg-surface p-2.5">
                      <FileArtifactCard
                        fileName={file.displayName}
                        extension={file.extension}
                        size={formatFileSize(file.sizeBytes)}
                        status={file.status === "failed" ? "failed" : file.status === "ready" ? "ready" : "processing"}
                        className="border-border-2 shadow-none"
                      />
                      {file.errorMessage && (
                        <p className="mt-2 text-[11px] text-red-600">{file.errorMessage}</p>
                      )}
                      {file.textPreview && (
                        <p className="mt-2 line-clamp-3 text-[11.5px] leading-relaxed text-ink-3">
                          {file.textPreview}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {onAskAboutFile && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onAskAboutFile(file)}
                          >
                            Ask about this
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => (onGenerateReportFromFile ? onGenerateReportFromFile(file) : void createSummaryArtifact(file))}
                          disabled={!canCreateArtifact || isBusy}
                        >
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                          Generate report
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void deleteFile(file)}
                          disabled={isBusy}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
              {fileError && <p className="text-xs text-red-600">{fileError}</p>}
              </section>
              <section>
                <div className="section-title mb-1.5">Artifacts</div>
              {artifactsLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading artifacts…
                </div>
              ) : topicArtifacts.length === 0 ? (
                <p className="text-xs text-ink-3">No generated artifacts yet.</p>
              ) : (
                topicArtifacts.map((artifact) => {
                  const isBusy = artifactBusyId === artifact.id;
                  return (
                    <div key={artifact.id} className="mb-3 space-y-2">
                      <ArtifactCard
                        title={artifact.title}
                        type={artifactCardType(artifact.artifactType)}
                        timestamp={artifact.createdAt}
                        sourceCount={
                          artifact.sourceFileIds.length +
                          artifact.sourceMessageIds.length +
                          artifact.sourceChunkIds.length
                        }
                        status={artifact.status === "saved" ? "saved" : "draft"}
                        onOpen={() => setSelectedArtifact(artifact)}
                        onSave={artifact.status === "saved" ? undefined : () => void saveArtifact(artifact)}
                        onCopy={() => void navigator.clipboard.writeText(artifact.contentMarkdown)}
                        className="mt-0 max-w-none"
                      />
                      <div className="flex flex-wrap gap-1.5 pl-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void saveArtifactToMemory(artifact)}
                          disabled={isBusy || !!artifact.memorySavedAt}
                        >
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
                          {artifact.memorySavedAt ? "In memory" : "Save to memory"}
                        </Button>
                        {artifact.memorySavedAt && (
                          <span className="self-center text-[11px] text-ink-3">
                            {formatTime(artifact.memorySavedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {artifactError && <p className="text-xs text-red-600">{artifactError}</p>}
              </section>
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-3">
              {topicLog.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title="No activity yet"
                  description="Meaningful work in this topic will show up here."
                />
              ) : (
                <WorkLogTimeline events={topicLog} compact debugEnabled={debugEnabled} />
              )}
              {debugEnabled && !isDm && (
                <details className="rounded-xl border border-dashed border-border bg-muted/30 p-2">
                  <summary className="cursor-pointer px-1 py-0.5 text-[11px] font-medium text-ink-3">
                    Debug orchestration
                  </summary>
                  <div className="mt-2">
                    <OrchestrationSidebarStatus topicId={topic.id} />
                  </div>
                </details>
              )}
            </div>
          )}

          {tab === "people" && (
            <div className="space-y-3">
              {isDm ? (
                <>
                  <div className="section-title mb-1">Direct message</div>
                  {topicEmployees[0] ? (
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5">
                      <EmployeeAvatar employee={topicEmployees[0]} size="sm" />
                      <div>
                        <div className="text-sm font-medium text-ink">{topicEmployees[0].name}</div>
                        <div className="text-[11px] text-ink-3">{topicEmployees[0].role}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-3">No AI employee linked to this DM.</p>
                  )}
                  <p className="text-[11px] text-ink-3">
                    This is a 1:1 conversation between you and this AI employee.
                  </p>
                </>
              ) : isMainChat ? (
                <>
                  <div className="section-title mb-1">In this room</div>
                  <p className="mb-2 text-[11px] text-ink-3">
                    Everyone in {room.name} can see General Chat.
                  </p>
                  {humanParticipants.map((human) => (
                    <div
                      key={human.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
                    >
                      <HumanAvatar name={human.name ?? "Teammate"} size="sm" />
                      <div>
                        <div className="text-sm font-medium text-ink">{human.name}</div>
                        {human.email && (
                          <div className="text-[11px] text-ink-3">{human.email}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {roomAiEmployees.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5">
                      <EmployeeAvatar employee={e} size="sm" />
                      <div>
                        <div className="text-sm font-medium text-ink">{e.name}</div>
                        <div className="text-[11px] text-ink-3">{e.role}</div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="section-title mb-1">Working in this topic</div>
                  {topicEmployees.length === 0 ? (
                    <p className="text-xs text-ink-3">No AI employees assigned to this topic yet.</p>
                  ) : (
                    topicEmployees.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted p-2.5">
                        <EmployeeAvatar employee={e} size="sm" />
                        <div>
                          <div className="text-sm font-medium text-ink">{e.name}</div>
                          <div className="text-[11px] text-ink-3">{e.role}</div>
                        </div>
                      </div>
                    ))
                  )}
                  {humanParticipants.length > 0 && (
                    <>
                      <div className="section-title mb-1 mt-3">Humans in room</div>
                      {humanParticipants.map((human) => (
                        <div
                          key={human.id}
                          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
                        >
                          <HumanAvatar name={human.name ?? "Teammate"} size="sm" />
                          <div>
                            <div className="text-sm font-medium text-ink">{human.name}</div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  {availableInRoom.length > 0 && (
                    <details className="mt-2 rounded-xl border border-border bg-muted/20 p-2">
                      <summary className="cursor-pointer px-1 py-0.5 text-[11px] font-medium text-ink-3">
                        Available in room ({availableInRoom.length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {availableInRoom.map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <EmployeeAvatar employee={e} size="sm" showStatus={false} />
                              <div>
                                <div className="text-sm font-medium text-ink">{e.name}</div>
                                <div className="text-[10px] text-ink-3">{e.role}</div>
                              </div>
                            </div>
                            {onAddEmployee && (
                              <Button variant="secondary" size="sm" className="h-7 text-[10px]" onClick={onAddEmployee}>
                                Add to topic
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {selectedArtifact && (
        <ArtifactViewerModal
          artifact={selectedArtifact}
          createdByName={employees.find((e) => e.id === selectedArtifact.createdById)?.name}
          onClose={() => setSelectedArtifact(null)}
          onSave={() => void saveArtifact(selectedArtifact)}
          onSaveToMemory={() => void saveArtifactToMemory(selectedArtifact)}
          onCreateTask={
            onCreateTaskFromSummary
              ? () => onCreateTaskFromSummary(`Follow up: ${selectedArtifact.title}`)
              : undefined
          }
          busy={artifactBusyId === selectedArtifact.id}
          memorySaved={Boolean(selectedArtifact.memorySavedAt)}
        />
      )}
    </div>
  );
}
