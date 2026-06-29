"use client";

import { useMemo, useState } from "react";
import type { AIEmployee, RoomTopic, TopicMember } from "@/lib/types";
import { filterTopics, sortTopics, topicUnreadCount, type TopicFilter } from "@/lib/topics";
import { cn, timeAgo } from "@/lib/utils";
import { Bot, Circle, Filter, Plus } from "lucide-react";
import { Button } from "./ui";

const FILTERS: { id: TopicFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "mine", label: "Mine" },
  { id: "ai_running", label: "AI running" },
  { id: "approvals", label: "Has approvals" },
  { id: "archived", label: "Archived" },
];

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-500",
  normal: "bg-slate-300",
  low: "bg-slate-200",
};

export function TopicList({
  topics,
  topicMembers,
  messages,
  selectedTopicId,
  userId,
  onSelect,
  onNewTopic,
}: {
  topics: RoomTopic[];
  topicMembers: TopicMember[];
  messages: { id: string; topicId?: string }[];
  selectedTopicId?: string;
  userId?: string;
  onSelect: (topicId: string) => void;
  onNewTopic: () => void;
}) {
  const [filter, setFilter] = useState<TopicFilter>("active");

  const visible = useMemo(() => {
    const filtered = filterTopics(topics, filter, userId, topicMembers);
    return sortTopics(filtered);
  }, [topics, filter, userId, topicMembers]);

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topics</span>
        <Button variant="ghost" size="sm" onClick={onNewTopic} className="h-7 px-2">
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
              filter === f.id
                ? "bg-accent-500/15 text-accent-700"
                : "text-slate-500 hover:bg-slate-100",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-slate-500">
            <Filter className="mx-auto mb-2 h-4 w-4 opacity-50" />
            No topics match this filter.
          </div>
        ) : (
          visible.map((topic) => {
            const member = topicMembers.find(
              (m) => m.topicId === topic.id && m.memberType === "human" && m.memberId === userId,
            );
            const unread = topicUnreadCount(
              topic,
              messages as import("@/lib/types").RoomMessage[],
              member,
            );
            const selected = topic.id === selectedTopicId;

            return (
              <button
                key={topic.id}
                onClick={() => onSelect(topic.id)}
                className={cn(
                  "mb-0.5 flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
                  selected ? "bg-accent-500/12 ring-1 ring-accent-500/25" : "hover:bg-slate-50",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[topic.priority])}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-900">{topic.title}</span>
                      {topic.status !== "active" && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">
                          {topic.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      {topic.lastActivityAt && (
                        <span>{timeAgo(topic.lastActivityAt)}</span>
                      )}
                      {topic.openTaskCount > 0 && <span>{topic.openTaskCount} tasks</span>}
                      {topic.approvalCount > 0 && (
                        <span className="text-amber-600">{topic.approvalCount} approvals</span>
                      )}
                      {topic.agentRunCount > 0 && (
                        <span className="flex items-center gap-0.5 text-accent-600">
                          <Bot className="h-3 w-3" /> running
                        </span>
                      )}
                    </div>
                  </div>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white">
                      {unread}
                    </span>
                  )}
                  {topic.agentRunCount > 0 && unread === 0 && (
                    <Circle className="h-2 w-2 shrink-0 animate-pulse fill-accent-500 text-accent-500" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
