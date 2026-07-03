"use client";

import { WorkLogEvent } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { cn, timeAgo } from "@/lib/utils";
import {
  formatWorkLogEntryDisplay,
  shouldShowWorkLogInSidebar,
  workLogCanJump,
  workLogSourceLabel,
  type WorkLogFilterOptions,
} from "@/lib/work-log-labels";
import { jumpFromWorkLog } from "@/lib/navigation/jump-to-source";
import { toolIcon } from "@/lib/icons";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  ShieldAlert,
  XCircle,
} from "lucide-react";

const STATUS_META = {
  success: { icon: CheckCircle2, color: "text-emerald-700", label: "Success" },
  pending: { icon: Clock, color: "text-sky-700", label: "Pending" },
  failed: { icon: XCircle, color: "text-rose-600", label: "Failed" },
  needs_approval: { icon: ShieldAlert, color: "text-amber-700", label: "Needs approval" },
};

export function WorkLogTimeline({
  events,
  compact = false,
  debugEnabled = false,
}: {
  events: WorkLogEvent[];
  compact?: boolean;
  debugEnabled?: boolean;
}) {
  const { state } = useStore();
  const filterOpts: WorkLogFilterOptions = { debugEnabled };

  return (
    <div className="relative">
      <div className="absolute bottom-2 left-[19px] top-2 w-px bg-slate-100" />
      <div className="space-y-1">
        {events
          .filter((event) => shouldShowWorkLogInSidebar(event.action, event.summary, filterOpts))
          .map((event) => {
            const employee = state.employees.find((e) => e.id === event.employeeId);
            const status = STATUS_META[event.status];
            const StatusIcon = status.icon;
            const room = state.rooms.find((r) => r.id === event.roomId);
            const topicMessages = (room?.messages ?? []).filter(
              (m) => !event.topicId || m.topicId === event.topicId,
            );
            const sourceLabel = workLogSourceLabel(event, {
              messages: topicMessages,
              topics: state.topics,
              room,
              action: event.action,
            });
            const canJump = workLogCanJump(event);
            const { title, summaryLine, category } = formatWorkLogEntryDisplay(
              employee?.name,
              event.action,
              event.summary,
            );
            const TI = event.toolUsed
              ? toolIcon(state.tools.find((t) => t.name === event.toolUsed)?.id ?? "")
              : null;

            const handleJump = () => {
              if (canJump) jumpFromWorkLog(event);
            };

            return (
              <div
                key={event.id}
                role={canJump ? "button" : undefined}
                tabIndex={canJump ? 0 : undefined}
                onClick={canJump ? handleJump : undefined}
                onKeyDown={
                  canJump
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleJump();
                        }
                      }
                    : undefined
                }
                className={cn(
                  "relative flex gap-3 rounded-xl px-2 py-2.5 transition-colors",
                  canJump && "cursor-pointer hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
                  !canJump && "hover:bg-slate-50/60",
                )}
              >
                <div className="relative z-10 shrink-0">
                  {employee ? (
                    <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100">
                      <FileText className="h-4 w-4 text-slate-400" />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-white",
                      status.color,
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                  </span>
                </div>

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-800">{title}</span>
                    {category && !compact && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                        {category}
                      </span>
                    )}
                  </div>

                  {summaryLine && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      {summaryLine}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    {event.toolUsed && TI && (
                      <span className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5">
                        <TI className="h-3 w-3" /> {event.toolUsed}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        status.color,
                        "bg-slate-50",
                      )}
                    >
                      {status.label}
                    </span>
                    {sourceLabel && canJump ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJump();
                        }}
                        className="inline-flex items-center gap-0.5 font-medium text-accent hover:text-accent-d"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {sourceLabel}
                      </button>
                    ) : sourceLabel ? (
                      <span className="text-ink-3">{sourceLabel}</span>
                    ) : !compact ? (
                      <span className="text-ink-3/70">No linked source</span>
                    ) : null}
                    {!compact && room && <span>· {room.name}</span>}
                    <span className="ml-auto shrink-0">{timeAgo(event.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
