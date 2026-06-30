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
import { EmptyState } from "./States";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
import { getAiParticipationMode, isGeneralTopic, mainChatLabel } from "@/lib/topics";
import { getTopicAiControlState } from "@/lib/topic-ai-control";
import {
  BookText,
  BrainCircuit,
  CheckSquare,
  Loader2,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
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
  { id: "silent_observation", label: "Silent observation", hint: "AI tracks context; speaks only when @mentioned" },
  { id: "manual_only", label: "Manual only", hint: "AI responds only when @mentioned" },
  { id: "smart_assist_lite", label: "Smart assist (lite)", hint: "General Chat default — greetings & role matches, room cooldown" },
  { id: "smart_assist", label: "Smart assist", hint: "Broader relevance matching (max 1 ambient)" },
  { id: "active_team", label: "Active team", hint: "More proactive contributors (max 2)" },
];

function displaySummary(summary: string) {
  return summary
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
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
  onAskAi,
  onSaveSummaryToMemory,
  onParticipationChange,
  onAiControl,
  summarizing,
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
  onAskAi: () => void;
  onSaveSummaryToMemory: () => void;
  onParticipationChange?: (mode: AiParticipationMode) => void;
  onAiControl?: (action: "stop_all" | "resume" | "pause_smart") => void;
  summarizing?: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const isMainChat = isGeneralTopic(topic);
  const displayTitle = isMainChat ? mainChatLabel(isDm) : topic.title;
  const participation = getAiParticipationMode(topic);
  const aiControl = getTopicAiControlState(topic);

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

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[108px] shrink-0 flex-col gap-0.5 border-r border-slate-200 bg-slate-50/80 p-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium leading-tight transition-colors",
              tab === tb.id
                ? "bg-accent-500/15 text-accent-700"
                : "text-slate-500 hover:bg-white hover:text-slate-800",
            )}
          >
            <tb.icon className="h-4 w-4 shrink-0" />
            <span className="text-center">{tb.label}</span>
            {counts[tb.id] > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 text-[9px] text-slate-600">
                {counts[tb.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{displayTitle}</h2>
            {topic.description && !isMainChat && (
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{topic.description}</p>
            )}
            {!isMainChat && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {topic.status}
                </span>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {topic.priority} priority
                </span>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" onClick={onSummarize} disabled={summarizing}>
              {summarizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Summarize
            </Button>
            <Button variant="ghost" size="sm" onClick={onAskAi}>
              <Zap className="h-3.5 w-3.5" /> Draft AI question
            </Button>
            {!isMainChat && topic.status !== "archived" && (
              <Button variant="ghost" size="sm" onClick={onArchive}>
                Archive Topic
              </Button>
            )}
          </div>
          {onParticipationChange && (
            <div className="mt-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                AI participation
              </div>
              {aiControl.aiStopped && (
                <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  All AI activity is stopped in this topic.
                </p>
              )}
              {aiControl.smartAssistPaused && !aiControl.aiStopped && (
                <p className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                  Smart assist paused — @mentions only until{" "}
                  {aiControl.aiPausedUntil
                    ? new Date(aiControl.aiPausedUntil).toLocaleTimeString()
                    : "resumed"}
                </p>
              )}
              <div className="flex flex-col gap-1">
                {PARTICIPATION_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onParticipationChange(mode.id)}
                    disabled={aiControl.aiStopped}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                      participation === mode.id
                        ? "border-accent-500/40 bg-accent-500/10 text-accent-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                      aiControl.aiStopped && "opacity-50",
                    )}
                  >
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-[10px] text-slate-500">{mode.hint}</div>
                  </button>
                ))}
              </div>
              {onAiControl && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {aiControl.aiStopped || aiControl.smartAssistPaused ? (
                    <Button variant="secondary" size="sm" onClick={() => onAiControl("resume")}>
                      Resume AI
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => onAiControl("pause_smart")}>
                        Pause smart assist
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onAiControl("stop_all")}>
                        Stop all AI
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "overview" && (
            <div className="space-y-4">
              {topic.summary && (
                <section>
                  <div className="section-title mb-1.5">Summary</div>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">
                    {displaySummary(topic.summary)}
                  </div>
                </section>
              )}
              <section>
                <div className="section-title mb-1.5">Open tasks</div>
                {topicTasks.filter((t) => t.status !== "done").length === 0 ? (
                  <p className="text-xs text-slate-500">No open tasks in this topic.</p>
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
                  <p className="text-xs text-slate-500">No pending approvals.</p>
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
              {topic.summary && (
                <Button variant="secondary" size="sm" className="w-full" onClick={onSaveSummaryToMemory}>
                  Save summary to memory
                </Button>
              )}
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
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                      <EmployeeAvatar employee={topicEmployees[0]} size="sm" />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{topicEmployees[0].name}</div>
                        <div className="text-[11px] text-slate-500">{topicEmployees[0].role}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No AI employee linked to this DM.</p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    This is a 1:1 conversation between you and this AI employee.
                  </p>
                </>
              ) : (
                <>
                  <div className="section-title mb-1">People in this room</div>
                  {humanParticipants.length === 0 ? (
                    <p className="text-xs text-slate-500">No human members listed.</p>
                  ) : (
                    humanParticipants.map((human) => (
                      <div
                        key={human.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                          {(human.name ?? "U").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{human.name}</div>
                          {human.email && (
                            <div className="text-[11px] text-slate-500">{human.email}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div className="section-title mb-1 mt-3">AI employees in room</div>
                  {room.aiEmployees.length === 0 ? (
                    <p className="text-xs text-slate-500">No AI employees in this room.</p>
                  ) : (
                    room.aiEmployees
                      .map((id) => employees.find((e) => e.id === id))
                      .filter((e): e is AIEmployee => !!e)
                      .map((e) => (
                        <div key={e.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                          <EmployeeAvatar employee={e} size="sm" />
                          <div>
                            <div className="text-sm font-medium text-slate-800">{e.name}</div>
                            <div className="text-[11px] text-slate-500">{e.role}</div>
                          </div>
                        </div>
                      ))
                  )}
                  <div className="section-title mb-1 mt-3">AI employees in this topic</div>
                  {topicEmployees.length === 0 ? (
                    <p className="text-xs text-slate-500">No AI employees assigned to this topic yet.</p>
                  ) : (
                    topicEmployees.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                        <EmployeeAvatar employee={e} size="sm" />
                        <div>
                          <div className="text-sm font-medium text-slate-800">{e.name}</div>
                          <div className="text-[11px] text-slate-500">{e.role}</div>
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
