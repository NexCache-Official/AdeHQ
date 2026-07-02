"use client";

import { useState } from "react";
import type {
  AIEmployee,
  AiParticipationMode,
  Approval,
  MemoryEntry,
  ProjectRoom,
  RoomTopic,
  Task,
  TopicMember,
  WorkLogEvent,
  WorkspaceMember,
} from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { TaskCard } from "./TaskCard";
import { MemoryCard } from "./MemoryCard";
import { ApprovalCard } from "./ApprovalCard";
import { WorkLogTimeline } from "./WorkLogTimeline";
import { OrchestrationSidebarStatus } from "@/components/orchestration/OrchestrationSidebarStatus";
import { TopicSummaryPanel } from "@/components/topic-summary/TopicSummaryPanel";
import { useTopicSummary } from "@/components/topic-summary/useTopicSummary";
import { EmptyState } from "./States";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
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
  Loader2,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

const TABS = [
  { id: "overview", label: "Overview", icon: BookText },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "memory", label: "Memory", icon: BrainCircuit },
  { id: "approvals", label: "Approvals", icon: ShieldAlert },
  { id: "activity", label: "Work Log", icon: ScrollText },
  { id: "people", label: "People", icon: Users },
] as const;

const PARTICIPATION_MODES: { id: AiParticipationMode; label: string; hint: string }[] = [
  {
    id: "smart_assist",
    label: "Smart assist",
    hint: "AI joins when relevant — @mentions, greetings, and role matches",
  },
  {
    id: "active_team",
    label: "Active team",
    hint: "More proactive — up to 2 AI employees may contribute",
  },
  {
    id: "manual_only",
    label: "Manual only",
    hint: "AI responds only when @mentioned",
  },
  {
    id: "silent_observation",
    label: "Silent observation",
    hint: "AI tracks context quietly; speaks only when @mentioned",
  },
];

