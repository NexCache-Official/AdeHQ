"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { getGroupRooms } from "@/lib/rooms";
import { deleteTaskClient, patchTaskClient } from "@/lib/tasks/client";
import { PageContainer, PageHeader } from "@/components/Page";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { EmployeeAvatar, HumanAvatar } from "@/components/EmployeeAvatar";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import {
  ColumnEmpty,
  KanbanColumn,
  ProgressMeter,
  SearchInput,
  SegmentedControl,
  StatGrid,
  StatusPill,
  Toolbar,
  WorkspaceCanvas,
  toneOf,
  type StatDef,
  type Tone,
} from "@/components/workspace/WorkspaceKit";
import { IntegrationsStrip } from "@/components/workspace/IntegrationsStrip";
import { AutonomousLauncher } from "@/components/autonomy/AutonomousLauncher";
import { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useResponder } from "@/lib/ai/use-responder";
import {
  AlarmClock,
  Bot,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Columns3,
  Flag,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";

const STATUS_ORDER: TaskStatus[] = [
  "open",
  "in_progress",
  "waiting_on_human",
  "waiting_approval",
  "blocked",
  "done",
];

const STATUS_META: Record<TaskStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "slate" },
  in_progress: { label: "In progress", tone: "sky" },
  waiting_on_human: { label: "Waiting on human", tone: "amber" },
  waiting_approval: { label: "Waiting approval", tone: "amber" },
  blocked: { label: "Blocked", tone: "rose" },
  done: { label: "Done", tone: "emerald" },
};

const PRIORITY_ORDER: TaskPriority[] = ["high", "medium", "low"];
const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "rose" },
  medium: { label: "Medium", tone: "amber" },
  low: { label: "Low", tone: "slate" },
};

type ViewMode = "board" | "list" | "table";
type GroupBy = "status" | "priority" | "assignee";

function isOverdue(task: Task): boolean {
  return Boolean(task.dueDate) && task.status !== "done" && new Date(task.dueDate!).getTime() < Date.now();
}

function formatDue(due?: string): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const overdue = d.getTime() < now.getTime();
  if (Math.abs(days) <= 1) {
    return { label: days === 0 ? "Today" : days === 1 ? "Tomorrow" : "Yesterday", overdue };
  }
  return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), overdue };
}

