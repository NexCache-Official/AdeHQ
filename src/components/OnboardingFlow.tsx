"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/demo-store";
import { ONBOARDING_ROOM_KEY } from "@/lib/hiring/data";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import { cn } from "@/lib/utils";
import { Button, Progress } from "./ui";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Hash,
  Rocket,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

const STEPS = [
  {
    title: "Welcome to your workspace",
    sub: "You're minutes away from your first AI teammate and project room.",
  },
  {
    title: "Create your first room",
    sub: "Choose where humans and AI employees will collaborate.",
  },
  {
    title: "Meet Maya",
    sub: "Hire your first AI employee with Maya, your AI recruiting manager.",
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

export function OnboardingFlow() {
  const { state } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [roomTemplate, setRoomTemplate] = useState<(typeof ROOM_TEMPLATES)[number]["name"]>("Research");
  const [customRoomName, setCustomRoomName] = useState("");

  const roomMeta = ROOM_TEMPLATES.find((r) => r.name === roomTemplate) ?? ROOM_TEMPLATES[3];
  const roomName =
    roomTemplate === "Custom" ? customRoomName.trim() || "General" : roomTemplate;

  const progress = ((step + 1) / STEPS.length) * 100;

  const goToHire = () => {
    sessionStorage.setItem(
      ONBOARDING_ROOM_KEY,
      JSON.stringify({
        name: roomName,
        accent: roomMeta.accent,
        template: roomTemplate,
      }),
    );
    router.push("/hire?onboarding=1");
  };

  const canContinue =
    step === 0
      ? true
      : step === 1
        ? roomTemplate !== "Custom" || !!customRoomName.trim()
        : true;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="absolute inset-0 bg-dots opacity-[0.35]" />
      <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-accent-100 blur-[100px]" />
      <div className="absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-amber-100 blur-[90px]" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-8">
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
                        icon={UserRound}
                        title="AI Recruiting Manager"
                        description="A free AI recruiter helps you define the role, write the job brief, and shortlist candidates."
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
                        description={`Live recruiting via SiliconFlow (${DEFAULT_SILICONFLOW_MODEL}) when configured.`}
                      />
                      <p className="sm:col-span-2 rounded-2xl bg-accent-50 px-4 py-3 text-sm text-accent-900">
                        Welcome, {state.user?.name?.split(" ")[0] ?? "there"}. Pick a room, then
                        Maya will guide you through hiring your first AI employee.
                      </p>
                    </div>
                  )}

                  {step === 1 && (
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
                          Your first channel for {state.workspace.name}. Your hired AI employee will
                          join here.
                        </p>
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-5">
                      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
                        <div className="mb-4 flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500" />
                          <div>
                            <div className="text-lg font-semibold text-slate-900">Maya</div>
                            <div className="text-sm text-slate-500">Your AI recruiting manager · free during hiring</div>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-600">
                          Describe who you need to hire — or pick a department. Maya will ask the
                          right questions about role, industry, tone, and priorities, then draft a
                          job brief and shortlist three AI employee candidates for you.
                        </p>
                        <ul className="mt-4 space-y-2 text-sm text-slate-600">
                          <li className="flex gap-2">
                            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                            Chat with suggestion chips for fast answers
                          </li>
                          <li className="flex gap-2">
                            <Hash className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                            First room ready: <strong className="font-medium">{roomName}</strong>
                          </li>
                        </ul>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 sm:px-8">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (step === 0 ? router.push("/login") : setStep((s) => s - 1))}
              >
                <ArrowLeft className="h-4 w-4" />
                {step === 0 ? "Back" : "Previous"}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button size="sm" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" onClick={goToHire}>
                  <Rocket className="h-4 w-4" />
                  Continue with Maya →
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
