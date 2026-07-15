"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer } from "@/components/Page";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { TaskCard } from "@/components/TaskCard";
import { MemoryCard } from "@/components/MemoryCard";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { EmptyState } from "@/components/States";
import { cn, timeAgo } from "@/lib/utils";
import { EmployeeStatus } from "@/lib/types";
import { EmployeeIntelligencePanel } from "@/components/workforce/EmployeeIntelligencePanel";
import { EmployeeCapabilitiesPanel } from "@/components/workforce/EmployeeCapabilitiesPanel";
import { EmployeePermissionsPanel } from "@/components/workforce/EmployeePermissionsPanel";
import { EmployeeOperatingBriefPanel } from "@/components/workforce/EmployeeOperatingBriefPanel";
import { formatEmployeeIntelligenceSummary } from "@/lib/ai/intelligence-policy";
import { isMayaEmployee, isSystemEmployee, effectiveEmployeeStatus } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { storeMayaEmployeeContext } from "@/components/maya/MayaDmEmptyState";
import { WorkforceCallButton } from "@/components/calls/WorkforceCallButton";
import {
  ArrowLeft,
  Bot,
  CheckSquare,
  MessageSquare,
  Pencil,
  Plus,
  Target,
} from "lucide-react";

type EmployeeUsageStats = {
  weekWorkHours: number;
  lifetimeWorkHours: number;
};

