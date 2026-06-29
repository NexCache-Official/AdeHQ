"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/demo-store";
import { defaultModelModeForRole } from "@/lib/ai/model-catalog";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import {
  ROLE_TEMPLATES,
  RoleTemplate,
  TOOL_CATALOG,
  defaultPermissions,
} from "@/lib/demo";
import { AIEmployee, EmployeePermissions, ProjectRoom, ToolAccess, WorkLogEvent } from "@/lib/types";
import { roleIcon, toolIcon } from "@/lib/icons";
import { cn, uid, nowISO, avatarGradient } from "@/lib/utils";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { Button, Progress, Toggle } from "./ui";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Hash,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";

const STEPS = [
  {
    title: "Welcome to your workspace",
    sub: "You're minutes away from your first AI teammate and project room.",
  },
  {
    title: "Hire your first AI employee",
    sub: "Pick the role that should start working first.",
  },
  {
    title: "Create your first room",
    sub: "Choose where humans and AI employees will collaborate.",
  },
  {
    title: "Tools & permissions",
    sub: "Give your employee the right backpack and guardrails.",
  },
  {
    title: "Review and launch",
    sub: "We'll create everything and open your room.",
  },
];

const ROOM_TEMPLATES = [
  { name: "Engineering", accent: "#6366f1" },
  { name: "DevOps", accent: "#0ea5e9" },
  { name: "Product", accent: "#8b5cf6" },
  { name: "Research", accent: "#14b8a6" },
  { name: "Design", accent: "#ec4899" },
  { name: "Marketing", accent: "#f97316" },
  { name: "Sales", accent: "#22c55e" },
  { name: "Support", accent: "#64748b" },
  { name: "Game Development", accent: "#a855f7" },
  { name: "Operations", accent: "#eab308" },
  { name: "Custom", accent: "#f97316" },
] as const;

const PERMISSION_LABELS: { key: keyof EmployeePermissions; label: string; sensitive?: boolean }[] = [
  { key: "readMemory", label: "Can read project memory" },
  { key: "writeDraftMemory", label: "Can write draft memory" },
  { key: "createTasks", label: "Can create tasks" },
  { key: "messageEmployees", label: "Can message other AI employees" },
  { key: "requestApproval", label: "Can request human approval" },
  { key: "approvalBeforeExternal", label: "Needs approval before external actions", sensitive: true },
  { key: "approvalBeforeEmails", label: "Needs approval before sending emails", sensitive: true },
  { key: "approvalBeforeCode", label: "Needs approval before changing code", sensitive: true },
];

