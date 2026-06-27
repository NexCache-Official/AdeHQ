"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { RoomChat } from "@/components/RoomChat";
import { EmployeeAvatar, HumanAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { TaskCard } from "@/components/TaskCard";
import { MemoryCard } from "@/components/MemoryCard";
import { ApprovalCard } from "@/components/ApprovalCard";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BookText,
  BrainCircuit,
  Check,
  CheckSquare,
  Hash,
  ListChecks,
  Phone,
  Plus,
  ScrollText,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";

const TABS = [
  { id: "brief", label: "Brief", icon: BookText },
  { id: "people", label: "People", icon: Users },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "memory", label: "Memory", icon: BrainCircuit },
  { id: "approvals", label: "Approvals", icon: ShieldAlert },
  { id: "activity", label: "Activity", icon: ScrollText },
] as const;

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const { state, actions } = useStore();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("brief");
  const [addOpen, setAddOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const room = state.rooms.find((r) => r.id === roomId);

  const roomEmployees = useMemo(
    () => (room ? room.aiEmployees.map((id) => state.employees.find((e) => e.id === id)).filter(Boolean) : []),
    [room, state.employees],
  );
  const roomTasks = state.tasks.filter((t) => t.roomId === roomId);
  const roomMemory = state.memory.filter((m) => m.roomId === roomId);
  const roomApprovals = state.approvals.filter((a) => a.roomId === roomId);
  const roomLog = state.workLog
    .filter((w) => w.roomId === roomId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const availableToAdd = state.employees.filter((e) => !room?.aiEmployees.includes(e.id));

  if (!room) {
    return (
      <div className="p-10">
        <EmptyState
          icon={Users}
          title="Room not found"
          description="This room may have been removed."
          action={{ label: "Back to rooms", onClick: () => router.push("/rooms") }}
        />
      </div>
    );
  }

  const counts: Record<string, number> = {
    tasks: roomTasks.length,
    memory: roomMemory.length,
    approvals: roomApprovals.filter((a) => a.status === "pending").length,
    activity: roomLog.length,
    people: room.humans.length + roomEmployees.length,
  };

  const saveSummary = () => {
    actions.createMemory({
      roomId,
      title: `Room summary — ${new Date().toLocaleDateString()}`,
      content: `Summary of ${room.name}: ${roomEmployees.length} AI employees active, ${roomTasks.length} tasks, ${roomMemory.length} memory entries. Latest focus: ${room.description}`,
      type: "general",
      status: "approved",
      createdByType: "system",
      createdById: "system",
    });
    setTab("memory");
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Room header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <button onClick={() => router.push("/rooms")} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        {room.kind === "dm" && roomEmployees[0] ? (
          <EmployeeAvatar employee={roomEmployees[0]} size="sm" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: room.accent }}>
            <Hash className="h-5 w-5" strokeWidth={2.4} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{room.name}</h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {room.kind === "dm" ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Direct message
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                </span>
                <span>·</span>
                <span>{room.humans.length + roomEmployees.length} participants</span>
              </>
            )}
          </div>
        </div>
        <div className="flex -space-x-2">
          {room.humans.map((h) => (
            <HumanAvatar key={h} name={state.user?.name ?? "You"} size="sm" className="!h-8 !w-8 ring-2 ring-white" />
          ))}
          {roomEmployees.slice(0, 4).map(
            (e) => e && (
              <div key={e.id} className="rounded-2xl ring-2 ring-white">
                <EmployeeAvatar employee={e} size="sm" showStatus={false} className="!h-8 !w-8" />
              </div>
            ),
          )}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTaskOpen(true)}>
            <Plus className="h-4 w-4" /> Task
          </Button>
          <Button variant="secondary" size="sm" onClick={() => router.push(`/calls?room=${roomId}`)}>
            <Phone className="h-4 w-4" /> Call
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Chat */}
        <div className="min-w-0 flex-1 border-r border-slate-200">
          <RoomChat room={room} />
        </div>

        {/* Right panel */}
        <div className="hidden w-[340px] shrink-0 flex-col lg:flex xl:w-[380px]">
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
            {tab === "brief" && (
              <div className="space-y-4">
                <div>
                  <div className="section-title mb-1.5">Project brief</div>
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600">
                    {room.brief || room.description || "No brief yet."}
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="w-full" onClick={saveSummary}>
                  <Check className="h-4 w-4" /> Save room summary to memory
                </Button>
              </div>
            )}

            {tab === "people" && (
              <div className="space-y-2">
                <div className="section-title mb-1">Humans</div>
                {room.humans.map((h) => (
                  <div key={h} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    <HumanAvatar name={state.user?.name ?? "You"} size="sm" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">{state.user?.name ?? "You"}</div>
                      <div className="text-[11px] text-slate-500">{state.user?.role ?? "Founder"}</div>
                    </div>
                  </div>
                ))}
                <div className="section-title mb-1 mt-3">AI employees</div>
                {roomEmployees.map(
                  (e) => e && (
                    <div key={e.id} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <EmployeeAvatar employee={e} size="sm" />
                      <button onClick={() => router.push(`/workforce/${e.id}`)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-medium text-slate-800">{e.name}</div>
                        <div className="truncate text-[11px] text-slate-500">{e.role}</div>
                      </button>
                      <EmployeeStatusBadge status={e.status} />
                      <button
                        onClick={() => actions.removeEmployeeFromRoom(roomId, e.id)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-slate-500 hover:text-rose-600"
                      >
                        Remove
                      </button>
                    </div>
                  ),
                )}
                <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => setAddOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Add employee
                </Button>
              </div>
            )}

            {tab === "tasks" && (
              <div className="space-y-2">
                {roomTasks.length === 0 ? (
                  <EmptyState icon={ListChecks} title="No tasks yet" description="Ask an employee to create tasks." />
                ) : (
                  roomTasks.map((t) => <TaskCard key={t.id} task={t} compact />)
                )}
                <Button variant="secondary" size="sm" className="mt-1 w-full" onClick={() => setTaskOpen(true)}>
                  <Plus className="h-4 w-4" /> New task
                </Button>
              </div>
            )}

            {tab === "memory" && (
              <div className="space-y-3">
                {roomMemory.length === 0 ? (
                  <EmptyState icon={BrainCircuit} title="No memory yet" description="Decisions and findings will appear here." />
                ) : (
                  roomMemory.map((m) => <MemoryCard key={m.id} memory={m} />)
                )}
              </div>
            )}

            {tab === "approvals" && (
              <div className="space-y-3">
                {roomApprovals.length === 0 ? (
                  <EmptyState icon={ShieldAlert} title="No approvals" description="Approval requests will appear here." />
                ) : (
                  roomApprovals.map((a) => <ApprovalCard key={a.id} approval={a} />)
                )}
              </div>
            )}

            {tab === "activity" && (
              <div>
                {roomLog.length === 0 ? (
                  <EmptyState icon={ScrollText} title="No activity yet" description="Employee actions will appear here." />
                ) : (
                  <WorkLogTimeline events={roomLog} compact />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add employee modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="sm">
        <ModalHeader title="Add employee to room" onClose={() => setAddOpen(false)} icon={<UserPlus className="h-5 w-5" />} />
        <div className="max-h-96 space-y-2 overflow-y-auto p-4">
          {availableToAdd.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">All your employees are already in this room.</p>
          ) : (
            availableToAdd.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  actions.addEmployeeToRoom(roomId, e.id);
                  setAddOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left transition-colors hover:bg-slate-100"
              >
                <EmployeeAvatar employee={e} size="sm" showStatus={false} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{e.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{e.role}</div>
                </div>
                <Plus className="h-4 w-4 text-slate-400" />
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* Create task modal */}
      <CreateTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} roomId={roomId} />
    </div>
  );
}

function CreateTaskModal({ open, onClose, roomId }: { open: boolean; onClose: () => void; roomId: string }) {
  const { state, actions } = useStore();
  const room = state.rooms.find((r) => r.id === roomId);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");

  const create = () => {
    if (!title.trim()) return;
    const isHuman = assignee === "" || assignee === (state.user?.id ?? "user-shubham");
    actions.createTask({
      roomId,
      title: title.trim(),
      description: desc,
      priority,
      assigneeType: isHuman ? "human" : "ai",
      assigneeId: isHuman ? state.user?.id ?? "user-shubham" : assignee,
      status: "open",
      createdFrom: "Manual",
    });
    setTitle("");
    setDesc("");
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
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Description</span>
          <textarea className="input-field min-h-[72px] resize-none" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Assignee</span>
            <select className="input-field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{state.user?.name ?? "You"} (human)</option>
              {room?.aiEmployees.map((id) => {
                const e = state.employees.find((x) => x.id === id);
                return e ? <option key={id} value={id}>{e.name}</option> : null;
              })}
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
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Create task</Button>
      </div>
    </Modal>
  );
}
