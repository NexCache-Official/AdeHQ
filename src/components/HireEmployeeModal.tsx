"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ENABLE_DEMO_MODE, WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";
import {
  defaultModelModeForRole,
  MODEL_MODE_LABELS,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { Button, Modal, ModalHeader, Toggle } from "./ui";
import { useStore } from "@/lib/demo-store";
import {
  ROLE_TEMPLATES,
  RoleTemplate,
  TOOL_CATALOG,
  defaultPermissions,
} from "@/lib/demo";
import { AIEmployee, EmployeePermissions, ToolAccess } from "@/lib/types";
import { roleIcon, toolIcon } from "@/lib/icons";
import { getGroupRooms } from "@/lib/rooms";
import { cn, uid, nowISO, avatarGradient } from "@/lib/utils";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { motion } from "framer-motion";

const PERMISSION_LABELS: { key: keyof EmployeePermissions; label: string; sensitive?: boolean }[] = [
  { key: "readMemory", label: "Can read project memory" },
  { key: "writeDraftMemory", label: "Can write draft memory" },
  { key: "pinMemory", label: "Can pin memory" },
  { key: "createTasks", label: "Can create tasks" },
  { key: "assignTasks", label: "Can assign tasks" },
  { key: "messageEmployees", label: "Can message other AI employees" },
  { key: "startCalls", label: WORKFORCE_CALLS_ENABLED ? "Can start calls" : "Can start calls (coming soon)" },
  { key: "requestApproval", label: "Can request human approval" },
  { key: "approvalBeforeExternal", label: "Needs approval before external actions", sensitive: true },
  { key: "approvalBeforeEmails", label: "Needs approval before sending emails", sensitive: true },
  { key: "approvalBeforeCode", label: "Needs approval before changing code", sensitive: true },
  { key: "approvalBeforeBilling", label: "Needs approval before billing tools", sensitive: true },
];

const STEPS = ["Role", "Customize", "Tools", "Permissions", "Review"];

export function HireEmployeeModal({
  open,
  onClose,
  presetRoom,
}: {
  open: boolean;
  onClose: () => void;
  presetRoom?: string;
}) {
  const { state, actions } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<RoleTemplate | null>(null);
  const [name, setName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [seniority, setSeniority] = useState("Senior");
  const [provider, setProvider] = useState("siliconflow");
  const [modelMode, setModelMode] = useState<ModelMode>("balanced");
  const [instructions, setInstructions] = useState("");
  const [roomId, setRoomId] = useState<string>(presetRoom ?? "");
  const [tools, setTools] = useState<Record<string, ToolAccess["permission"]>>({});
  const [perms, setPerms] = useState<EmployeePermissions>(defaultPermissions());
  const [hired, setHired] = useState<AIEmployee | null>(null);

  const reset = () => {
    setStep(0);
    setTemplate(null);
    setName("");
    setRoleTitle("");
    setSeniority("Senior");
    setProvider("siliconflow");
    setModelMode("balanced");
    setInstructions("");
    setRoomId(presetRoom ?? "");
    setTools({});
    setPerms(defaultPermissions());
    setHired(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickTemplate = (tpl: RoleTemplate) => {
    setTemplate(tpl);
    setName(tpl.name);
    setRoleTitle(tpl.role);
    setProvider("siliconflow");
    setModelMode(defaultModelModeForRole(tpl.key));
    setInstructions(tpl.instructions);
    const initialTools: Record<string, ToolAccess["permission"]> = {};
    tpl.suggestedTools.forEach((t) => (initialTools[t] = "read"));
    setTools(initialTools);
    setStep(1);
  };

  const toggleTool = (id: string) => {
    setTools((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = "read";
      return next;
    });
  };

  const groupRooms = useMemo(() => getGroupRooms(state.rooms), [state.rooms]);

  const selectedToolList = useMemo<ToolAccess[]>(
    () =>
      Object.entries(tools).map(([id, permission]) => {
        const meta = TOOL_CATALOG.find((t) => t.id === id)!;
        return {
          toolId: id,
          name: meta.name,
          category: meta.category,
          status: meta.status,
          permission,
        };
      }),
    [tools],
  );

  const finishHire = () => {
    if (!template) return;
    const employee: AIEmployee = {
      id: uid("emp"),
      name: name || template.name,
      role: roleTitle || template.role,
      roleKey: template.key,
      provider: provider === "mock" ? "mock" : "siliconflow",
      model: "",
      modelMode,
      seniority,
      status: "idle",
      currentTask: undefined,
      instructions: instructions || template.instructions,
      communicationStyle: template.communicationStyle,
      successCriteria: template.successCriteria,
      tools: selectedToolList,
      permissions: perms,
      memoryCount: 0,
      tasksCompleted: 0,
      messagesSent: 0,
      approvalsRequested: 0,
      avgResponseTime: "—",
      trustScore: 75,
      accent: template.accent,
      defaultRoomId:
        roomId && groupRooms.some((r) => r.id === roomId) ? roomId : undefined,
      lastActiveAt: nowISO(),
      createdAt: nowISO(),
    };
    actions.hireEmployee(employee);
    setHired(employee);
    setStep(5);
  };

  const canNext =
    step === 0 ? !!template : step === 1 ? !!name.trim() : true;

  return (
    <Modal open={open} onClose={close} size="xl">
      {hired ? (
        <HireSuccess
          employee={hired}
          roomId={roomId && groupRooms.some((r) => r.id === roomId) ? roomId : ""}
          rooms={groupRooms}
          onAddToRoom={(rid) => {
            actions.addEmployeeToRoom(rid, hired.id);
            close();
            router.push(`/rooms/${rid}`);
          }}
          onViewProfile={() => {
            close();
            router.push(`/workforce/${hired.id}`);
          }}
          onDone={close}
        />
      ) : (
        <>
          <ModalHeader
            title="Hire an AI employee"
            subtitle={STEPS[step] ? `Step ${step + 1} of 5 · ${STEPS[step]}` : undefined}
            onClose={close}
            icon={<UserPlus className="h-5 w-5" />}
          />

          {/* Stepper */}
          <div className="flex items-center gap-1 px-6 pt-4">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    i <= step ? "bg-accent-500" : "bg-slate-100",
                  )}
                />
              </div>
            ))}
          </div>

          <div className="max-h-[min(62vh,540px)] overflow-y-auto px-6 py-5">
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {ROLE_TEMPLATES.map((tpl) => {
                  const Icon = roleIcon(tpl.key);
                  return (
                    <button
                      key={tpl.key}
                      onClick={() => pickTemplate(tpl)}
                      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition-all hover:border-accent-500/40 hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-900"
                          style={{ backgroundImage: avatarGradient(tpl.accent) }}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">{tpl.name}</div>
                          <div className="text-xs text-slate-500">{tpl.role}</div>
                        </div>
                        <span className="chip !px-2 !py-0.5 text-[10px]">{tpl.difficulty}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600">{tpl.blurb}</p>
                      <div className="flex flex-wrap gap-1">
                        {tpl.suggestedTools.slice(0, 4).map((t) => {
                          const TI = toolIcon(t);
                          return (
                            <span key={t} className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-50 text-slate-400">
                              <TI className="h-3.5 w-3.5" />
                            </span>
                          );
                        })}
                        <span className="ml-auto text-[11px] text-slate-500">
                          {tpl.suggestedProvider}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 1 && template && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-900"
                    style={{ backgroundImage: avatarGradient(template.accent) }}
                  >
                    {(() => {
                      const Icon = roleIcon(template.key);
                      return <Icon className="h-6 w-6" />;
                    })()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{template.role}</div>
                    <div className="text-xs text-slate-500">{template.successCriteria}</div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name">
                    <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nova" />
                  </Field>
                  <Field label="Role title">
                    <input className="input-field" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
                  </Field>
                  <Field label="Seniority / personality">
                    <select className="input-field" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
                      {["Junior", "Mid", "Senior", "Lead", "Principal"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Provider / intelligence">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select className="input-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                        <option value="siliconflow">SiliconFlow (recommended)</option>
                        {ENABLE_DEMO_MODE && <option value="mock">Mock (scripted)</option>}
                      </select>
                      {provider !== "mock" && (
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
                      )}
                    </div>
                  </Field>
                </div>
                <Field label="Standing instructions">
                  <textarea
                    className="input-field min-h-[88px] resize-none"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </Field>
                <Field label="Default room / project">
                  <select className="input-field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    <option value="">No default room</option>
                    {groupRooms.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Pick the tools for this employee&apos;s backpack. Unconnected integrations show as not connected until wired up.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TOOL_CATALOG.filter((t) => t.category !== "Model providers").map((tool) => {
                    const TI = toolIcon(tool.id);
                    const selected = !!tools[tool.id];
                    return (
                      <div
                        key={tool.id}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border p-2.5 transition-colors",
                          selected ? "border-accent-500/40 bg-accent-500/[0.06]" : "border-slate-200 bg-slate-50",
                        )}
                      >
                        <button onClick={() => toggleTool(tool.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", selected ? "bg-accent-500/20 text-accent-700" : "bg-slate-50 text-slate-400")}>
                            <TI className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">{tool.name}</span>
                            <span className="block truncate text-[11px] text-slate-500">{tool.category}</span>
                          </span>
                        </button>
                        {selected ? (
                          <select
                            value={tools[tool.id]}
                            onChange={(e) => setTools((p) => ({ ...p, [tool.id]: e.target.value as ToolAccess["permission"] }))}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 outline-none"
                          >
                            {["read", "write", "admin"].map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        ) : (
                          <button onClick={() => toggleTool(tool.id)} className="text-xs text-slate-500 hover:text-slate-700">Add</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-1.5">
                <p className="mb-3 text-sm text-slate-500">Set what this employee can do on its own — and what needs your approval.</p>
                {PERMISSION_LABELS.map((p) => {
                  const callsDisabled = p.key === "startCalls" && !WORKFORCE_CALLS_ENABLED;
                  return (
                  <label
                    key={p.key}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5",
                      callsDisabled && "opacity-60",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm text-slate-700">
                      {p.label}
                      {p.sensitive && (
                        <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          sensitive
                        </span>
                      )}
                    </span>
                    <Toggle
                      checked={callsDisabled ? false : perms[p.key]}
                      disabled={callsDisabled}
                      onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))}
                    />
                  </label>
                  );
                })}
              </div>
            )}

            {step === 4 && template && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl text-slate-900"
                    style={{ backgroundImage: avatarGradient(template.accent) }}
                  >
                    {(() => {
                      const Icon = roleIcon(template.key);
                      return <Icon className="h-7 w-7" />;
                    })()}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{name}</div>
                    <div className="text-sm text-slate-500">{roleTitle} · {seniority} · {provider}{provider !== "mock" ? ` · ${modelMode}` : ""}</div>
                  </div>
                </div>
                <ReviewRow label="Standing instructions" value={instructions} />
                <ReviewRow label="Default room" value={groupRooms.find((r) => r.id === roomId)?.name ?? "None"} />
                <div>
                  <div className="mb-1.5 section-title">Tools ({selectedToolList.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedToolList.length === 0 && <span className="text-sm text-slate-500">No tools selected</span>}
                    {selectedToolList.map((t) => (
                      <span key={t.toolId} className="chip">{t.name} · {t.permission}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 section-title">Permissions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PERMISSION_LABELS.filter((p) => perms[p.key]).map((p) => (
                      <span key={p.key} className="chip text-emerald-700"><Check className="h-3 w-3" />{p.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (step === 0 ? close() : setStep((s) => s - 1))}
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < 4 ? (
              <Button size="sm" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={finishHire}>
                <Sparkles className="h-4 w-4" /> Hire employee
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="section-title mb-1">{label}</div>
      <p className="text-sm text-slate-600">{value}</p>
    </div>
  );
}

function HireSuccess({
  employee,
  roomId,
  rooms,
  onAddToRoom,
  onViewProfile,
  onDone,
}: {
  employee: AIEmployee;
  roomId: string;
  rooms: { id: string; name: string }[];
  onAddToRoom: (rid: string) => void;
  onViewProfile: () => void;
  onDone: () => void;
}) {
  const [selectedRoom, setSelectedRoom] = useState(roomId || rooms[0]?.id || "");
  const hasRooms = rooms.length > 0;

  return (
    <div className="px-8 py-10 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="mx-auto mb-5 flex h-20 w-20 items-center justify-center"
      >
        <div className="relative">
          <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-emerald-500/30 blur-2xl" />
          <EmployeeAvatar employee={employee} size="xl" showStatus={false} />
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-white"
          >
            <CircleCheck className="h-4 w-4 text-slate-900" />
          </motion.span>
        </div>
      </motion.div>
      <h2 className="text-xl font-semibold text-slate-900">{employee.name} is hired! 🎉</h2>
      <p className="mt-1.5 text-sm text-slate-500">
        Your new {employee.role.toLowerCase()} is ready to work. Add them to a room to get started.
      </p>

      <div className="mx-auto mt-6 max-w-sm space-y-3">
        {hasRooms ? (
          <>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="input-field"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <Button className="w-full" onClick={() => onAddToRoom(selectedRoom)} disabled={!selectedRoom}>
              Add to room & open
            </Button>
          </>
        ) : (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Create a group room first, then add {employee.name} from Workforce or the room settings.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onViewProfile}>
            View profile
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
