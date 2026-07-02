"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { getGroupRooms } from "@/lib/rooms";
import { PageContainer, PageHeader } from "@/components/Page";
import { TaskCard } from "@/components/TaskCard";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { EmployeeAvatar, HumanAvatar } from "@/components/EmployeeAvatar";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { TASK_STATUS_META } from "@/lib/icons";
import { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useResponder } from "@/lib/ai/use-responder";
import { CheckSquare, Columns3, List, Plus, Sparkles } from "lucide-react";

const COLUMNS: TaskStatus[] = ["open", "in_progress", "waiting_approval", "blocked", "done"];

export default function TasksPage() {
  const { state, actions } = useStore();
  const [view, setView] = useState<"board" | "list">("board");
  const [detail, setDetail] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomFilter, setRoomFilter] = useState("all");

  const groupRooms = getGroupRooms(state.rooms);
  const tasks = state.tasks.filter((t) => roomFilter === "all" || t.roomId === roomFilter);

  return (
    <PageContainer wide>
      <PageHeader
        title="Tasks"
        subtitle="A lightweight board for humans and AI employees. Click a status to advance it."
        icon={<CheckSquare className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <select className="input-field sm:w-56" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
          <option value="all">All rooms</option>
          {groupRooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          <button onClick={() => setView("board")} className={cn("flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors", view === "board" ? "bg-slate-100 text-slate-900" : "text-slate-400")}>
            <Columns3 className="h-4 w-4" /> Board
          </button>
          <button onClick={() => setView("list")} className={cn("flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors", view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-400")}>
            <List className="h-4 w-4" /> List
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks yet" description="Create a task, or ask an AI employee to break work down for you." action={{ label: "New task", onClick: () => setCreateOpen(true) }} />
      ) : view === "board" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            const meta = TASK_STATUS_META[col];
            return (
              <div key={col} className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-2.5 flex items-center justify-between px-1">
                  <span className={cn("flex items-center gap-1.5 text-xs font-semibold", meta.color)}>
                    <span className={cn("h-2 w-2 rounded-full", meta.bg.replace("/15", ""))} style={{ background: "currentColor" }} />
                    {meta.label}
                  </span>
                  <span className="text-xs text-slate-500">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((t) => (
                    <TaskCard key={t.id} task={t} compact onClick={() => setDetail(t)} />
                  ))}
                  {colTasks.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-600">
                      Nothing here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onClick={() => setDetail(t)} />
          ))}
        </div>
      )}

      {detail && <TaskDetailModal task={detail} onClose={() => setDetail(null)} />}
      <CreateTaskGlobalModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
}

function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { state, actions } = useStore();
  const router = useRouter();
  const respond = useResponder();
  const current = state.tasks.find((t) => t.id === task.id) ?? task;
  const assignee = state.employees.find((e) => e.id === current.assigneeId);
  const room = state.rooms.find((r) => r.id === current.roomId);
  const relatedLog = state.workLog.filter((w) => w.relatedEntityId === current.id || (w.roomId === current.roomId && w.employeeId === current.assigneeId)).slice(0, 5);

  const askToWork = async () => {
    if (!assignee || !room) return;
    actions.updateTask(current.id, { status: "in_progress" });
    onClose();
    router.push(`/rooms/${room.id}`);
    setTimeout(() => respond(room.id, assignee.id, `@${assignee.name} please work on: ${current.title}`), 400);
  };

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={current.title} subtitle={room?.name} onClose={onClose} icon={<CheckSquare className="h-5 w-5" />} />
      <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
        {current.description && <p className="text-sm leading-relaxed text-slate-600">{current.description}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Meta label="Status">
            <select
              className="input-field !py-1.5 text-xs"
              value={current.status}
              onChange={(e) => actions.updateTask(current.id, { status: e.target.value as TaskStatus })}
            >
              {COLUMNS.map((s) => (
                <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>
              ))}
            </select>
          </Meta>
          <Meta label="Priority"><span className="text-sm capitalize text-slate-700">{current.priority}</span></Meta>
          <Meta label="Assignee">
            <span className="flex items-center gap-1.5 text-sm text-slate-700">
              {assignee ? <EmployeeAvatar employee={assignee} size="xs" showStatus={false} /> : <HumanAvatar name={state.user?.name ?? "You"} size="xs" />}
              <span className="truncate">{assignee?.name ?? state.user?.name ?? "You"}</span>
            </span>
          </Meta>
          <Meta label="Created from"><span className="text-sm text-slate-700">{current.createdFrom ?? "—"}</span></Meta>
        </div>

        <div>
          <div className="section-title mb-2">Related activity</div>
          {relatedLog.length === 0 ? (
            <p className="text-sm text-slate-500">No related activity yet.</p>
          ) : (
            <WorkLogTimeline events={relatedLog} compact />
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 px-5 py-4">
        <div className="flex gap-2">
          {current.status !== "done" ? (
            <Button size="sm" variant="secondary" onClick={() => actions.updateTask(current.id, { status: "done" })}>
              Mark complete
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => actions.updateTask(current.id, { status: "open" })}>
              Reopen
            </Button>
          )}
          {room && <Button size="sm" variant="ghost" onClick={() => { onClose(); router.push(`/rooms/${room.id}`); }}>Open room</Button>}
        </div>
        {assignee && current.assigneeType === "ai" && (
          <Button size="sm" onClick={askToWork}>
            <Sparkles className="h-4 w-4" /> Ask {assignee.name.split(" ")[0]} to work on it
          </Button>
        )}
      </div>
    </Modal>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-title mb-1">{label}</div>
      {children}
    </div>
  );
}

function CreateTaskGlobalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useStore();
  const groupRooms = getGroupRooms(state.rooms);
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(groupRooms[0]?.id ?? "");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");

  const roomEmployees = state.rooms.find((r) => r.id === roomId)?.aiEmployees ?? [];

  const create = () => {
    if (!title.trim() || !roomId) return;
    const isHuman = assignee === "";
    actions.createTask({
      roomId,
      title: title.trim(),
      priority,
      assigneeType: isHuman ? "human" : "ai",
      assigneeId: isHuman ? state.user?.id ?? "user-shubham" : assignee,
      status: "open",
      createdFrom: "Manual",
    });
    setTitle("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Create a task" onClose={onClose} icon={<CheckSquare className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Room</span>
            <select className="input-field" value={roomId} onChange={(e) => { setRoomId(e.target.value); setAssignee(""); }}>
              {groupRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Priority</span>
            <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Assignee</span>
          <select className="input-field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{state.user?.name ?? "You"} (human)</option>
            {roomEmployees.map((id) => {
              const e = state.employees.find((x) => x.id === id);
              return e ? <option key={id} value={id}>{e.name}</option> : null;
            })}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Create task</Button>
      </div>
    </Modal>
  );
}
