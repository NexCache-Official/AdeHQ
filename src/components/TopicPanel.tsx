"use client";

import { useState } from "react";
import type { AIEmployee, Approval, MemoryEntry, ProjectRoom, RoomTopic, Task, TopicMember, WorkLogEvent } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { TaskCard } from "./TaskCard";
import { MemoryCard } from "./MemoryCard";
import { ApprovalCard } from "./ApprovalCard";
import { WorkLogTimeline } from "./WorkLogTimeline";
import { EmptyState } from "./States";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
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

export function TopicPanel({
  topic,
  room,
  employees,
  topicMembers,
  tasks,
  memory,
  approvals,
  workLog,
  onSummarize,
  onResolve,
  onAskAi,
  onSaveSummaryToMemory,
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
  onSummarize: () => void;
  onResolve: () => void;
  onAskAi: () => void;
  onSaveSummaryToMemory: () => void;
  summarizing?: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");

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

  const counts: Record<string, number> = {
    tasks: topicTasks.length,
    memory: topicMemory.length,
    approvals: topicApprovals.filter((a) => a.status === "pending").length,
    activity: topicLog.length,
    people: topicMembers.length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{topic.title}</h2>
            {topic.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{topic.description}</p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {topic.status}
              </span>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {topic.priority} priority
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={onSummarize} disabled={summarizing}>
            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Summarize
          </Button>
          <Button variant="ghost" size="sm" onClick={onAskAi}>
            <Zap className="h-3.5 w-3.5" /> Ask AI
          </Button>
          {topic.status !== "resolved" && (
            <Button variant="ghost" size="sm" onClick={onResolve}>
              Resolve
            </Button>
          )}
        </div>
        {topic.summary && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">
            {topic.summary}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === tb.id ? "bg-accent-500/15 text-accent-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            <tb.icon className="h-3.5 w-3.5" />
            {tb.label}
            {counts[tb.id] > 0 && (
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px]">{counts[tb.id]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" && (
          <div className="space-y-4">
            <section>
              <div className="section-title mb-1.5">Open tasks</div>
              {topicTasks.filter((t) => t.status !== "done").length === 0 ? (
                <p className="text-xs text-slate-500">No open tasks in this topic.</p>
              ) : (
                <div className="space-y-2">
                  {topicTasks.filter((t) => t.status !== "done").slice(0, 3).map((t) => (
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
                  {topicApprovals.filter((a) => a.status === "pending").map((a) => (
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
            <div className="section-title mb-1">AI employees in topic</div>
            {topicEmployees.length === 0 ? (
              <p className="text-xs text-slate-500">No AI employees assigned yet.</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
