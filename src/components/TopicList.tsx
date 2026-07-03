"use client";

import { useMemo } from "react";
import type { AIEmployee, ProjectRoom, RoomTopic, TopicMember } from "@/lib/types";
import {
  generalTopicForRoom,
  isGeneralTopic,
  mainChatLabel,
  nonGeneralTopics,
  sortTopics,
  topicUnreadCount,
} from "@/lib/topics";
import { effectiveEmployeeStatus } from "@/lib/maya-employee";
import { cn } from "@/lib/utils";
import { RoomIcon, EmployeeAvatar } from "./EmployeeAvatar";
import { ParticipantAvatarStack } from "@/components/people/RoomMembersPopover";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import { Plus, Archive } from "lucide-react";
import { TopicRowMenu } from "@/components/TopicRowMenu";

function MainChatIcon({ isDm }: { isDm: boolean }) {
  if (isDm) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent-d" strokeWidth="1.9" stroke="currentColor">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-5A8.4 8.4 0 1 1 21 11.5Z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent-d" strokeWidth="1.9" stroke="currentColor">
      <path d="M8 10h8M8 14h5" />
      <rect x="3.5" y="4" width="17" height="15" rx="4" />
    </svg>
  );
}

function TopicRow({
  topic,
  label,
  selected,
  unread,
  onSelect,
  isMain,
  isDm,
  archived,
  onRename,
  onArchive,
  onDelete,
  topicActionBusy,
}: {
  topic: RoomTopic;
  label: string;
  selected: boolean;
  unread: number;
  onSelect: () => void;
  isMain?: boolean;
  isDm?: boolean;
  archived?: boolean;
  onRename?: (topic: RoomTopic, newTitle: string) => Promise<void>;
  onArchive?: (topic: RoomTopic) => Promise<void>;
  onDelete?: (topic: RoomTopic) => Promise<void>;
  topicActionBusy?: boolean;
}) {
  const running = topic.agentRunCount > 0;

  if (isMain) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "topicrow flex w-full items-center gap-[9px] rounded-[11px] border px-[10px] py-[9px] text-left transition-colors",
          selected
            ? "border-accent-soft bg-accent-soft"
            : "border-transparent hover:bg-black/[0.035]",
        )}
      >
        <MainChatIcon isDm={!!isDm} />
        <span
          className={cn(
            "flex-1 text-[13px] font-semibold",
            selected ? "text-accent-d" : "text-ink",
          )}
        >
          {label}
        </span>
        {isDm && (
          <span className="text-[9px] text-ink-3" title="Cannot be archived">
            📌
          </span>
        )}
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="group/topicrow flex w-full items-center gap-1">
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "topicrow flex min-w-0 flex-1 cursor-pointer items-center gap-[9px] rounded-[10px] px-[10px] py-2 text-left transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-black/[0.035]",
        archived && "opacity-70",
      )}
    >
      {archived ? (
        <Archive className="h-3 w-3 shrink-0 text-ink-3" strokeWidth={2} />
      ) : (
        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-ink-3" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          selected ? "font-semibold text-accent-d" : "font-medium text-ink",
        )}
      >
        {label}
      </span>
      {running && (
        <span className="h-1.5 w-1.5 shrink-0 animate-glowpulse rounded-full bg-green" />
      )}
      {topic.openTaskCount > 0 && (
        <span className="shrink-0 font-mono text-[9.5px] text-ink-3">
          {topic.openTaskCount}◷
        </span>
      )}
      {unread > 0 && (
        <span className="shrink-0 rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold text-white">
          {unread}
        </span>
      )}
    </button>
    {!isMain && !archived && (onRename || onArchive || onDelete) && (
      <TopicRowMenu
        topic={topic}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
        busy={topicActionBusy}
      />
    )}
    </div>
  );
}

