"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ROLE_TEMPLATES, TOOL_CATALOG, defaultPermissions } from "@/lib/demo";
import { roleIcon, toolIcon } from "@/lib/icons";
import { Button } from "./ui";
import { avatarGradient, cn, nowISO, uid } from "@/lib/utils";
import type { AIEmployee, EmployeePermissions, EmployeeRoleKey, ToolAccess } from "@/lib/types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mail,
  PartyPopper,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const ROOM_TEMPLATES = [
  {
    id: "engineering",
    name: "Engineering",
    desc: "Build product, review architecture, and ship implementation tasks.",
    brief: "Engineering room for product implementation, architecture notes, technical decisions, and launch tasks.",
    accent: "#5b8cff",
    suggestedRole: "engineering" as EmployeeRoleKey,
    tools: ["github", "cursor", "vercel", "supabase", "files"],
  },
  {
    id: "devops",
    name: "DevOps",
    desc: "Deployments, reliability, infrastructure, and release checks.",
    brief: "DevOps room for deployments, reliability, environment setup, release checklists, and incident follow-up.",
    accent: "#22c55e",
    suggestedRole: "operations" as EmployeeRoleKey,
    tools: ["vercel", "supabase", "github", "files"],
  },
  {
    id: "product",
    name: "Product",
    desc: "Roadmaps, specs, acceptance criteria, and prioritization.",
    brief: "Product room for specs, roadmaps, user stories, prioritization, and release planning.",
    accent: "#ea580c",
    suggestedRole: "pm" as EmployeeRoleKey,
    tools: ["notion", "linear", "files", "web-search"],
  },
  {
    id: "research",
    name: "Research",
    desc: "Market research, competitor tracking, and source-backed memos.",
    brief: "Research room for market scans, competitor analysis, customer discovery, and decision-ready summaries.",
    accent: "#22d3ee",
    suggestedRole: "research" as EmployeeRoleKey,
    tools: ["web-search", "perplexity", "browser", "files"],
  },
  {
    id: "design",
    name: "Design",
    desc: "Flows, UX critique, design systems, and product polish.",
    brief: "Design room for user flows, UX critique, design system decisions, and interface polish.",
    accent: "#f472b6",
    suggestedRole: "design" as EmployeeRoleKey,
    tools: ["figma", "browser", "files"],
  },
  {
    id: "marketing",
    name: "Marketing",
    desc: "Launch plans, positioning, landing copy, and distribution.",
    brief: "Marketing room for positioning, launches, landing copy, campaigns, and distribution planning.",
    accent: "#34d399",
    suggestedRole: "marketing" as EmployeeRoleKey,
    tools: ["web-search", "notion", "browser", "files"],
  },
  {
    id: "support",
    name: "Customer Support",
    desc: "User questions, triage, help docs, and issue escalation.",
    brief: "Support room for customer questions, issue triage, support docs, and recurring pain points.",
    accent: "#2dd4bf",
    suggestedRole: "support" as EmployeeRoleKey,
    tools: ["slack", "notion", "files"],
  },
  {
    id: "custom",
    name: "New Project",
    desc: "Start with a named project room for your first initiative.",
    brief: "Project room for a focused initiative with AI employees, tasks, memory, approvals, and work logs.",
    accent: "#f97316",
    suggestedRole: "research" as EmployeeRoleKey,
    tools: ["web-search", "browser", "files"],
  },
];

const STEPS = [
  { title: "Where should your AI workforce work?", sub: "Create a workspace, accept an invite, or continue with demo." },
  { title: "Hire your first AI employee", sub: "Pick the role that should start working first." },
  { title: "Where should this employee work first?", sub: "Use a department room or name a project room." },
  { title: "What tools should this employee have?", sub: "Start with conservative access. You can expand it later." },
  { title: "What is this AI employee allowed to do?", sub: "Set permissions and approval rules before launch." },
  { title: "Review and launch", sub: "Create the room, hire the employee, and enter your workspace." },
];

