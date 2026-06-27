"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { DEFAULT_OPENAI_MODEL } from "@/lib/config/features";
import {
  ROLE_TEMPLATES,
  RoleTemplate,
  TOOL_CATALOG,
  defaultPermissions,
} from "@/lib/demo";
import { AIEmployee, EmployeePermissions, ToolAccess } from "@/lib/types";
import { roleIcon } from "@/lib/icons";
import { cn, uid, nowISO } from "@/lib/utils";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { Button, Toggle } from "./ui";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";

const STEPS = [
  "Welcome",
  "Hire employee",
  "Create room",
  "Tools & permissions",
  "Launch",
];

const ROOM_TEMPLATES = [
  "Engineering",
  "DevOps",
  "Product",
  "Research",
  "Design",
  "Marketing",
  "Sales",
  "Support",
  "Game Development",
  "Operations",
  "Custom",
] as const;

const PERMISSION_KEYS: (keyof EmployeePermissions)[] = [
  "readMemory",
  "writeDraftMemory",
  "createTasks",
  "requestApproval",
  "approvalBeforeExternal",
  "approvalBeforeEmails",
  "approvalBeforeCode",
];

export function OnboardingFlow() {
  const { state, actions } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<RoleTemplate | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [roomTemplate, setRoomTemplate] = useState<(typeof ROOM_TEMPLATES)[number]>("Research");
  const [customRoomName, setCustomRoomName] = useState("");
  const [tools, setTools] = useState<Record<string, ToolAccess["permission"]>>({});
  const [perms, setPerms] = useState<EmployeePermissions>(defaultPermissions());
  const [busy, setBusy] = useState(false);

  const roomName =
    roomTemplate === "Custom" ? customRoomName.trim() || "General" : roomTemplate;

  const selectedTools = useMemo(
    () =>
      Object.entries(tools).map(([id, permission]) => {
        const meta = TOOL_CATALOG.find((t) => t.id === id)!;
        return {
          toolId: id,
          name: meta.name,
          category: meta.category,
          status: meta.status === "not_connected" ? "mock" : meta.status,
          permission,
        } as ToolAccess;
      }),
    [tools],
  );

  const pickTemplate = (tpl: RoleTemplate) => {
    setTemplate(tpl);
    setEmployeeName(tpl.name);
    const initialTools: Record<string, ToolAccess["permission"]> = {};
    tpl.suggestedTools.forEach((t) => {
      initialTools[t] = "read";
    });
    setTools(initialTools);
    setStep(1);
  };

  const finish = async () => {
    if (!template || !state.user) return;
    setBusy(true);
    try {
      const roomId = uid("room");
      const employeeId = uid("emp");
      const timestamp = nowISO();

      const employee: AIEmployee = {
        id: employeeId,
        name: employeeName || template.name,
        role: template.role,
        roleKey: template.key,
        provider: "openai",
        model: DEFAULT_OPENAI_MODEL,
        seniority: "Senior",
        status: "idle",
        instructions: template.instructions,
        communicationStyle: template.communicationStyle,
        successCriteria: template.successCriteria,
        tools: selectedTools,
        permissions: perms,
        memoryCount: 0,
        tasksCompleted: 0,
        messagesSent: 0,
        approvalsRequested: 0,
        avgResponseTime: "—",
        trustScore: 75,
        accent: template.accent,
        defaultRoomId: roomId,
        lastActiveAt: timestamp,
        createdAt: timestamp,
      };

      const room = actions.createRoom({
        id: roomId,
        name: roomName,
        kind: "channel",
        description: `${roomName} workspace channel`,
        brief: template.instructions,
        humans: [state.user.id],
        aiEmployees: [employeeId],
        accent: template.accent,
        messages: [
          {
            id: uid("msg"),
            roomId,
            senderType: "system",
            senderId: "system",
            senderName: "AdeHQ",
            content: `Welcome to ${roomName}. Mention @${employee.name} to get started.`,
            createdAt: timestamp,
          },
        ],
      });

      actions.hireEmployee(employee);
      actions.addWorkLog({
        roomId: room.id,
        employeeId,
        action: "Onboarding complete",
        summary: `${employee.name} joined ${room.name}.`,
        status: "success",
      });

      actions.completeOnboarding();
      router.replace(`/rooms/${room.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-amber-400">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Set up {state.workspace.name}</h1>
          <p className="text-sm text-slate-500">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
        </div>
      </div>

      {step === 0 && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600">
            Welcome, {state.user?.name?.split(" ")[0] ?? "there"}. You&apos;ll hire your first AI
            employee, create a project room, and launch your workspace.
          </p>
          <Button onClick={() => setStep(1)}>
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600">Choose a role for your first AI employee.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLE_TEMPLATES.map((tpl) => {
              const Icon = roleIcon(tpl.key);
              return (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => pickTemplate(tpl)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors hover:border-accent-300",
                    template?.key === tpl.key
                      ? "border-accent-500 bg-accent-50"
                      : "border-slate-200 bg-white",
                  )}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-accent-600" />
                    <span className="font-medium text-slate-900">{tpl.name}</span>
                  </div>
                  <p className="text-xs text-slate-500">{tpl.blurb}</p>
                </button>
              );
            })}
          </div>
          {template && (
            <div className="flex items-end gap-3">
              <label className="block flex-1 space-y-1">
                <span className="text-xs text-slate-500">Employee name</span>
                <input
                  className="input-field"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                />
              </label>
              <Button onClick={() => setStep(2)} disabled={!employeeName.trim()}>
                Continue
              </Button>
            </div>
          )}
        </section>
      )}

      {step === 2 && template && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600">Create your first project room.</p>
          <div className="flex flex-wrap gap-2">
            {ROOM_TEMPLATES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setRoomTemplate(name)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  roomTemplate === name
                    ? "border-accent-500 bg-accent-50 text-accent-800"
                    : "border-slate-200 text-slate-700",
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {roomTemplate === "Custom" && (
            <input
              className="input-field"
              placeholder="Room name"
              value={customRoomName}
              onChange={(e) => setCustomRoomName(e.target.value)}
            />
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {step === 3 && template && (
        <section className="space-y-4">
          <p className="text-sm text-slate-600">Choose tools and permissions for {employeeName}.</p>
          <div className="flex flex-wrap gap-2">
            {template.suggestedTools.map((toolId) => {
              const meta = TOOL_CATALOG.find((t) => t.id === toolId);
              if (!meta) return null;
              const active = Boolean(tools[toolId]);
              return (
                <button
                  key={toolId}
                  type="button"
                  onClick={() =>
                    setTools((prev) => {
                      const next = { ...prev };
                      if (next[toolId]) delete next[toolId];
                      else next[toolId] = "read";
                      return next;
                    })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs",
                    active ? "border-accent-500 bg-accent-50" : "border-slate-200",
                  )}
                >
                  {meta.name}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            {PERMISSION_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <span className="text-sm text-slate-700">{key}</span>
                <Toggle
                  checked={Boolean(perms[key])}
                  onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(4)}>
              Review <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {step === 4 && template && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <EmployeeAvatar
                employee={{
                  name: employeeName,
                  roleKey: template.key,
                  status: "idle",
                  accent: template.accent,
                }}
                size="lg"
                showStatus={false}
              />
              <div>
                <div className="font-semibold text-slate-900">{employeeName}</div>
                <div className="text-sm text-slate-500">{template.role}</div>
                <div className="text-xs text-slate-500">OpenAI · {DEFAULT_OPENAI_MODEL}</div>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">
              Room: <span className="font-medium text-slate-900">{roomName}</span>
            </p>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={finish} disabled={busy}>
              <Check className="h-4 w-4" /> {busy ? "Launching…" : "Launch room"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