function modeIsSelected(current: AiParticipationMode, option: AiParticipationMode): boolean {
  if (option === "smart_assist") return isSmartAssistMode(current);
  return current === option;
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
  onSummarize,
  onArchive,
  onUnarchive,
  onDeletePermanently,
  onSaveSummaryToMemory,
  onWorkLogRefresh,
  onCreateTaskFromSummary,
  onParticipationChange,
  onAiControl,
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
  isDm?: boolean;
  onSummarize: () => void;
  onArchive: () => void;
  onUnarchive?: () => void;
  onDeletePermanently?: () => void;
  onSaveSummaryToMemory: () => void;
  onWorkLogRefresh?: () => void;
  onCreateTaskFromSummary?: (title: string, ownerEmployeeId?: string) => void;
  onParticipationChange?: (mode: AiParticipationMode) => void;
  onAiControl?: (action: "stop_all" | "resume") => void;
  summarizing?: boolean;
  topicActionBusy?: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMainChat = isGeneralTopic(topic);
  const displayTitle = isMainChat ? mainChatLabel(isDm) : topic.title;
  const participation = getAiParticipationMode(topic);
  const aiControl = getTopicAiControlState(topic);
  const isArchived = topic.status === "archived";
  const {
    summary: topicSummary,
    loading: summaryLoading,
    refreshing: summaryRefreshing,
    error: summaryError,
    refresh: refreshTopicSummary,
  } = useTopicSummary(topic.id);

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

  const topicEmployees = topicMembers
    .filter((m) => m.memberType === "ai")
    .map((m) => employees.find((e) => e.id === m.memberId))
    .filter((e): e is AIEmployee => !!e);

  const topicTasks = tasks.filter((t) => t.topicId === topic.id);
  const topicMemory = memory.filter(
    (m) => m.topicId === topic.id || (m.roomId === room.id && m.status === "pinned" && !m.topicId),
  );
  const topicApprovals = approvals.filter((a) => a.topicId === topic.id);
  const topicLog = workLog
    .filter((w) => w.topicId === topic.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

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
    tasks: topicTasks.length,
    memory: topicMemory.length,
    approvals: topicApprovals.filter((a) => a.status === "pending").length,
    activity: topicLog.length,
    people: humanParticipants.length + topicEmployees.length,
  };

  const insTitle = isDm
    ? topicEmployees[0]?.name ?? displayTitle
    : `${room.name} · ${displayTitle}`;
  const insSub = isDm
    ? topicEmployees[0]?.role ?? "Direct message"
    : "Topic workstream";

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
          <h2 className="truncate text-[14.5px] font-bold tracking-tight text-ink">{insTitle}</h2>
          <p className="text-[11.5px] text-ink-2">{insSub}</p>
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
              <div className="flex flex-wrap gap-1.5">
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
                {!isMainChat &&
                  (isArchived ? (
                    <>
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
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onArchive}
                      disabled={topicActionBusy}
                    >
                      Archive
                    </Button>
                  ))}
              </div>
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
              {!isMainChat && !isArchived && onDeletePermanently && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-ink-3 underline-offset-2 hover:text-red-600 hover:underline"
                >
                  Delete topic permanently…
                </button>
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
              {onParticipationChange && (
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
              {!isDm && <OrchestrationSidebarStatus topicId={topic.id} />}
              <TopicSummaryPanel
                topicId={topic.id}
                summary={topicSummary}
                employees={topicEmployees}
                loading={summaryLoading}
                refreshing={summaryRefreshing}
                error={summaryError}
                onRefresh={handleRefreshSummary}
                onCreateTask={onCreateTaskFromSummary}
                onMemorySaved={onSaveSummaryToMemory}
              />
              <section>
                <div className="section-title mb-1.5">Open tasks</div>
                {topicTasks.filter((t) => t.status !== "done").length === 0 ? (
                  <p className="text-xs text-ink-3">No open tasks in this topic.</p>
                ) : (
                  <div className="space-y-2">
                    {topicTasks
                      .filter((t) => t.status !== "done")
                      .slice(0, 3)
                      .map((t) => (
                        <TaskCard key={t.id} task={t} compact />
                      ))}
                  </div>
                )}
              </section>
              <section>
                <div className="section-title mb-1.5">Pending approvals</div>
                {topicApprovals.filter((a) => a.status === "pending").length === 0 ? (
                  <p className="text-xs text-ink-3">No pending approvals.</p>
                ) : (
                  <div className="space-y-2">
                    {topicApprovals
                      .filter((a) => a.status === "pending")
                      .map((a) => (
                        <ApprovalCard key={a.id} approval={a} />
                      ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === "tasks" && (
            <div className="space-y-2">
              {topicTasks.length === 0 ? (
                <EmptyState icon={CheckSquare} title="No tasks" description="Tasks linked to this topic appear here." />
              ) : (
                topicTasks.map((t) => <TaskCard key={t.id} task={t} compact />)
              )}
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

          {tab === "approvals" && (
            <div className="space-y-3">
              {topicApprovals.length === 0 ? (
                <EmptyState icon={ShieldAlert} title="No approvals" description="Approval requests for this topic appear here." />
              ) : (
                topicApprovals.map((a) => <ApprovalCard key={a.id} approval={a} />)
              )}
            </div>
          )}

          {tab === "activity" && (
            <div>
              {topicLog.length === 0 ? (
                <EmptyState icon={ScrollText} title="No activity" description="Work log events for this topic appear here." />
              ) : (
                <WorkLogTimeline events={topicLog} compact />
              )}
            </div>
          )}

          {tab === "people" && (
            <div className="space-y-2">
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
              ) : (
                <>
                  <div className="section-title mb-1">People in this room</div>
                  {humanParticipants.length === 0 ? (
                    <p className="text-xs text-ink-3">No human members listed.</p>
                  ) : (
                    humanParticipants.map((human) => (
                      <div
                        key={human.id}
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-ink-2">
                          {(human.name ?? "U").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">{human.name}</div>
                          {human.email && (
                            <div className="text-[11px] text-ink-3">{human.email}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div className="section-title mb-1 mt-3">AI employees in room</div>
                  {room.aiEmployees.length === 0 ? (
                    <p className="text-xs text-ink-3">No AI employees in this room.</p>
                  ) : (
                    room.aiEmployees
                      .map((id) => employees.find((e) => e.id === id))
                      .filter((e): e is AIEmployee => !!e)
                      .map((e) => (
                        <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5">
                          <EmployeeAvatar employee={e} size="sm" />
                          <div>
                            <div className="text-sm font-medium text-ink">{e.name}</div>
                            <div className="text-[11px] text-ink-3">{e.role}</div>
                          </div>
                        </div>
                      ))
                  )}
                  <div className="section-title mb-1 mt-3">AI employees in this topic</div>
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
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
