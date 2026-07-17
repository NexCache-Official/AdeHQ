"use client";

import { useState } from "react";
import { Task, TaskStatus } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { deleteTaskClient } from "@/lib/tasks/client";
import { TASK_STATUS_META } from "@/lib/icons";
import { cn, timeAgo } from "@/lib/utils";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { ArrowUpRight, Flag, Trash2 } from "lucide-react";
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
  deletable = false,
}: {
  task: Task;
  onClick?: () => void;
  compact?: boolean;
  deletable?: boolean;
}) {
  const { state, actions, backend } = useStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  const removeTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    setDeleteError(null);
    try {
      if (backend === "supabase") {
        await deleteTaskClient(task.id);
      }
      actions.removeTask(task.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete task.");
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border border-border bg-muted p-3.5 transition-all hover:border-[var(--border)] hover:bg-muted",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-ink">{task.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          {deletable && !confirmDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
                setDeleteError(null);
              }}
              className="rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
              title="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={cycleStatus}
            className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium transition-transform active:scale-95", meta.bg, meta.color)}
            title="Click to change status"
          >
            {meta.label}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[11px] text-rose-800">Delete permanently?</span>
          <button
            type="button"
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(false);
            }}
            className="text-[11px] font-medium text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={removeTask}
            className="text-[11px] font-medium text-rose-700 hover:text-rose-900"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {deleteError && (
        <p className="mt-1.5 text-[11px] text-rose-600" onClick={(e) => e.stopPropagation()}>
          {deleteError}
        </p>
      )}
      {!compact && task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-ink-3">{task.description}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {assignee ? (
          <EmployeeAvatar employee={assignee} size="xs" showStatus={false} />
        ) : (
          <HumanAvatar
            name={state.user?.name ?? "You"}
            size="xs"
            userId={state.user?.id}
            src={state.user?.avatar}
          />
        )}
        <span className="truncate text-[11px] text-ink-3">
          {assignee?.name ?? state.user?.name ?? "You"}
        </span>
        <span className={cn("ml-auto flex items-center gap-1 text-[11px]", prio.color)}>
          <Flag className="h-3 w-3" /> {prio.label}
        </span>
      </div>
      {!compact && room && (
        <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
          <Link
            href={`/rooms/${room.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink-2"
          >
            {room.name} <ArrowUpRight className="h-3 w-3" />
          </Link>
          <span className="text-[11px] text-ink-3">{timeAgo(task.updatedAt)}</span>
        </div>
      )}
    </div>
  );
}
