"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/demo-store";
import {
  ONBOARDING_CONTEXT_KEY,
  ONBOARDING_ROOM_KEY,
  storeOnboardingContext,
} from "@/lib/hiring/data";
import { mayaOnboardingWelcomeMessage } from "@/lib/hiring/maya";
import type { OnboardingContext } from "@/lib/hiring/types";
import {
  defaultWorkstreamForOutcome,
  workstreamPresetsForOutcome,
  WORKFORCE_OUTCOMES,
  type WorkforceOutcomeId,
} from "@/lib/hiring/onboarding-presets";
import { cn } from "@/lib/utils";
import { Button, Progress } from "./ui";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Loader2,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";

const STEPS = [
  {
    title: "Set up your AI workforce",
    sub: "Tell AdeHQ what kind of work you want your AI team to help with. Maya will use this to recommend your first room and first hire.",
  },
  {
    title: "Create your first workstream",
    sub: "Rooms are where your humans and AI employees collaborate. Start with one focused work area — you can add more later.",
  },
  {
    title: "Meet Maya",
    sub: "Maya is your AI Workforce Manager. She helps you hire, organize, improve, and govern your AI employees.",
  },
];

export function OnboardingFlow() {
  const { state, actions } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [outcomeId, setOutcomeId] = useState<WorkforceOutcomeId>("research_market");
  const [goalText, setGoalText] = useState("");
  const [domainText, setDomainText] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [customRoomName, setCustomRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(() => workstreamPresetsForOutcome(outcomeId), [outcomeId]);
  const activePreset = useMemo(() => {
    const picked = presets.find((p) => p.id === presetId);
    return picked ?? presets[0] ?? defaultWorkstreamForOutcome(outcomeId);
  }, [presets, presetId, outcomeId]);

  const roomName = customRoomName.trim() || activePreset.name;
  const outcomeTitle = WORKFORCE_OUTCOMES.find((o) => o.id === outcomeId)?.title ?? "Your work";

  const progress = ((step + 1) / STEPS.length) * 100;

  const buildContext = (roomId?: string): OnboardingContext => ({
    goalText: goalText.trim() || undefined,
    outcomeId,
    outcomeTitle,
    domainText: domainText.trim() || undefined,
    roomName,
    roomId,
    suggestedTopics: activePreset.topics,
    suggestedHires: activePreset.suggestedHires,
    setupComplete: Boolean(roomId),
  });

  const persistDrafts = (roomId?: string) => {
    const context = buildContext(roomId);
    storeOnboardingContext(context);
    sessionStorage.setItem(
      ONBOARDING_ROOM_KEY,
      JSON.stringify({
        name: roomName,
        accent: activePreset.accent,
        template: activePreset.id,
        roomId,
      }),
    );
    sessionStorage.setItem(ONBOARDING_CONTEXT_KEY, JSON.stringify(context));
  };

  const finishSetup = async (openMaya: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.setupOnboardingWorkspace({
        workspaceName: state.workspace.name,
        room: {
          name: roomName,
          accent: activePreset.accent,
          description: `${roomName} — your first AI workstream`,
        },
      });
      persistDrafts(result.firstRoomId);

      if (!openMaya) {
        actions.completeOnboarding();
        router.push("/rooms");
        return;
      }

      const firstName = state.user?.name?.split(" ")[0] ?? "there";
      const welcome = mayaOnboardingWelcomeMessage(
        firstName,
        state.workspace.name,
        roomName,
        activePreset.suggestedHires[0],
      );
      sessionStorage.setItem("adehq:maya-onboarding-welcome", welcome);
      router.push(`/rooms/${result.mayaDmRoomId}?onboarding=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  };

  const canContinue =
    step === 0
      ? true
      : step === 1
        ? Boolean(roomName.trim())
        : true;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F6F3EE]">
      <div className="absolute inset-0 bg-dots opacity-[0.22]" />
      <div className="absolute -left-24 top-16 h-64 w-64 rounded-full bg-[#FBE9DE] blur-[90px]" />
      <div className="absolute -right-10 bottom-8 h-56 w-56 rounded-full bg-amber-100/80 blur-[80px]" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E85D2C] to-[#f59e0b] shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-3">AdeHQ setup</div>
              <div className="text-base font-semibold text-ink">{state.workspace.name}</div>
            </div>
          </div>
          <div className="text-xs text-ink-3">
            Step {step + 1} of {STEPS.length}
          </div>
        </div>

        <Progress value={progress} />

        <div className="grid flex-1 gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface/90 p-4 shadow-sm">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Your setup</div>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-ink-3">Workspace</dt>
                  <dd className="font-medium text-ink">{state.workspace.name}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Outcome</dt>
                  <dd className="font-medium text-ink">{outcomeTitle}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">First workstream</dt>
                  <dd className="font-medium text-ink">{roomName}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Maya</dt>
                  <dd className="font-medium text-ink">AI Workforce Manager</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Suggested first hire</dt>
                  <dd className="font-medium text-ink">{activePreset.suggestedHires[0] ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="hidden space-y-1.5 lg:block">
              {STEPS.map((s, i) => {
                const active = i === step;
                const done = i < step;
                return (
                  <div
                    key={s.title}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left",
                      active ? "border-accent/40 bg-surface shadow-sm" : "border-transparent bg-transparent",
                      !active && !done && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        done ? "bg-emerald-500 text-white" : active ? "bg-accent text-white" : "bg-muted text-ink-3",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="text-xs leading-snug">
                      <span className="block font-medium text-ink">{s.title}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-panel">
            <div className="border-b border-border/70 px-5 py-4 sm:px-6">
              <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{STEPS[step].title}</h1>
              <p className="mt-1 text-sm text-ink-2">{STEPS[step].sub}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  {step === 0 && (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {WORKFORCE_OUTCOMES.map((outcome) => {
                          const selected = outcomeId === outcome.id;
                          return (
                            <button
                              key={outcome.id}
                              type="button"
                              onClick={() => {
                                setOutcomeId(outcome.id);
                                setPresetId("");
                              }}
                              className={cn(
                                "rounded-xl border px-4 py-3 text-left transition",
                                selected
                                  ? "border-accent bg-accent-soft/60 shadow-sm"
                                  : "border-border bg-muted/30 hover:border-accent/30",
                              )}
                            >
                              <div className="text-sm font-semibold text-ink">{outcome.title}</div>
                              <p className="mt-1 text-xs leading-relaxed text-ink-2">{outcome.description}</p>
                            </button>
                          );
                        })}
                      </div>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-ink-2">
                          What are you trying to move forward?
                        </span>
                        <textarea
                          className="input-field min-h-[88px] resize-none"
                          placeholder="e.g. Launch our B2B SaaS product and hire my first AI teammates"
                          value={goalText}
                          onChange={(e) => setGoalText(e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-ink-2">
                          Business or domain context (optional)
                        </span>
                        <input
                          className="input-field"
                          placeholder="e.g. NexCache Limited — developer tools for caching"
                          value={domainText}
                          onChange={(e) => setDomainText(e.target.value)}
                        />
                      </label>
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {presets.map((preset) => {
                          const selected = (presetId || presets[0]?.id) === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setPresetId(preset.id);
                                setCustomRoomName("");
                              }}
                              className={cn(
                                "rounded-xl border px-3 py-2 text-sm font-medium transition",
                                selected
                                  ? "border-accent bg-accent-soft/50 text-ink"
                                  : "border-border text-ink-2 hover:border-accent/30",
                              )}
                            >
                              {preset.name}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        className="input-field"
                        placeholder="Custom workstream name (optional)"
                        value={customRoomName}
                        onChange={(e) => setCustomRoomName(e.target.value)}
                      />
                      <div
                        className="rounded-xl border border-dashed border-border p-4"
                        style={{ background: `${activePreset.accent}10` }}
                      >
                        <div className="text-sm font-semibold text-ink">Room: {roomName}</div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                              Starting topics
                            </div>
                            <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                              {activePreset.topics.map((t) => (
                                <li key={t}>• {t}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                              Suggested first hires
                            </div>
                            <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                              {activePreset.suggestedHires.map((h) => (
                                <li key={h}>• {h}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border bg-gradient-to-br from-surface to-muted/40 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500" />
                          <div>
                            <div className="text-lg font-semibold text-ink">Maya</div>
                            <div className="text-sm text-ink-2">AI Workforce Manager</div>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-ink-2">
                          Maya helps you decide what role you need, hire your first AI employee, improve
                          existing employees, suggest rooms and topics, and keep your AI workforce organized.
                        </p>
                        <ul className="mt-4 grid gap-2 text-sm text-ink-2 sm:grid-cols-2">
                          {[
                            "Decide what role you need",
                            "Hire your first AI employee",
                            "Improve existing employees",
                            "Suggest rooms and topics",
                            "Keep your workforce organized",
                            "Recommend when to add or adjust hires",
                          ].map((item) => (
                            <li key={item} className="flex gap-2">
                              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-xl border border-accent/20 bg-accent-soft/30 px-4 py-3 text-sm text-ink">
                        <Users className="mb-1 inline h-4 w-4 text-accent" /> Maya will set up{" "}
                        <strong>{roomName}</strong> and open a DM so you can hire from one durable recruiting
                        session.
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {error && (
              <div className="mx-5 mb-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 sm:mx-6">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border/70 px-5 py-3.5 sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => (step === 0 ? router.push("/login") : setStep((s) => s - 1))}
              >
                <ArrowLeft className="h-4 w-4" />
                {step === 0 ? "Back" : "Previous"}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  size="sm"
                  disabled={!canContinue || busy}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void finishSetup(false)}
                  >
                    Skip to workspace
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void finishSetup(true)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    Open Maya
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
