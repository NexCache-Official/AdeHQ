"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer } from "@/components/Page";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { Card, Button, Modal, ModalHeader, Progress } from "@/components/ui";
import { TaskCard } from "@/components/TaskCard";
import { MemoryCard } from "@/components/MemoryCard";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { EmptyState } from "@/components/States";
import { toolIcon, TOOL_STATUS_META } from "@/lib/icons";
import { cn, timeAgo } from "@/lib/utils";
import { ENABLE_DEMO_MODE, normalizeLiveProvider } from "@/lib/config/features";
import { EmployeeStatus, ModelMode } from "@/lib/types";
import {
  defaultModelModeForRole,
  MODEL_MODE_LABELS,
} from "@/lib/ai/model-catalog";
import {
  ArrowLeft,
  Bot,
  CheckSquare,
  MessageSquare,
  Phone,
  Pencil,
  Plus,
  Target,
  Zap,
} from "lucide-react";

export default function EmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.employeeId as string;
  const { state, actions } = useStore();
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const employee = state.employees.find((e) => e.id === employeeId);

  if (!employee) {
    return (
      <PageContainer>
        <EmptyState icon={Bot} title="Employee not found" action={{ label: "Back to workforce", onClick: () => router.push("/workforce") }} />
      </PageContainer>
    );
  }

  const room = state.rooms.find((r) => r.id === employee.defaultRoomId);
  const empTasks = state.tasks.filter((t) => t.assigneeId === employee.id);
  const empMemory = state.memory.filter((m) => m.createdById === employee.id);
  const empLog = state.workLog
    .filter((w) => w.employeeId === employee.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const activeTask = empTasks.find((t) => t.status === "in_progress") ?? empTasks.find((t) => t.status !== "done");

  const perms = [
    { label: "Read project memory", on: employee.permissions.readMemory },
    { label: "Write draft memory", on: employee.permissions.writeDraftMemory },
    { label: "Pin memory", on: employee.permissions.pinMemory },
    { label: "Create tasks", on: employee.permissions.createTasks },
    { label: "Assign tasks", on: employee.permissions.assignTasks },
    { label: "Message other employees", on: employee.permissions.messageEmployees },
    { label: "Start calls", on: employee.permissions.startCalls },
    { label: "Request human approval", on: employee.permissions.requestApproval },
    { label: "Approval before external actions", on: employee.permissions.approvalBeforeExternal },
    { label: "Approval before sending emails", on: employee.permissions.approvalBeforeEmails },
    { label: "Approval before changing code", on: employee.permissions.approvalBeforeCode },
    { label: "Approval before billing tools", on: employee.permissions.approvalBeforeBilling },
  ];

  const metrics = [
    { label: "Tasks completed", value: employee.tasksCompleted },
    { label: "Memory written", value: employee.memoryCount },
    { label: "Approvals requested", value: employee.approvalsRequested },
    { label: "Messages sent", value: employee.messagesSent },
    { label: "Avg response", value: employee.avgResponseTime },
    { label: "Trust score", value: `${employee.trustScore}%` },
  ];

  return (
    <PageContainer wide>
      <button onClick={() => router.back()} className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <Card className="relative mb-6 overflow-hidden p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl" style={{ background: `${employee.accent}22` }} />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <EmployeeAvatar employee={employee} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{employee.name}</h1>
              <EmployeeStatusBadge status={employee.status} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{employee.role} · {employee.seniority}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="chip">{employee.provider} · {employee.model}</span>
              {employee.provider.toLowerCase() === "siliconflow" && (
                <span className="chip bg-emerald-50 text-emerald-700">Live AI</span>
              )}
              {room && <span className="chip">{room.name}</span>}
              <span className="text-slate-500">Active {timeAgo(employee.lastActiveAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => router.push(room ? `/rooms/${room.id}` : "/rooms")}>
              <MessageSquare className="h-4 w-4" /> Message
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push(`/calls?room=${employee.defaultRoomId ?? ""}`)}>
              <Phone className="h-4 w-4" /> Call
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTaskOpen(true)}>
              <Plus className="h-4 w-4" /> Assign task
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Role & instructions */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Role & instructions</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Standing instructions" value={employee.instructions} />
              <Field label="Communication style" value={employee.communicationStyle} />
              <Field label="Success criteria" value={employee.successCriteria} />
              <Field label="Seniority" value={employee.seniority} />
            </div>
          </Card>

          {/* Tool backpack */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Tool backpack ({employee.tools.length})</h2>
            {employee.tools.length === 0 ? (
              <p className="text-sm text-slate-500">No tools assigned yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {employee.tools.map((t) => {
                  const TI = toolIcon(t.toolId);
                  const meta = TOOL_STATUS_META[t.status];
                  return (
                    <div key={t.toolId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-700">
                        <TI className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">{t.name}</div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className={meta.color}>{meta.label}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-500">{t.permission}</span>
                        </div>
                      </div>
                      {t.lastUsedAt && <span className="text-[10px] text-slate-600">{timeAgo(t.lastUsedAt)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Memory & history */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Memory created ({empMemory.length})</h2>
            {empMemory.length === 0 ? (
              <p className="text-sm text-slate-500">No memory entries yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {empMemory.slice(0, 4).map((m) => <MemoryCard key={m.id} memory={m} />)}
              </div>
            )}
          </Card>

          {/* Activity */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Activity timeline</h2>
            {empLog.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <WorkLogTimeline events={empLog.slice(0, 10)} />
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Current work */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Target className="h-4 w-4 text-accent-600" /> Current work
            </h2>
            {employee.currentTask ? (
              <>
                <p className="text-sm text-slate-700">{employee.currentTask}</p>
                <div className="mt-3">
                  <Progress value={employee.status === "working" ? 62 : employee.status === "waiting_approval" ? 90 : 30} />
                  <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                    <span>{room?.name ?? "No room"}</span>
                    <span>{employee.status === "waiting_approval" ? "Awaiting approval" : "In progress"}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Idle — no active task. Give them something to do.</p>
            )}
          </Card>

          {/* Permissions */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Permissions</h2>
            <div className="space-y-1.5">
              {perms.map((p) => (
                <div key={p.label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{p.label}</span>
                  <span className={cn("h-2 w-2 rounded-full", p.on ? "bg-emerald-400" : "bg-slate-600")} />
                </div>
              ))}
            </div>
          </Card>

          {/* Performance */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Zap className="h-4 w-4 text-amber-700" /> Performance
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-xl bg-slate-50 p-3">
                  <div className="text-lg font-semibold text-slate-900">{m.value}</div>
                  <div className="text-[11px] text-slate-500">{m.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Assigned tasks */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CheckSquare className="h-4 w-4 text-sky-300" /> Assigned tasks
            </h2>
            {empTasks.length === 0 ? (
              <p className="text-sm text-slate-500">No tasks assigned.</p>
            ) : (
              <div className="space-y-2">
                {empTasks.slice(0, 5).map((t) => <TaskCard key={t.id} task={t} compact />)}
              </div>
            )}
          </Card>
        </div>
      </div>

      <EditEmployeeModal open={editOpen} onClose={() => setEditOpen(false)} employeeId={employee.id} />
      <AssignTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} employeeId={employee.id} />
    </PageContainer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="section-title mb-1">{label}</div>
      <p className="text-sm leading-relaxed text-slate-600">{value}</p>
    </div>
  );
}

function EditEmployeeModal({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId: string }) {
  const { state, actions } = useStore();
  const employee = state.employees.find((e) => e.id === employeeId)!;
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role);
  const [instructions, setInstructions] = useState(employee.instructions);
  const [statusVal, setStatusVal] = useState<EmployeeStatus>(employee.status);
  const [provider, setProvider] = useState(employee.provider);
  const [model, setModel] = useState(employee.model);
  const [modelMode, setModelMode] = useState<ModelMode>(
    employee.modelMode ?? defaultModelModeForRole(employee.roleKey),
  );

  const save = () => {
    actions.updateEmployee(employeeId, {
      name,
      role,
      instructions,
      status: statusVal,
      provider: normalizeLiveProvider(provider),
      model,
      modelMode,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Edit employee" onClose={onClose} icon={<Pencil className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Name</span>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Role title</span>
            <input className="input-field" value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Standing instructions</span>
          <textarea className="input-field min-h-[88px] resize-none" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Status</span>
          <select className="input-field" value={statusVal} onChange={(e) => setStatusVal(e.target.value as EmployeeStatus)}>
            {(["idle", "working", "waiting_approval", "on_call", "blocked"] as EmployeeStatus[]).map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">AI provider</span>
          <select className="input-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="siliconflow">SiliconFlow</option>
            {ENABLE_DEMO_MODE && <option value="mock">Mock</option>}
          </select>
        </label>
        {provider !== "mock" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Intelligence level</span>
            <select
              className="input-field"
              value={modelMode}
              onChange={(e) => setModelMode(e.target.value as ModelMode)}
            >
              {(Object.keys(MODEL_MODE_LABELS) as ModelMode[])
                .filter((m) => m !== "creative")
                .map((m) => (
                  <option key={m} value={m}>
                    {MODEL_MODE_LABELS[m]}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-slate-500">Model override (optional)</span>
          <input className="input-field" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Leave blank for role-based default" />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save changes</Button>
      </div>
    </Modal>
  );
}

function AssignTaskModal({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId: string }) {
  const { state, actions } = useStore();
  const employee = state.employees.find((e) => e.id === employeeId)!;
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");

  const create = () => {
    if (!title.trim()) return;
    actions.createTask({
      roomId: employee.defaultRoomId ?? state.rooms[0]?.id ?? "",
      title: title.trim(),
      priority,
      assigneeType: "ai",
      assigneeId: employeeId,
      status: "open",
      createdFrom: "Assigned from profile",
    });
    actions.updateEmployee(employeeId, { currentTask: title.trim(), status: "working" });
    setTitle("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <ModalHeader title={`Assign a task to ${employee.name}`} onClose={onClose} icon={<CheckSquare className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Task</span>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What should they work on?" autoFocus />
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
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Assign task</Button>
      </div>
    </Modal>
  );
}
