"use client";

import { Task, TaskStatus } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { TASK_STATUS_META } from "@/lib/icons";
import { cn, timeAgo } from "@/lib/utils";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { ArrowUpRight, Flag } from "lucide-react";
import Link from "next/link";

const PRIORITY_META = {
  high: { color: "text-rose-600", label: "High" },
  medium: { color: "text-amber-700", label: "Medium" },
  low: { color: "text-slate-400", label: "Low" },
};

const STATUS_FLOW: TaskStatus[] = ["open", "in_progress", "waiting_approval", "blocked", "done"];

export function TaskCard({
  task,
  onClick,
  compact = false,
}: {
  task: Task;
  onClick?: () => void;
  compact?: boolean;
}) {
  const { state, actions } = useStore();
  const assignee = state.employees.find((e) => e.id === task.assigneeId);
  const room = state.rooms.find((r) => r.id === task.roomId);
  const meta = TASK_STATUS_META[task.status];
  const prio = PRIORITY_META[task.priority];

  const cycleStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = STATUS_FLOW.indexOf(task.status);
    const next = STATUS_FLOW[(idx + 1) % STATUS_FLOW.length];
    actions.updateTask(task.id, { status: next });
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition-all hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-slate-800">{task.title}</p>
        <button
          onClick={cycleStatus}
          className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-transform active:scale-95", meta.bg, meta.color)}
          title="Click to change status"
        >
          {meta.label}
        </button>
      </div>
      {!compact && task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{task.description}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {assignee ? (
          <EmployeeAvatar employee={assignee} size="xs" showStatus={false} />
        ) : (
          <HumanAvatar name={state.user?.name ?? "You"} size="xs" />
        )}
        <span className="truncate text-[11px] text-slate-400">
          {assignee?.name ?? state.user?.name ?? "You"}
        </span>
        <span className={cn("ml-auto flex items-center gap-1 text-[11px]", prio.color)}>
          <Flag className="h-3 w-3" /> {prio.label}
        </span>
      </div>
      {!compact && room && (
        <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2.5">
          <Link
            href={`/rooms/${room.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
          >
            {room.name} <ArrowUpRight className="h-3 w-3" />
          </Link>
          <span className="text-[11px] text-slate-500">{timeAgo(task.updatedAt)}</span>
        </div>
      )}
    </div>
  );
}