export default function TasksPage() {
  const { state, actions, backend } = useStore();
  const [view, setView] = useState<ViewMode>("board");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [detail, setDetail] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<Partial<Task> | undefined>();
  const [roomFilter, setRoomFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>("all");
  const [search, setSearch] = useState("");
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [autopilotDefaults, setAutopilotDefaults] = useState<{
    objective?: string;
    employeeId?: string;
    roomId?: string;
    topicId?: string;
    taskId?: string;
  }>({});

  const groupRooms = getGroupRooms(state.rooms);

  const openAutopilot = (defaults: typeof autopilotDefaults = {}) => {
    setAutopilotDefaults({
      roomId: roomFilter !== "all" ? roomFilter : groupRooms[0]?.id,
      ...defaults,
    });
    setAutopilotOpen(true);
  };

  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.tasks.filter((t) => {
      if (roomFilter !== "all" && t.roomId !== roomFilter) return false;
      if (assigneeFilter !== "all" && t.assigneeId !== assigneeFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (q && !`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.tasks, roomFilter, assigneeFilter, priorityFilter, search]);

  const stats = useMemo<StatDef[]>(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const active = tasks.filter((t) => t.status === "in_progress").length;
    const overdue = tasks.filter(isOverdue).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return [
      { label: "Total tasks", value: total, icon: ListChecks, tone: "accent", hint: `${groupRooms.length} rooms` },
      { label: "Completed", value: `${pct}%`, icon: CheckCircle2, tone: "emerald", hint: `${done} of ${total} done` },
      { label: "In progress", value: active, icon: Loader2, tone: "sky", hint: "Being worked now" },
      { label: "Overdue", value: overdue, icon: AlarmClock, tone: overdue ? "rose" : "slate", hint: "Past due date" },
    ];
  }, [tasks, groupRooms.length]);

  const completion = tasks.length
    ? Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100)
    : 0;

  // Assignee directory (for group-by + labels).
  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; type: "human" | "ai" }>();
    for (const t of state.tasks) {
      if (seen.has(t.assigneeId)) continue;
      if (t.assigneeType === "ai") {
        const e = state.employees.find((x) => x.id === t.assigneeId);
        seen.set(t.assigneeId, { id: t.assigneeId, name: e?.name ?? "AI employee", type: "ai" });
      } else {
        seen.set(t.assigneeId, { id: t.assigneeId, name: state.user?.name ?? "You", type: "human" });
      }
    }
    return [...seen.values()];
  }, [state.tasks, state.employees, state.user]);

  const applyMove = async (taskId: string, patch: Partial<Task>) => {
    const current = state.tasks.find((t) => t.id === taskId);
    if (!current) return;
    actions.updateTask(taskId, patch);
    if (backend !== "supabase") return;
    try {
      await patchTaskClient(taskId, patch);
    } catch {
      actions.updateTask(taskId, {
        status: current.status,
        priority: current.priority,
        assigneeId: current.assigneeId,
        assigneeType: current.assigneeType,
      });
    }
  };

  const openCreate = (defaults?: Partial<Task>) => {
    setCreateDefaults(defaults);
    setCreateOpen(true);
  };

  const columns = useMemo(() => {
    if (groupBy === "status") {
      return STATUS_ORDER.map((s) => ({
        key: s,
        title: STATUS_META[s].label,
        tone: STATUS_META[s].tone,
        items: tasks.filter((t) => t.status === s),
        patch: { status: s } as Partial<Task>,
      }));
    }
    if (groupBy === "priority") {
      return PRIORITY_ORDER.map((p) => ({
        key: p,
        title: `${PRIORITY_META[p].label} priority`,
        tone: PRIORITY_META[p].tone,
        items: tasks.filter((t) => t.priority === p),
        patch: { priority: p } as Partial<Task>,
      }));
    }
    return assigneeOptions.map((a) => ({
      key: a.id,
      title: a.name,
      tone: (a.type === "ai" ? "violet" : "accent") as Tone,
      items: tasks.filter((t) => t.assigneeId === a.id),
      patch: { assigneeId: a.id, assigneeType: a.type } as Partial<Task>,
    }));
  }, [groupBy, tasks, assigneeOptions]);

  return (
    <PageContainer wide>
      <PageHeader
        title="Tasks"
        subtitle="A powerful board for humans and AI employees — drag to move, group any way, and let your workforce clear the queue."
        icon={<CheckSquare className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => openAutopilot()}>
              <Bot className="h-4 w-4" /> Autopilot
            </Button>
            <Button onClick={() => openCreate()}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          </>
        }
      />

      <WorkspaceCanvas>
        <div className="mb-5">
          <StatGrid stats={stats} />
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
            <span className="text-xs font-semibold text-ink-2">Overall completion</span>
            <ProgressMeter value={completion} tone="emerald" className="flex-1" />
            <span className="text-xs font-bold text-ink">{completion}%</span>
          </div>
        </div>

        <Toolbar>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search tasks…" className="w-full sm:w-56" />
            <FilterSelect value={roomFilter} onChange={setRoomFilter}>
              <option value="all">All rooms</option>
              {groupRooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect value={assigneeFilter} onChange={setAssigneeFilter}>
              <option value="all">Everyone</option>
              {assigneeOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect value={priorityFilter} onChange={(v) => setPriorityFilter(v as "all" | TaskPriority)}>
              <option value="all">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </FilterSelect>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {view === "board" && (
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-ink-3" />
                <SegmentedControl<GroupBy>
                  size="sm"
                  value={groupBy}
                  onChange={setGroupBy}
                  options={[
                    { id: "status", label: "Status" },
                    { id: "priority", label: "Priority" },
                    { id: "assignee", label: "Owner" },
                  ]}
                />
              </div>
            )}
            <SegmentedControl<ViewMode>
              value={view}
              onChange={setView}
              options={[
                { id: "board", label: "Board", icon: Columns3 },
                { id: "list", label: "List", icon: ListChecks },
                { id: "table", label: "Table", icon: Table2 },
              ]}
            />
          </div>
        </Toolbar>

        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState
              icon={CheckSquare}
              title="No tasks match"
              description="Create a task, or ask an AI employee to break work down for you."
              action={{ label: "New task", onClick: () => openCreate() }}
            />
          </div>
        ) : view === "board" ? (
          <BoardView columns={columns} onMove={applyMove} onOpen={setDetail} onQuickAdd={openCreate} canAdd={groupRooms.length > 0} />
        ) : view === "list" ? (
          <ListView tasks={tasks} onOpen={setDetail} />
        ) : (
          <TableView tasks={tasks} state={state} onOpen={setDetail} />
        )}

        <IntegrationsStrip
          title="Task integrations"
          ids={["linear", "jira", "githubapp", "notion", "slack", "gcal", "zapier", "make", "webhook"]}
        />
      </WorkspaceCanvas>

      {detail && (
        <TaskDetailModal
          task={detail}
          onClose={() => setDetail(null)}
          onAutopilot={(t) => {
            setDetail(null);
            openAutopilot({
              objective: [t.title, t.description].filter(Boolean).join(" — "),
              employeeId: t.assigneeType === "ai" ? t.assigneeId : undefined,
              roomId: t.roomId,
              topicId: t.topicId,
              taskId: t.id,
            });
          }}
        />
      )}
      <CreateTaskGlobalModal
        open={createOpen}
        defaults={createDefaults}
        onClose={() => { setCreateOpen(false); setCreateDefaults(undefined); }}
      />
      <AutonomousLauncher
        open={autopilotOpen}
        onClose={() => setAutopilotOpen(false)}
        workspaceId={state.workspace.id}
        employees={state.employees}
        defaultObjective={autopilotDefaults.objective ?? ""}
        defaultEmployeeId={autopilotDefaults.employeeId}
        roomId={autopilotDefaults.roomId}
        topicId={autopilotDefaults.topicId}
        taskId={autopilotDefaults.taskId}
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

type Column = { key: string; title: string; tone: Tone; items: Task[]; patch: Partial<Task> };

function BoardView({
  columns,
  onMove,
  onOpen,
  onQuickAdd,
  canAdd,
}: {
  columns: Column[];
  onMove: (id: string, patch: Partial<Task>) => void;
  onOpen: (t: Task) => void;
  onQuickAdd: (defaults?: Partial<Task>) => void;
  canAdd: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((col) => {
        const total = col.items.length;
        return (
          <KanbanColumn
            key={col.key}
            title={col.title}
            tone={col.tone}
            count={total}
            active={overKey === col.key && dragId !== null}
            onDragOver={(e) => {
              e.preventDefault();
              setOverKey(col.key);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              if (id) onMove(id, col.patch);
              setDragId(null);
              setOverKey(null);
            }}
            footer={
              canAdd ? (
                <button
                  type="button"
                  onClick={() => onQuickAdd(col.patch)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-accent"
                >
                  <Plus className="h-3.5 w-3.5" /> Add task
                </button>
              ) : undefined
            }
          >
            {total === 0 ? (
              <ColumnEmpty />
            ) : (
              col.items.map((t) => (
                <BoardCard
                  key={t.id}
                  task={t}
                  dragging={dragId === t.id}
                  onDragStart={(e) => {
                    setDragId(t.id);
                    e.dataTransfer.setData("text/plain", t.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { setDragId(null); setOverKey(null); }}
                  onClick={() => onOpen(t)}
                />
              ))
            )}
          </KanbanColumn>
        );
      })}
    </div>
  );
}

function AssigneeChip({ task }: { task: Task }) {
  const { state } = useStore();
  if (task.assigneeType === "ai") {
    const e = state.employees.find((x) => x.id === task.assigneeId);
    if (e) return <EmployeeAvatar employee={e} size="xs" showStatus={false} />;
  }
  return <HumanAvatar name={state.user?.name ?? "You"} size="xs" />;
}

function BoardCard({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: Task;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const pri = PRIORITY_META[task.priority];
  const due = formatDue(task.dueDate);
  const { state } = useStore();
  const room = state.rooms.find((r) => r.id === task.roomId);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border border-border bg-surface p-2.5 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift",
        dragging && "rotate-1 opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", toneOf(pri.tone).bar)} title={`${pri.label} priority`} />
        <p className="flex-1 text-[13px] font-medium leading-snug text-ink line-clamp-3">{task.title}</p>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                due.overdue ? "bg-rose-500/12 text-rose-600" : "bg-ink/5 text-ink-3",
              )}
            >
              <CalendarClock className="h-3 w-3" /> {due.label}
            </span>
          )}
          {room && <span className="max-w-[92px] truncate text-[10px] text-ink-3">{room.name}</span>}
        </div>
        <AssigneeChip task={task} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ListView({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const groups = STATUS_ORDER.map((s) => ({ status: s, items: tasks.filter((t) => t.status === s) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const meta = STATUS_META[g.status];
        return (
          <div key={g.status}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <StatusPill tone={meta.tone} label={meta.label} />
              <span className="text-xs text-ink-3">{g.items.length}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              {g.items.map((t, i) => (
                <ListRow key={t.id} task={t} onOpen={() => onOpen(t)} last={i === g.items.length - 1} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListRow({ task, onOpen, last }: { task: Task; onOpen: () => void; last: boolean }) {
  const pri = PRIORITY_META[task.priority];
  const due = formatDue(task.dueDate);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
        !last && "border-b border-border/60",
      )}
    >
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", toneOf(pri.tone).bar)} />
      <span className="flex-1 truncate text-sm font-medium text-ink">{task.title}</span>
      {due && (
        <span className={cn("hidden shrink-0 text-xs sm:inline", due.overdue ? "text-rose-600" : "text-ink-3")}>
          {due.label}
        </span>
      )}
      <StatusPill tone={PRIORITY_META[task.priority].tone} label={pri.label} dot={false} className="hidden sm:inline-flex" />
      <AssigneeChip task={task} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TableView({
  tasks,
  state,
  onOpen,
}: {
  tasks: Task[];
  state: ReturnType<typeof useStore>["state"];
  onOpen: (t: Task) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-4 py-2.5 font-semibold">Task</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Priority</th>
              <th className="px-4 py-2.5 font-semibold">Owner</th>
              <th className="px-4 py-2.5 font-semibold">Room</th>
              <th className="px-4 py-2.5 font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const room = state.rooms.find((r) => r.id === t.roomId);
              const emp = state.employees.find((e) => e.id === t.assigneeId);
              const due = formatDue(t.dueDate);
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen(t)}
                  className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40"
                >
                  <td className="max-w-[280px] px-4 py-3">
                    <span className="block truncate font-medium text-ink">{t.title}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_META[t.status].tone} label={STATUS_META[t.status].label} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                      <Flag className={cn("h-3.5 w-3.5", toneOf(PRIORITY_META[t.priority].tone).text)} />
                      {PRIORITY_META[t.priority].label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-ink-2">
                      {t.assigneeType === "ai" && emp ? (
                        <EmployeeAvatar employee={emp} size="xs" showStatus={false} />
                      ) : (
                        <HumanAvatar name={state.user?.name ?? "You"} size="xs" />
                      )}
                      <span className="truncate">{emp?.name ?? state.user?.name ?? "You"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">{room?.name ?? "—"}</td>
                  <td className={cn("px-4 py-3 text-xs", due?.overdue ? "text-rose-600" : "text-ink-3")}>
                    {due?.label ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink-2 outline-none transition-colors hover:border-accent/40 focus:border-accent"
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Detail modal (kept, refined)
// ---------------------------------------------------------------------------

function TaskDetailModal({
  task,
  onClose,
  onAutopilot,
}: {
  task: Task;
  onClose: () => void;
  onAutopilot: (task: Task) => void;
}) {
  const { state, actions, backend } = useStore();
  const router = useRouter();
  const respond = useResponder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const current = state.tasks.find((t) => t.id === task.id) ?? task;
  const assignee = state.employees.find((e) => e.id === current.assigneeId);
  const room = state.rooms.find((r) => r.id === current.roomId);
  const relatedLog = state.workLog
    .filter((w) => w.relatedEntityId === current.id || (w.roomId === current.roomId && w.employeeId === current.assigneeId))
    .slice(0, 5);
  const meta = STATUS_META[current.status];

  const askToWork = async () => {
    if (!assignee || !room) return;
    actions.updateTask(current.id, { status: "in_progress" });
    onClose();
    router.push(`/rooms/${room.id}`);
    setTimeout(() => respond(room.id, assignee.id, `@${assignee.name} please work on: ${current.title}`), 400);
  };

  const removeTask = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      if (backend === "supabase") await deleteTaskClient(current.id);
      actions.removeTask(current.id);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete task.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={current.title} subtitle={room?.name} onClose={onClose} icon={<CheckSquare className="h-5 w-5" />} />
      <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={meta.tone} label={meta.label} />
          <StatusPill tone={PRIORITY_META[current.priority].tone} label={`${PRIORITY_META[current.priority].label} priority`} dot={false} />
          {isOverdue(current) && <StatusPill tone="rose" label="Overdue" />}
        </div>

        {current.description && <p className="text-sm leading-relaxed text-ink-2">{current.description}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Meta label="Status">
            <select
              className="input-field !py-1.5 text-xs"
              value={current.status}
              onChange={(e) => actions.updateTask(current.id, { status: e.target.value as TaskStatus })}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </Meta>
          <Meta label="Priority">
            <select
              className="input-field !py-1.5 text-xs"
              value={current.priority}
              onChange={(e) => actions.updateTask(current.id, { priority: e.target.value as TaskPriority })}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </Meta>
          <Meta label="Assignee">
            <span className="flex items-center gap-1.5 text-sm text-ink-2">
              {assignee ? <EmployeeAvatar employee={assignee} size="xs" showStatus={false} /> : <HumanAvatar name={state.user?.name ?? "You"} size="xs" />}
              <span className="truncate">{assignee?.name ?? state.user?.name ?? "You"}</span>
            </span>
          </Meta>
          <Meta label="Created from"><span className="text-sm text-ink-2">{current.createdFrom ?? "—"}</span></Meta>
        </div>

        <div>
          <div className="section-title mb-2">Related activity</div>
          {relatedLog.length === 0 ? (
            <p className="text-sm text-ink-3">No related activity yet.</p>
          ) : (
            <WorkLogTimeline events={relatedLog} compact />
          )}
        </div>
      </div>
      {deleteError && <div className="border-t border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800">{deleteError}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {current.status !== "done" ? (
            <Button size="sm" variant="secondary" onClick={() => actions.updateTask(current.id, { status: "done" })}>
              <CheckCircle2 className="h-4 w-4" /> Mark complete
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => actions.updateTask(current.id, { status: "open" })}>
              Reopen
            </Button>
          )}
          {room && (
            <Button size="sm" variant="ghost" onClick={() => { onClose(); router.push(`/rooms/${room.id}`); }}>
              Open room
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current.status !== "done" && (
            <Button size="sm" variant="secondary" onClick={() => onAutopilot(current)}>
              <Bot className="h-4 w-4" /> Run autonomously
            </Button>
          )}
          {assignee && current.assigneeType === "ai" && (
            <Button size="sm" onClick={askToWork}>
              <Sparkles className="h-4 w-4" /> Ask {assignee.name.split(" ")[0]} to work on it
            </Button>
          )}
          {confirmDelete ? (
            <>
              <span className="text-xs text-ink-3">Delete permanently?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => void removeTask()} disabled={deleting}>
                {deleting ? "Deleting…" : "Confirm"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} className="text-rose-600 hover:text-rose-700">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
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

function CreateTaskGlobalModal({
  open,
  defaults,
  onClose,
}: {
  open: boolean;
  defaults?: Partial<Task>;
  onClose: () => void;
}) {
  const { state, actions } = useStore();
  const groupRooms = getGroupRooms(state.rooms);
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(groupRooms[0]?.id ?? "");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(defaults?.priority ?? "medium");
  const [dueDate, setDueDate] = useState("");

  const roomEmployees = state.rooms.find((r) => r.id === roomId)?.aiEmployees ?? [];

  const create = () => {
    if (!title.trim() || !roomId) return;
    const isHuman = assignee === "";
    actions.createTask({
      roomId,
      title: title.trim(),
      priority,
      status: (defaults?.status as TaskStatus) ?? "open",
      assigneeType: isHuman ? "human" : "ai",
      assigneeId: isHuman ? state.user?.id ?? "user-shubham" : assignee,
      createdFrom: "Manual",
      ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
    });
    setTitle("");
    setDueDate("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Create a task" onClose={onClose} icon={<CheckSquare className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Title</span>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Room</span>
            <select className="input-field" value={roomId} onChange={(e) => { setRoomId(e.target.value); setAssignee(""); }}>
              {groupRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Priority</span>
            <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Assignee</span>
            <select className="input-field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{state.user?.name ?? "You"} (human)</option>
              {roomEmployees.map((id) => {
                const e = state.employees.find((x) => x.id === id);
                return e ? <option key={id} value={id}>{e.name}</option> : null;
              })}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Due date</span>
            <input type="date" className="input-field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Create task</Button>
      </div>
    </Modal>
  );
}