export function OnboardingFlow() {
  const { state, actions } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<EmployeeRoleKey>("research");
  const [room, setRoom] = useState<string>("research");
  const [workspaceName, setWorkspaceName] = useState(state.workspace.name || "My AI Workspace");
  const [customRoomName, setCustomRoomName] = useState("Launch Room");
  const [tools, setTools] = useState<string[]>(["web-search", "browser", "perplexity", "files"]);
  const [permissions, setPermissions] = useState<EmployeePermissions>(() => defaultPermissions());
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => ROLE_TEMPLATES.find((r) => r.key === role)!, [role]);
  const roomTemplate = useMemo(() => ROOM_TEMPLATES.find((r) => r.id === room)!, [room]);
  const pendingInvites = state.workspaceInvitations.filter(
    (invite) =>
      invite.status === "pending" &&
      invite.invitedEmail.toLowerCase() === (state.user?.email ?? "").toLowerCase(),
  );

  const pickRole = (key: EmployeeRoleKey) => {
    setRole(key);
    const tpl = ROLE_TEMPLATES.find((r) => r.key === key)!;
    setTools(tpl.suggestedTools);
  };

  const pickRoom = (id: string) => {
    const next = ROOM_TEMPLATES.find((r) => r.id === id)!;
    setRoom(id);
    if (role === roomTemplate.suggestedRole && next.suggestedRole !== role) {
      pickRole(next.suggestedRole);
    }
    setTools((current) => Array.from(new Set([...next.tools, ...current])).slice(0, 6));
  };

  const toggleTool = (id: string) =>
    setTools((p) => (p.includes(id) ? p.filter((t) => t !== id) : [...p, id]));

  const selectedToolList = useMemo<ToolAccess[]>(
    () =>
      tools.map((id) => {
        const meta = TOOL_CATALOG.find((t) => t.id === id)!;
        return {
          toolId: id,
          name: meta.name,
          category: meta.category,
          status: meta.status === "not_connected" ? "mock" : meta.status,
          permission: id === "github" || id === "supabase" ? "read" : "write",
        };
      }),
    [tools],
  );

  const acceptInvite = async (id: string) => {
    setError(null);
    setBusyInviteId(id);
    try {
      await actions.acceptWorkspaceInvitation(id);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const declineInvite = async (id: string) => {
    setError(null);
    setBusyInviteId(id);
    try {
      await actions.declineWorkspaceInvitation(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to decline invitation.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const finish = async () => {
    setError(null);
    setFinishing(true);
    try {
      const roomName = room === "custom" ? customRoomName.trim() || "Launch Room" : roomTemplate.name;
      if (workspaceName.trim() && workspaceName.trim() !== state.workspace.name) {
        actions.updateProfile({ workspaceName: workspaceName.trim() });
      }

      const createdRoom = actions.createRoom({
        name: roomName,
        description: roomTemplate.desc,
        brief: roomTemplate.brief,
        accent: roomTemplate.accent,
      });

      const timestamp = nowISO();
      const employee: AIEmployee = {
        id: uid("emp"),
        name: template.name,
        role: template.role,
        roleKey: template.key,
        provider: template.suggestedProvider,
        model: template.suggestedModel,
        seniority: template.difficulty === "Advanced" ? "Senior" : "Mid",
        status: "idle",
        instructions: template.instructions,
        communicationStyle: template.communicationStyle,
        successCriteria: template.successCriteria,
        tools: selectedToolList,
        permissions,
        memoryCount: 0,
        tasksCompleted: 0,
        messagesSent: 0,
        approvalsRequested: 0,
        avgResponseTime: "-",
        trustScore: 75,
        accent: template.accent,
        defaultRoomId: createdRoom.id,
        lastActiveAt: timestamp,
        createdAt: timestamp,
      };
      actions.hireEmployee(employee);
      actions.addMessage(createdRoom.id, {
        senderType: "system",
        senderId: "system",
        senderName: "AdeHQ",
        content: `${employee.name} joined the room. Mention them with @${employee.name} to start.`,
      });
      actions.addWorkLog({
        roomId: createdRoom.id,
        employeeId: employee.id,
        action: "Onboarded AI employee",
        summary: `${employee.name} joined ${createdRoom.name} with ${selectedToolList.length} tools.`,
        status: "success",
      });
      actions.completeOnboarding();
      router.replace(`/rooms/${createdRoom.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to finish onboarding.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-6">
      <div className="absolute inset-0 -z-10 bg-mesh opacity-60" />
      <div className="absolute left-1/2 top-0 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-accent-500/20 blur-[120px]" />

      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-slate-900">AdeHQ</span>
      </div>

      <div className="mb-7 flex w-full max-w-xl items-center gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              i <= step ? "bg-accent-500" : "bg-slate-100",
            )}
          />
        ))}
      </div>

      <div className="w-full max-w-4xl text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {STEPS[step].title}
            </h1>
            <p className="mt-2 text-[15px] text-slate-600">{STEPS[step].sub}</p>

            <div className="mt-8">
              {step === 0 && (
                <div className="mx-auto grid max-w-3xl gap-3 text-left md:grid-cols-2">
                  <div className="rounded-2xl border border-accent-500/40 bg-accent-500/[0.06] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-700">
                        <Plus className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Create a fresh workspace</div>
                        <div className="text-xs text-slate-500">No demo rooms or seeded employees.</div>
                      </div>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-slate-500">Workspace name</span>
                      <input
                        className="input-field"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Pending invitations</div>
                        <div className="text-xs text-slate-500">Join a workspace someone invited you to.</div>
                      </div>
                    </div>
                    {pendingInvites.length === 0 ? (
                      <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                        No pending invites for {state.user?.email}.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {pendingInvites.map((invite) => (
                          <div key={invite.id} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="text-sm font-medium text-slate-900">
                              {invite.workspaceName ?? "Workspace invitation"}
                            </div>
                            <div className="text-xs text-slate-500">
                              Role: {invite.role} {invite.invitedByName ? `- invited by ${invite.invitedByName}` : ""}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => acceptInvite(invite.id)}
                                disabled={busyInviteId === invite.id}
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => declineInvite(invite.id)}
                                disabled={busyInviteId === invite.id}
                              >
                                Decline
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    className="mt-4 w-full md:col-span-2"
                    onClick={() => {
                      actions.loginDemo();
                      router.replace("/");
                    }}
                  >
                    Continue with demo workspace
                  </Button>
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ROLE_TEMPLATES.map((tpl) => {
                    const Icon = roleIcon(tpl.key);
                    const active = role === tpl.key;
                    return (
                      <button
                        key={tpl.key}
                        onClick={() => pickRole(tpl.key)}
                        className={cn(
                          "group relative flex flex-col items-start gap-2.5 rounded-2xl border p-4 text-left transition-all",
                          active
                            ? "border-accent-500/50 bg-accent-500/[0.07] ring-1 ring-accent-500/30"
                            : "border-slate-200 bg-slate-50 hover:bg-white",
                        )}
                      >
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-900"
                          style={{ backgroundImage: avatarGradient(tpl.accent) }}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{tpl.name}</div>
                          <div className="mt-0.5 text-xs leading-snug text-slate-500">{tpl.blurb}</div>
                        </div>
                        <div className="mt-1 flex w-full items-center justify-between">
                          <span className="text-[11px] text-slate-500">{tpl.suggestedProvider}</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">{tpl.difficulty}</span>
                        </div>
                        {active && (
                          <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {ROOM_TEMPLATES.map((opt) => {
                    const active = room === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => pickRoom(opt.id)}
                        className={cn(
                          "relative rounded-2xl border p-4 text-left transition-all",
                          active
                            ? "border-accent-500/50 bg-accent-500/[0.07] ring-1 ring-accent-500/30"
                            : "border-slate-200 bg-slate-50 hover:bg-white",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: opt.accent }} />
                          <div className="text-sm font-semibold text-slate-900">{opt.name}</div>
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-500">{opt.desc}</div>
                        {active && (
                          <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {room === "custom" && (
                    <label className="block space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 text-left sm:col-span-2 lg:col-span-4">
                      <span className="text-xs font-medium text-slate-500">Project room name</span>
                      <input
                        className="input-field"
                        value={customRoomName}
                        onChange={(e) => setCustomRoomName(e.target.value)}
                      />
                    </label>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {TOOL_CATALOG.filter((t) => t.category !== "Model providers").slice(0, 20).map((tool) => {
                    const TI = toolIcon(tool.id);
                    const active = tools.includes(tool.id);
                    return (
                      <button
                        key={tool.id}
                        onClick={() => toggleTool(tool.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                          active
                            ? "border-accent-500/40 bg-accent-500/[0.07]"
                            : "border-slate-200 bg-slate-50 hover:bg-white",
                        )}
                      >
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", active ? "bg-accent-500/20 text-accent-700" : "bg-slate-50 text-slate-400")}>
                          <TI className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{tool.name}</span>
                        {active && <Check className="h-3.5 w-3.5 text-accent-600" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {step === 4 && (
                <div className="mx-auto grid max-w-2xl gap-2 text-left">
                  {(
                    [
                      ["readMemory", "Read project room context"],
                      ["writeDraftMemory", "Write draft memory"],
                      ["createTasks", "Create tasks"],
                      ["messageEmployees", "Message other AI employees"],
                      ["requestApproval", "Ask for human approval"],
                      ["approvalBeforeExternal", "Needs approval before external actions"],
                      ["approvalBeforeCode", "Needs approval before code changes"],
                      ["approvalBeforeEmails", "Needs approval before sending emails"],
                      ["approvalBeforeBilling", "Needs approval before billing/payment actions"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <input
                        type="checkbox"
                        checked={permissions[key]}
                        onChange={(e) =>
                          setPermissions((p) => ({ ...p, [key]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
              )}

              {step === 5 && (
                <div className="mx-auto flex max-w-2xl flex-col items-center">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 220, damping: 16 }}
                    className="relative mb-5"
                  >
                    <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-accent-500/30 blur-2xl" />
                    <div
                      className="flex h-20 w-20 items-center justify-center rounded-3xl text-slate-900 shadow-glow"
                      style={{ backgroundImage: avatarGradient(template.accent) }}
                    >
                      <PartyPopper className="h-9 w-9" />
                    </div>
                  </motion.div>
                  <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 text-left">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Summary label="Workspace" value={workspaceName || state.workspace.name} />
                      <Summary label="Room" value={room === "custom" ? customRoomName : roomTemplate.name} />
                      <Summary label="AI employee" value={`${template.name} - ${template.role}`} />
                      <Summary label="Tools" value={`${tools.length} selected`} />
                    </div>
                    <div className="mt-4 rounded-xl bg-white px-3 py-3 text-sm text-slate-600">
                      This will create a real room, hire the employee into it, and leave your workspace otherwise empty.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {error && (
          <p className="mx-auto mt-5 max-w-xl rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-9 flex items-center justify-center gap-3">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < 5 ? (
            <Button size="lg" onClick={() => setStep((s) => s + 1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="lg" onClick={finish} disabled={finishing}>
              <Sparkles className="h-4 w-4" /> {finishing ? "Launching..." : "Launch workspace"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
        <Users className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