export function OnboardingFlow() {
  const { state, actions } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<RoleTemplate | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [roomTemplate, setRoomTemplate] = useState<(typeof ROOM_TEMPLATES)[number]["name"]>("Research");
  const [customRoomName, setCustomRoomName] = useState("");
  const [tools, setTools] = useState<Record<string, ToolAccess["permission"]>>({});
  const [perms, setPerms] = useState<EmployeePermissions>(defaultPermissions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomMeta = ROOM_TEMPLATES.find((r) => r.name === roomTemplate) ?? ROOM_TEMPLATES[3];
  const roomName =
    roomTemplate === "Custom" ? customRoomName.trim() || "General" : roomTemplate;

  const progress = ((step + 1) / STEPS.length) * 100;

  const selectedTools = useMemo(
    () =>
      Object.entries(tools).map(([id, permission]) => {
        const meta = TOOL_CATALOG.find((t) => t.id === id)!;
        return {
          toolId: id,
          name: meta.name,
          category: meta.category,
          status: meta.status === "not_connected" ? ("not_connected" as const) : meta.status,
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
  };

  const finish = async () => {
    if (!template || !state.user) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = uid("room");
      const employeeId = uid("emp");
      const timestamp = nowISO();

      const employee: AIEmployee = {
        id: employeeId,
        name: employeeName || template.name,
        role: template.role,
        roleKey: template.key,
        provider: "siliconflow",
        model: DEFAULT_SILICONFLOW_MODEL,
        modelMode: defaultModelModeForRole(template.key),
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

      const room: ProjectRoom = {
        id: roomId,
        name: roomName,
        kind: "channel",
        description: `${roomName} workspace channel`,
        brief: template.instructions,
        humans: [state.user.id],
        aiEmployees: [employeeId],
        accent: roomMeta.accent,
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
        tasks: [],
        memory: [],
        unread: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const workLog: WorkLogEvent = {
        id: uid("wl"),
        roomId,
        employeeId,
        action: "Onboarding complete",
        summary: `${employee.name} joined ${room.name}.`,
        status: "success",
        createdAt: timestamp,
      };

      const { roomId: savedRoomId } = await actions.finishOnboarding({
        workspaceName: state.workspace.name,
        employee,
        room,
        workLog,
      });
      router.replace(`/rooms/${savedRoomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish onboarding.");
    } finally {
      setBusy(false);
    }
  };

  const canContinue =
    step === 0
      ? true
      : step === 1
        ? !!template && !!employeeName.trim()
        : step === 2
          ? roomTemplate !== "Custom" || !!customRoomName.trim()
          : true;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="absolute inset-0 bg-dots opacity-[0.35]" />
      <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-accent-100 blur-[100px]" />
      <div className="absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-amber-100 blur-[90px]" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500">AdeHQ onboarding</div>
              <div className="text-lg font-semibold text-slate-900">{state.workspace.name}</div>
            </div>
          </div>
          <div className="hidden text-right text-sm text-slate-500 sm:block">
            Step {step + 1} of {STEPS.length}
          </div>
        </motion.div>

        <div className="mb-6">
          <Progress value={progress} />
        </div>

        <div className="grid flex-1 gap-8 lg:grid-cols-[320px_1fr]">
          {/* Side nav */}
          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-2">
              {STEPS.map((s, i) => {
                const active = i === step;
                const done = i < step;
                return (
                  <motion.button
                    key={s.title}
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    whileHover={i <= step ? { x: 2 } : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-accent-300 bg-white shadow-sm"
                        : done
                          ? "border-slate-200 bg-white/80 hover:border-accent-200"
                          : "border-transparent bg-transparent opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        done
                          ? "bg-emerald-500 text-white"
                          : active
                            ? "bg-accent-500 text-white"
                            : "bg-slate-200 text-slate-600",
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{s.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{s.sub}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </aside>

          {/* Main panel */}
          <motion.div
            layout
            className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel"
          >
            <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {STEPS[step].title}
              </h1>
              <p className="mt-1 text-sm text-slate-500">{STEPS[step].sub}</p>
            </div>

            <div className="max-h-[min(62vh,560px)] overflow-y-auto px-6 py-6 sm:px-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {step === 0 && (
                    <div className="grid gap-6 sm:grid-cols-2">
                      <FeatureCard
                        icon={Bot}
                        title="Hire an AI employee"
                        description="Research, engineering, product, and more — each with tools and permissions."
                      />
                      <FeatureCard
                        icon={Hash}
                        title="Launch a project room"
                        description="Your team and AI employees collaborate in channels with memory and tasks."
                      />
                      <FeatureCard
                        icon={Wrench}
                        title="Connect tools safely"
                        description="Start with conservative access. Expand permissions as trust grows."
                      />
                      <FeatureCard
                        icon={Rocket}
                        title="Powered by SiliconFlow"
                        description={`Live replies via SiliconFlow (${DEFAULT_SILICONFLOW_MODEL}) when your server key is configured.`}
                      />
                      <p className="sm:col-span-2 rounded-2xl bg-accent-50 px-4 py-3 text-sm text-accent-900">
                        Welcome, {state.user?.name?.split(" ")[0] ?? "there"}. This takes about two
                        minutes — then you can message your AI employee in a real room.
                      </p>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="space-y-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {ROLE_TEMPLATES.map((tpl) => {
                          const Icon = roleIcon(tpl.key);
                          const selected = template?.key === tpl.key;
                          return (
                            <motion.button
                              key={tpl.key}
                              type="button"
                              whileHover={{ y: -2 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => pickTemplate(tpl)}
                              className={cn(
                                "group flex flex-col gap-3 rounded-2xl border p-4 text-left transition-all",
                                selected
                                  ? "border-accent-500 bg-accent-50/80 shadow-sm ring-1 ring-accent-500/20"
                                  : "border-slate-200 bg-slate-50/50 hover:border-accent-300 hover:bg-white",
                              )}
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
                            </motion.button>
                          );
                        })}
                      </div>
                      {template && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-slate-500">Employee name</span>
                            <input
                              className="input-field"
                              value={employeeName}
                              onChange={(e) => setEmployeeName(e.target.value)}
                              placeholder={template.name}
                            />
                          </label>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-5">
                      <div className="flex flex-wrap gap-2">
                        {ROOM_TEMPLATES.map((room) => {
                          const selected = roomTemplate === room.name;
                          return (
                            <motion.button
                              key={room.name}
                              type="button"
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => setRoomTemplate(room.name)}
                              className={cn(
                                "rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
                                selected
                                  ? "border-accent-500 bg-accent-50 text-accent-800 shadow-sm"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-accent-300",
                              )}
                              style={selected ? { boxShadow: `0 0 0 1px ${room.accent}33` } : undefined}
                            >
                              {room.name}
                            </motion.button>
                          );
                        })}
                      </div>
                      {roomTemplate === "Custom" && (
                        <input
                          className="input-field"
                          placeholder="Room name"
                          value={customRoomName}
                          onChange={(e) => setCustomRoomName(e.target.value)}
                        />
                      )}
                      <div
                        className="rounded-2xl border border-dashed border-slate-200 p-5"
                        style={{ background: `${roomMeta.accent}08` }}
                      >
                        <div className="text-sm font-medium text-slate-900">Preview: {roomName}</div>
                        <p className="mt-1 text-xs text-slate-500">
                          Your first channel for {state.workspace.name}. Humans and AI employees message here.
                        </p>
                      </div>
                    </div>
                  )}

                  {step === 3 && template && (
                    <div className="space-y-5">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Tool backpack
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {template.suggestedTools.map((toolId) => {
                            const meta = TOOL_CATALOG.find((t) => t.id === toolId);
                            if (!meta) return null;
                            const TI = toolIcon(toolId);
                            const selected = Boolean(tools[toolId]);
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
                                  "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                                  selected
                                    ? "border-accent-500/40 bg-accent-500/[0.06]"
                                    : "border-slate-200 bg-slate-50 hover:border-slate-300",
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex h-9 w-9 items-center justify-center rounded-lg",
                                    selected ? "bg-accent-500/20 text-accent-700" : "bg-white text-slate-400",
                                  )}
                                >
                                  <TI className="h-4 w-4" />
                                </span>
                                <span>
                                  <span className="block text-sm font-medium text-slate-800">{meta.name}</span>
                                  <span className="block text-[11px] text-slate-500">{meta.category}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Permissions
                        </div>
                        <div className="space-y-1.5">
                          {PERMISSION_LABELS.map((p) => (
                            <label
                              key={p.key}
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5"
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
                                checked={Boolean(perms[p.key])}
                                onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 4 && template && (
                    <div className="space-y-5">
                      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5">
                        <EmployeeAvatar
                          employee={{
                            name: employeeName,
                            roleKey: template.key,
                            status: "idle",
                            accent: template.accent,
                          }}
                          size="lg"
                        />
                        <div>
                          <div className="text-lg font-semibold text-slate-900">{employeeName}</div>
                          <div className="text-sm text-slate-500">{template.role}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className="chip text-accent-700">SiliconFlow · {DEFAULT_SILICONFLOW_MODEL}</span>
                            <span className="chip">{roomName}</span>
                            <span className="chip">{selectedTools.length} tools</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ReviewBlock label="Instructions" value={template.instructions} />
                        <ReviewBlock label="Success criteria" value={template.successCriteria} />
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {error && (
              <p className="mx-6 mb-0 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 sm:mx-8">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 sm:px-8">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (step === 0 ? router.push("/") : setStep((s) => s - 1))}
              >
                <ArrowLeft className="h-4 w-4" />
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  size="sm"
                  disabled={!canContinue}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" disabled={busy || !template} onClick={finish}>
                  <Rocket className="h-4 w-4" />
                  {busy ? "Launching…" : "Launch room"}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
        <Icon className="h-5 w-5" />
      </span>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

function ReviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="section-title mb-1">{label}</div>
      <p className="line-clamp-4 text-sm leading-relaxed text-slate-600">{value}</p>
    </div>
  );
}