export function TopicList({
  topics,
  topicMembers,
  messages,
  selectedTopicId,
  userId,
  isDm = false,
  room,
  dmEmployee,
  roomHumans = [],
  roomEmployees = [],
  onOpenMembers,
  onSelect,
  onNewTopic,
  onRenameTopic,
  onArchiveTopic,
  onDeleteTopic,
  topicActionBusy,
}: {
  topics: RoomTopic[];
  topicMembers: TopicMember[];
  messages: { id: string; topicId?: string }[];
  selectedTopicId?: string;
  userId?: string;
  isDm?: boolean;
  room?: ProjectRoom;
  dmEmployee?: AIEmployee;
  roomHumans?: Array<{ id: string; name: string }>;
  roomEmployees?: AIEmployee[];
  onOpenMembers?: () => void;
  onSelect: (topicId: string) => void;
  onNewTopic: () => void;
  onRenameTopic?: (topic: RoomTopic, newTitle: string) => Promise<void>;
  onArchiveTopic?: (topic: RoomTopic) => Promise<void>;
  onDeleteTopic?: (topic: RoomTopic) => Promise<void>;
  topicActionBusy?: boolean;
}) {
  const mainTopic = useMemo(
    () => generalTopicForRoom(topics, topics[0]?.roomId ?? room?.id ?? ""),
    [topics, room?.id],
  );

  const regularTopics = useMemo(() => {
    const roomId = topics[0]?.roomId ?? room?.id ?? "";
    const base = nonGeneralTopics(topics, roomId);
    return sortTopics(base.filter((t) => !isGeneralTopic(t) && t.status !== "archived"));
  }, [topics, room?.id]);

  const archivedTopics = useMemo(() => {
    const roomId = topics[0]?.roomId ?? room?.id ?? "";
    const base = nonGeneralTopics(topics, roomId);
    return sortTopics(base.filter((t) => !isGeneralTopic(t) && t.status === "archived"));
  }, [topics, room?.id]);

  const unreadFor = (topic: RoomTopic) => {
    const member = topicMembers.find(
      (m) => m.topicId === topic.id && m.memberType === "human" && m.memberId === userId,
    );
    return topicUnreadCount(
      topic,
      messages as import("@/lib/types").RoomMessage[],
      member,
    );
  };

  const totalUnread =
    regularTopics.reduce((n, t) => n + unreadFor(t), 0) + (mainTopic ? unreadFor(mainTopic) : 0);

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      {isDm && dmEmployee ? (
        <div className="border-b border-border-2 p-4">
          <div className="flex items-center gap-[11px]">
            <EmployeeAvatar
              employee={dmEmployee}
              size="md"
              className="!h-10 !w-10 !rounded-xl !text-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14.5px] font-semibold text-ink">{dmEmployee.name}</span>
                <span className="rounded-[5px] bg-accent-soft px-[5px] py-0.5 text-[9px] font-bold text-accent">
                  AI
                </span>
              </div>
              <p className="truncate text-xs text-ink-2">{dmEmployee.role}</p>
            </div>
          </div>
          <div className="mt-[11px]">
            <EmployeeStatusBadge status={effectiveEmployeeStatus(dmEmployee)} />
          </div>
        </div>
      ) : room ? (
        <div className="border-b border-border-2 p-4">
          <div className="flex items-center gap-2.5">
            <RoomIcon />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-ink">{room.name}</div>
              <div className="text-[11.5px] text-ink-2">Room · {totalUnread} unread</div>
            </div>
          </div>
          {onOpenMembers && (
            <div className="mt-2.5">
              <ParticipantAvatarStack
                humans={roomHumans}
                employees={roomEmployees}
                onClick={onOpenMembers}
              />
            </div>
          )}
          <button
            type="button"
            onClick={onNewTopic}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-border bg-surface py-2 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New topic
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-3">
          Main
        </div>
        {mainTopic && (
          <TopicRow
            topic={mainTopic}
            label={mainChatLabel(isDm)}
            selected={mainTopic.id === selectedTopicId}
            unread={unreadFor(mainTopic)}
            onSelect={() => onSelect(mainTopic.id)}
            isMain
            isDm={isDm}
          />
        )}

        <div className="mb-1.5 flex items-center justify-between px-2 pb-1.5 pt-4">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-3">Topics</span>
          <button
            type="button"
            onClick={onNewTopic}
            className="flex text-ink-3 transition-colors hover:text-ink-2"
            aria-label="New topic"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {regularTopics.length === 0 ? (
          isDm ? (
            <p className="px-2.5 py-3.5 text-[11.5px] leading-normal text-ink-3">
              No more topics yet. Create one when this conversation needs its own workstream.
            </p>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-ink-3">
              No topics yet. Create one to focus a discussion.
            </p>
          )
        ) : (
          <div className="space-y-0.5">
            {regularTopics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                label={topic.title}
                selected={topic.id === selectedTopicId}
                unread={unreadFor(topic)}
                onSelect={() => onSelect(topic.id)}
                onRename={onRenameTopic}
                onArchive={onArchiveTopic}
                onDelete={onDeleteTopic}
                topicActionBusy={topicActionBusy}
              />
            ))}
          </div>
        )}

        {archivedTopics.length > 0 && (
          <>
            <div className="mb-1.5 flex items-center justify-between px-2 pb-1.5 pt-4">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-3">
                Archived
              </span>
              <span className="font-mono text-[10px] text-ink-3">{archivedTopics.length}</span>
            </div>
            <div className="space-y-0.5">
              {archivedTopics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  label={topic.title}
                  selected={topic.id === selectedTopicId}
                  unread={0}
                  onSelect={() => onSelect(topic.id)}
                  archived
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