export default function EmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.employeeId as string;
  const { state, actions, backend } = useStore();
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [usageStats, setUsageStats] = useState<EmployeeUsageStats | null>(null);

  const employee = state.employees.find((e) => e.id === employeeId);
  const maya = state.employees.find(isMayaEmployee);

  const empTasks = useMemo(
    () => (employee ? state.tasks.filter((t) => t.assigneeId === employee.id) : []),
    [employee, state.tasks],
  );
  const empMemory = useMemo(
    () => (employee ? state.memory.filter((m) => m.createdById === employee.id) : []),
    [employee, state.memory],
  );
  const empLog = useMemo(
    () =>
      employee
        ? state.workLog
            .filter((w) => w.employeeId === employee.id)
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        : [],
    [employee, state.workLog],
  );

  useEffect(() => {
    if (!employeeId || !state.workspace?.id || backend !== "supabase") {
      setUsageStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(
          `/api/employees/${employeeId}/usage?workspaceId=${encodeURIComponent(state.workspace.id)}`,
          { headers },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setUsageStats({
          weekWorkHours: Number(body.weekWorkHours ?? 0),
          lifetimeWorkHours: Number(body.lifetimeWorkHours ?? 0),
        });
      } catch {
        if (!cancelled) setUsageStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, employeeId, state.workspace?.id]);

  if (!employee) {
    return (
      <PageContainer>
        <EmptyState
          icon={Bot}
          title="Employee not found"
          action={{ label: "Back to workforce", onClick: () => router.push("/workforce") }}
        />
      </PageContainer>
    );
  }

  const room = state.rooms.find((r) => r.id === employee.defaultRoomId);
  const activeTask =
    empTasks.find((t) => t.status === "in_progress") ??
    empTasks.find((t) => t.status === "open" || t.status === "blocked");
  const openTasks = empTasks.filter((t) => t.status !== "done");

  return (
    <PageContainer wide>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-5 flex items-center gap-1.5 text-sm text-ink-3 transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {isMayaEmployee(employee) && (
        <div className="mb-5 rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3 text-sm text-accent-d">
          {MAYA_EMPLOYEE_NAME} is your permanent AI Workforce Manager — recruiting and workspace
          guidance only. Her role, instructions, permissions, and tools are fixed by the product and
          cannot be edited. DM-only, always available, not counted toward hire limits, and never
          assignable to rooms or inbox email.
        </div>
      )}

      {/* Header */}
      <header className="mb-8 border-b border-border pb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <EmployeeAvatar employee={employee} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{employee.name}</h1>
              <EmployeeStatusBadge status={effectiveEmployeeStatus(employee)} />
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {employee.role}
              {employee.seniority ? ` · ${employee.seniority}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium",
                  employee.provider === "mock"
                    ? "bg-muted text-ink-2"
                    : "bg-emerald-50 text-emerald-800",
                )}
              >
                {employee.provider === "mock" ? "Simulated" : "Live AI"}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5">
                {formatEmployeeIntelligenceSummary(employee)}
              </span>
              {room && (
                <span className="rounded-md bg-muted px-2 py-0.5">{room.name}</span>
              )}
              <span>Active {timeAgo(employee.lastActiveAt)}</span>
            </div>
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
              <div>
                <dt className="inline text-ink-3">This week </dt>
                <dd className="inline font-medium tabular-nums text-ink">
                  {(usageStats?.weekWorkHours ?? 0).toFixed(2)} hrs
                </dd>
              </div>
              <div>
                <dt className="inline text-ink-3">Since hire </dt>
                <dd className="inline font-medium tabular-nums text-ink">
                  {(usageStats?.lifetimeWorkHours ?? 0).toFixed(2)} hrs
                </dd>
              </div>
              <div>
                <dt className="inline text-ink-3">Messages </dt>
                <dd className="inline font-medium text-ink">{employee.messagesSent}</dd>
              </div>
              <div>
                <dt className="inline text-ink-3">Memory </dt>
                <dd className="inline font-medium text-ink">{employee.memoryCount}</dd>
              </div>
              <div>
                <dt className="inline text-ink-3">Approvals </dt>
                <dd className="inline font-medium text-ink">{employee.approvalsRequested}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {!isSystemEmployee(employee) && maya && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  storeMayaEmployeeContext({
                    employeeId: employee.id,
                    name: employee.name,
                    role: employee.role,
                    instructions: employee.instructions,
                    communicationStyle: employee.communicationStyle,
                    modelMode: employee.modelMode,
                    successCriteria: employee.successCriteria,
                  });
                  const dm = actions.openOrCreateDM(maya.id);
                  router.push(`/rooms/${dm.id}?intent=improve_employee`);
                }}
              >
                Ask {MAYA_EMPLOYEE_NAME} to improve
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => router.push(room ? `/rooms/${room.id}` : "/rooms")}
            >
              <MessageSquare className="h-4 w-4" /> Message
            </Button>
            {!isMayaEmployee(employee) && (
              <>
                <WorkforceCallButton
                  roomId={employee.defaultRoomId ?? undefined}
                  size="sm"
                  variant="secondary"
                />
                <Button size="sm" variant="secondary" onClick={() => setTaskOpen(true)}>
                  <Plus className="h-4 w-4" /> Assign task
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" /> Edit profile
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.9fr)]">
        <div className="space-y-8">
          <EmployeeOperatingBriefPanel
            employee={employee}
            onSave={(patch) => {
              actions.updateEmployee(employee.id, patch);
            }}
          />

          {!isMayaEmployee(employee) && (
            <EmployeeIntelligencePanel
              employee={employee}
              editable
              onSave={(patch) => {
                actions.updateEmployee(employee.id, patch);
              }}
            />
          )}

          {!isMayaEmployee(employee) && (
            <section className="rounded-2xl border border-border bg-surface px-5 py-5">
              <EmployeeCapabilitiesPanel
                employee={employee}
                workspaceId={state.workspace.id}
                backend={backend}
                onSave={(updated) =>
                  actions.updateEmployee(employee.id, { tools: updated.tools })
                }
              />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink">
              Memory created ({empMemory.length})
            </h2>
            {empMemory.length === 0 ? (
              <p className="text-sm text-ink-3">No memory entries yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {empMemory.slice(0, 4).map((m) => (
                  <MemoryCard key={m.id} memory={m} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
            {empLog.length === 0 ? (
              <p className="text-sm text-ink-3">No activity yet.</p>
            ) : (
              <WorkLogTimeline events={empLog.slice(0, 10)} />
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface px-5 py-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <Target className="h-4 w-4 text-accent" />
              Current work
            </h2>
            {activeTask ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">{activeTask.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 capitalize">
                    {activeTask.status.replace("_", " ")}
                  </span>
                  <span className="capitalize">{activeTask.priority} priority</span>
                  {room && <span>{room.name}</span>}
                </div>
                {activeTask.description && (
                  <p className="text-xs leading-relaxed text-ink-3">{activeTask.description}</p>
                )}
              </div>
            ) : employee.currentTask ? (
              <p className="text-sm text-ink-2">{employee.currentTask}</p>
            ) : (
              <p className="text-sm text-ink-3">Idle — no open task. Assign something to start.</p>
            )}
          </section>

          {!isMayaEmployee(employee) && (
            <section className="rounded-2xl border border-border bg-surface px-5 py-5">
              <EmployeePermissionsPanel
                employee={employee}
                onSave={(permissions) => {
                  actions.updateEmployee(employee.id, { permissions });
                }}
              />
            </section>
          )}

          <section className="rounded-2xl border border-border bg-surface px-5 py-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <CheckSquare className="h-4 w-4 text-accent" />
              Assigned tasks ({openTasks.length})
            </h2>
            {openTasks.length === 0 ? (
              <p className="text-sm text-ink-3">No open tasks.</p>
            ) : (
              <div className="space-y-2">
                {openTasks.slice(0, 6).map((t) => (
                  <TaskCard key={t.id} task={t} compact />
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <EditEmployeeModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        employeeId={employee.id}
      />
      <AssignTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        employeeId={employee.id}
      />
    </PageContainer>
  );
}

/** Name / role / status only — operating instructions edit inline on the profile. */
function EditEmployeeModal({
  open,
  onClose,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
}) {
  const { state, actions } = useStore();
  const employee = state.employees.find((e) => e.id === employeeId);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [statusVal, setStatusVal] = useState<EmployeeStatus>("online");

  useEffect(() => {
    if (!open || !employee || isMayaEmployee(employee)) return;
    setName(employee.name);
    setRole(employee.role);
    setStatusVal(employee.status);
  }, [open, employee]);

  if (!employee || isMayaEmployee(employee)) {
    return null;
  }

  const save = () => {
    actions.updateEmployee(employeeId, {
      name: name.trim() || employee.name,
      role: role.trim() || employee.role,
      status: statusVal,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <ModalHeader title="Edit profile" onClose={onClose} icon={<Pencil className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Name</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Role title</span>
          <input className="input-field" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Status</span>
          <select
            className="input-field"
            value={statusVal}
            onChange={(e) => setStatusVal(e.target.value as EmployeeStatus)}
          >
            {(
              [
                "online",
                "idle",
                "working",
                "waiting_approval",
                "on_call",
                "blocked",
              ] as EmployeeStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-ink-3">
          To change standing instructions, use <span className="font-medium text-ink-2">Edit instructions</span>{" "}
          on the Operating brief.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save changes</Button>
      </div>
    </Modal>
  );
}

function AssignTaskModal({
  open,
  onClose,
  employeeId,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
}) {
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
      <ModalHeader
        title={`Assign a task to ${employee.name}`}
        onClose={onClose}
        icon={<CheckSquare className="h-5 w-5" />}
      />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Task</span>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should they work on?"
            autoFocus
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Priority</span>
          <select
            className="input-field"
            value={priority}
            onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={create} disabled={!title.trim()}>
          Assign task
        </Button>
      </div>
    </Modal>
  );
}
