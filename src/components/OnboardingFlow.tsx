"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutGrid,
  Loader2,
  Rocket,
  User,
} from "lucide-react";
import { BrandLockup } from "@/components/brand/Brand";
import { useStore } from "@/lib/demo-store";
import {
  NEW_WORKSPACE_FOCUS_KEY,
  ONBOARDING_CONTEXT_KEY,
  ONBOARDING_ROOM_KEY,
  clearOnboardingLaunchPending,
  isOnboardingLaunchPending,
  markOnboardingLaunchPending,
  readOnboardingContext,
  storeOnboardingContext,
} from "@/lib/hiring/data";
import type { OnboardingContext } from "@/lib/hiring/types";
import {
  defaultWorkstreamForOutcome,
  MAYA_CAPABILITIES,
  OUTCOME_CODES,
  workstreamPresetsForOutcome,
  WORKFORCE_OUTCOMES,
  type WorkforceOutcomeId,
} from "@/lib/hiring/onboarding-presets";
import { resolveMayaDmRoomId } from "@/lib/maya-employee";
import { OnboardingJourneyNav, type JourneyStep } from "@/components/onboarding/OnboardingJourneyNav";
import { OnboardingOrgGraph } from "@/components/onboarding/OnboardingOrgGraph";
import { cn } from "@/lib/utils";

function isWorkforceOutcomeId(value: string | undefined | null): value is WorkforceOutcomeId {
  return Boolean(value && WORKFORCE_OUTCOMES.some((o) => o.id === value));
}

type SetupResult = {
  firstRoomId: string;
  roomName: string;
  mayaDmRoomId: string;
};

const STAGE_LABELS = ["Welcome", "Step 1 of 3", "Step 2 of 3", "Step 3 of 3", "Complete"] as const;
const JOURNEY_LABELS = ["Welcome", "Pick a focus", "First room", "Meet Maya", "Launch"] as const;

const CONFETTI_COLORS = ["var(--accent)", "#5FA0FF", "#22D3EE", "#1BA672", "#ffffff", "#9A6BCB"];

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="absolute -top-6 rounded-sm opacity-0"
          style={{
            left: `${(i * 37) % 100}%`,
            width: `${5 + (i % 4) * 2}px`,
            height: `${3 + (i % 4)}px`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            transform: `rotate(${(i * 47) % 360}deg)`,
            animation: `obdConfetti ${1.7 + (i % 5) * 0.32}s ${(i % 7) * 0.12}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

export function OnboardingFlow({
  escapeWorkspace = null,
  allowCancel = true,
}: {
  escapeWorkspace?: { id: string; name: string } | null;
  /** False when this HQ is already complete — cancel would only error. */
  allowCancel?: boolean;
}) {
  const { state, actions } = useStore();
  const router = useRouter();
  const restoreLaunch = useMemo(() => {
    const ctx = readOnboardingContext();
    const pending = isOnboardingLaunchPending();
    if (!pending && !ctx?.setupComplete) return null;
    return ctx;
  }, []);
  // If Launch handoff remounts after seal, land on Launch — not Welcome of a finished HQ.
  const [stage, setStage] = useState(() =>
    (state.onboardingComplete || Boolean(restoreLaunch?.setupComplete)) &&
    isOnboardingLaunchPending()
      ? 4
      : 0,
  );
  const [escaping, setEscaping] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [outcomeId, setOutcomeId] = useState<WorkforceOutcomeId | null>(() =>
    isWorkforceOutcomeId(restoreLaunch?.outcomeId) ? restoreLaunch.outcomeId : null,
  );
  /** Optional seed from /workspaces/new — session-only, not shown in the UI. */
  const [seededFocus, setSeededFocus] = useState<string | undefined>(
    () => restoreLaunch?.goalText,
  );
  const [presetId, setPresetId] = useState(() => {
    if (!restoreLaunch) return "";
    try {
      const raw = sessionStorage.getItem(ONBOARDING_ROOM_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { template?: string };
      return typeof parsed.template === "string" ? parsed.template : "";
    } catch {
      return "";
    }
  });
  const [customRoomName, setCustomRoomName] = useState(() => {
    if (!restoreLaunch) return "";
    const fromContext = restoreLaunch.roomName?.trim();
    if (fromContext) return fromContext;
    try {
      const raw = sessionStorage.getItem(ONBOARDING_ROOM_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { name?: string };
      return typeof parsed.name === "string" ? parsed.name : "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Opening your workspace…");
  const [error, setError] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(() => {
    if (restoreLaunch?.roomId && restoreLaunch.roomName) {
      return {
        firstRoomId: restoreLaunch.roomId,
        roomName: restoreLaunch.roomName,
        mayaDmRoomId: "",
      };
    }
    return null;
  });
  const [mayaText, setMayaText] = useState("");
  const [mayaDone, setMayaDone] = useState(false);
  const typedRef = useRef(false);
  const typeIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const setupInFlightRef = useRef<Promise<SetupResult> | null>(null);

  const companyName = state.workspace.name || "My AI Workspace";
  const ownerInitial = (companyName.trim()[0] || "N").toUpperCase();
  const liveFirstRoom = useMemo(
    () => state.rooms.find((r) => r.kind === "room") ?? null,
    [state.rooms],
  );
  const liveMayaDmId = useMemo(
    () => resolveMayaDmRoomId(state.rooms, state.user?.id),
    [state.rooms, state.user?.id],
  );

  useEffect(() => {
    try {
      const focus = sessionStorage.getItem(NEW_WORKSPACE_FOCUS_KEY);
      if (focus?.trim()) {
        setSeededFocus(focus.trim());
        sessionStorage.removeItem(NEW_WORKSPACE_FOCUS_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const presets = useMemo(
    () => (outcomeId ? workstreamPresetsForOutcome(outcomeId) : []),
    [outcomeId],
  );
  const activePreset = useMemo(() => {
    const picked = presets.find((p) => p.id === presetId);
    return picked ?? presets[0] ?? (outcomeId ? defaultWorkstreamForOutcome(outcomeId) : null);
  }, [presets, presetId, outcomeId]);

  const roomName =
    customRoomName.trim() ||
    setupResult?.roomName ||
    liveFirstRoom?.name ||
    activePreset?.name ||
    restoreLaunch?.roomName ||
    "—";
  const outcomeTitle =
    WORKFORCE_OUTCOMES.find((o) => o.id === outcomeId)?.title ||
    restoreLaunch?.outcomeTitle ||
    "Not set";
  const hireName =
    activePreset?.suggestedHires[0] ||
    restoreLaunch?.suggestedHires?.[0] ||
    "First hire";

  const progressPct = (stage / 4) * 100;

  const buildMayaMessage = useCallback(() => {
    const ws = roomName !== "—" ? roomName : "your first room";
    return `Hi — I'm Maya, your AI Workforce Manager. I'll spin up ${ws} and open a DM so you can hire, organize, and improve your AI employees from one place — always with your sign-off. Ready when you are?`;
  }, [roomName]);

  const startMayaTyping = useCallback(() => {
    const full = buildMayaMessage();
    let i = 0;
    if (typeIntervalRef.current) clearInterval(typeIntervalRef.current);
    setMayaText("");
    setMayaDone(false);
    typeIntervalRef.current = setInterval(() => {
      i += 2;
      setMayaText(full.slice(0, i));
      if (i >= full.length) {
        if (typeIntervalRef.current) clearInterval(typeIntervalRef.current);
        setMayaText(full);
        setMayaDone(true);
      }
    }, 16);
  }, [buildMayaMessage]);

  useEffect(() => {
    if (stage === 3 && !typedRef.current) {
      typedRef.current = true;
      const t = setTimeout(() => startMayaTyping(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [stage, startMayaTyping]);

  useEffect(() => {
    return () => {
      if (typeIntervalRef.current) clearInterval(typeIntervalRef.current);
    };
  }, []);

  const persistDrafts = (roomId?: string, resolvedRoomName?: string) => {
    if (!outcomeId || !activePreset) return;
    const effectiveRoomName = resolvedRoomName ?? roomName;
    const context: OnboardingContext = {
      goalText: seededFocus,
      outcomeId,
      outcomeTitle,
      roomName: effectiveRoomName,
      roomId,
      suggestedTopics: activePreset.topics,
      suggestedHires: activePreset.suggestedHires,
      setupComplete: Boolean(roomId),
    };
    storeOnboardingContext(context);
    sessionStorage.setItem(
      ONBOARDING_ROOM_KEY,
      JSON.stringify({
        name: effectiveRoomName,
        accent: activePreset.accent,
        template: activePreset.id,
        roomId,
      }),
    );
    sessionStorage.setItem(ONBOARDING_CONTEXT_KEY, JSON.stringify(context));
  };

  // Keep plan in sessionStorage as the user progresses so Launch remounts
  // (after onboarding_complete seals) still show focus / room / hire names.
  useEffect(() => {
    if (!outcomeId || !activePreset) return;
    persistDrafts(setupResult?.firstRoomId, setupResult?.roomName || roomName);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistDrafts closes over latest plan fields
  }, [outcomeId, activePreset, roomName, setupResult?.firstRoomId, setupResult?.roomName]);

  const ensureWorkspaceSetup = async (): Promise<SetupResult> => {
    if (setupResult?.firstRoomId && setupResult.roomName) {
      const mayaDmRoomId = setupResult.mayaDmRoomId || liveMayaDmId;
      if (mayaDmRoomId && mayaDmRoomId !== setupResult.mayaDmRoomId) {
        const patched = { ...setupResult, mayaDmRoomId };
        setSetupResult(patched);
        return patched;
      }
      return { ...setupResult, mayaDmRoomId };
    }
    if (setupInFlightRef.current) return setupInFlightRef.current;

    // Remount / recovery: room already exists — don't require local plan state.
    if (liveFirstRoom && state.workspace.id) {
      const resolved: SetupResult = {
        firstRoomId: liveFirstRoom.id,
        roomName: liveFirstRoom.name,
        mayaDmRoomId: liveMayaDmId,
      };
      setSetupResult(resolved);
      if (outcomeId && activePreset) {
        persistDrafts(resolved.firstRoomId, resolved.roomName);
      } else if (restoreLaunch) {
        storeOnboardingContext({
          ...restoreLaunch,
          roomId: resolved.firstRoomId,
          roomName: resolved.roomName,
          setupComplete: true,
        });
      }
      return resolved;
    }

    if (!activePreset || !outcomeId) {
      throw new Error("Complete the earlier steps before continuing.");
    }

    const run = (async () => {
      const result = await actions.setupOnboardingWorkspace({
        workspaceName: companyName,
        room: {
          name: roomName === "—" ? activePreset.name : roomName,
          accent: activePreset.accent,
          description: `${roomName === "—" ? activePreset.name : roomName} — your first AI workstream`,
        },
      });
      const resolved: SetupResult = {
        firstRoomId: result.firstRoomId,
        roomName: result.roomName,
        mayaDmRoomId: result.mayaDmRoomId || liveMayaDmId,
      };
      persistDrafts(result.firstRoomId, result.roomName);
      setSetupResult(resolved);
      return resolved;
    })();

    setupInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (setupInFlightRef.current === run) setupInFlightRef.current = null;
    }
  };

  const finishAndLeave = async (
    destination: "__first_room__" | "__hire__" | string,
    label = "Opening your workspace…",
  ) => {
    setBusyLabel(label);
    setBusy(true);
    setError(null);
    try {
      const result = await ensureWorkspaceSetup();
      // Seal + persist before navigation so AppShell cannot bounce back to /onboarding.
      markOnboardingLaunchPending();
      await actions.completeOnboarding();
      // Hire CTA must open HireFlow (onboarding mode), not a Maya DM / empty /rooms URL
      // that bounces people onto workspace home.
      const hireTarget = `/hire?onboarding=1&fresh=${Date.now()}`;
      let target = hireTarget;
      if (destination === "__first_room__") {
        target = `/rooms/${result.firstRoomId}`;
      } else if (destination.startsWith("/")) {
        target = destination;
      } else if (destination === "__hire__" || destination === "__maya_dm__") {
        target = hireTarget;
      }
      clearOnboardingLaunchPending();
      router.replace(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup.");
      setBusy(false);
    }
  };

  const skipToWorkspace = () => finishAndLeave("__first_room__", "Opening your workspace…");

  const continueFromMaya = async () => {
    setBusyLabel("Finishing setup…");
    setBusy(true);
    setError(null);
    try {
      await ensureWorkspaceSetup();
      // Mark Launch handoff BEFORE persisting complete, so /onboarding does not
      // redirect away / remount and wipe the plan while this tab still needs step 5.
      markOnboardingLaunchPending();
      // Workspace + first room exist — onboarding is done even if they hire later.
      await actions.completeOnboarding();
      setBusy(false);
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup.");
      setBusy(false);
    }
  };

  const openMayaHiringJourney = () => finishAndLeave("__hire__", "Opening Maya…");

  const goToWorkspaceFromLaunch = () => finishAndLeave("__first_room__", "Opening your workspace…");

  const goStage = (n: number) => setStage(n);
  const next = () => setStage((s) => Math.min(4, s + 1));
  const back = () => setStage((s) => Math.max(0, s - 1));

  const canContinue = stage === 1 ? outcomeId !== null : stage === 2 ? Boolean(roomName.trim() && roomName !== "—") : true;

  const journeySteps: JourneyStep[] = useMemo(() => {
    const focusLabel = outcomeTitle !== "Not set" ? outcomeTitle : "—";
    const roomLabel = roomName !== "—" ? roomName : "—";
    const values = [
      companyName,
      focusLabel,
      roomLabel,
      roomLabel !== "—" || focusLabel !== "—" ? "AI Workforce Manager" : "—",
      hireName,
    ];
    return JOURNEY_LABELS.map((label, i) => {
      const status = i < stage ? "done" : i === stage ? "current" : "todo";
      return {
        label,
        value: values[i] ?? "—",
        status,
        onGo: i < stage && stage < 4 ? () => goStage(i) : undefined,
      };
    });
  }, [companyName, outcomeTitle, roomName, hireName, stage]);

  const hasPlan = Boolean(outcomeId && activePreset);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[var(--canvas)]">
      {/* Left pane */}
      <aside className="relative flex w-[43%] max-w-[560px] min-w-[430px] flex-col overflow-hidden bg-gradient-to-br from-[#191512] via-[#221C16] to-[#2B2119] px-[34px] pb-5 pt-6 text-white">
        <div
          className="obd-glow pointer-events-none absolute -top-[8%] left-1/2 h-[520px] w-[560px] -translate-x-1/2 rounded-full blur-[14px]"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 62%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <header className="relative z-[3] flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 items-center rounded-xl bg-white/95 px-2.5 py-1.5 shadow-[0_8px_24px_-8px_rgba(47,111,237,.45)]">
              <BrandLockup size={26} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-white/45">
                Workspace setup
              </span>
              <span className="truncate text-[15px] font-bold tracking-tight">{companyName}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {escapeWorkspace ? (
              <button
                type="button"
                disabled={escaping || busy || cancelling}
                onClick={() => {
                  if (escaping) return;
                  setEscaping(true);
                  void (async () => {
                    try {
                      await actions.switchWorkspace(escapeWorkspace.id);
                      router.replace("/");
                    } finally {
                      setEscaping(false);
                    }
                  })();
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white disabled:opacity-60"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {escaping ? "Switching…" : `Back to ${escapeWorkspace.name}`}
              </button>
            ) : null}
            {allowCancel && state.workspace.id ? (
              <button
                type="button"
                disabled={cancelling || busy || escaping}
                onClick={() => {
                  if (cancelling) return;
                  const name = state.workspace.name || "this workspace";
                  const ok = window.confirm(
                    `Cancel onboarding and permanently delete “${name}”? Rooms and hires in this unfinished HQ will be removed. Your account and other workspaces stay intact.`,
                  );
                  if (!ok) return;
                  setCancelling(true);
                  setError(null);
                  void (async () => {
                    try {
                      await actions.cancelIncompleteWorkspace(state.workspace.id);
                      router.replace(escapeWorkspace ? "/" : "/workspaces/new");
                    } catch (err) {
                      const message =
                        err instanceof Error
                          ? err.message
                          : "Could not cancel onboarding.";
                      // Already complete in DB — leave wizard instead of trapping the user.
                      if (/already finished setup|onboarding_already_complete/i.test(message)) {
                        clearOnboardingLaunchPending();
                        await actions.completeOnboarding().catch(() => undefined);
                        router.replace("/");
                        return;
                      }
                      setError(message);
                    } finally {
                      setCancelling(false);
                    }
                  })();
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100/90 transition hover:border-rose-300/40 hover:bg-rose-500/20 disabled:opacity-60"
              >
                {cancelling ? "Deleting…" : "Cancel onboarding"}
              </button>
            ) : null}
          </div>
        </header>

        <OnboardingOrgGraph
          ownerInitial={ownerInitial}
          roomName={roomName}
          hireName={hireName}
          showRoom={stage >= 1 && hasPlan}
          showMaya={stage >= 3}
          showHire={stage >= 2 && hasPlan}
          connectYouRoom={stage >= 1 && hasPlan}
          connectYouMaya={stage >= 3}
          connectRoomHire={stage >= 2 && hasPlan}
          connectMayaRoom={stage >= 3 && hasPlan}
        />

        <OnboardingJourneyNav steps={journeySteps} progressLinePct={progressPct} />
      </aside>

      {/* Right pane */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--canvas)]">
        <div className="flex-none px-12 pt-[22px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.09em] text-ink-3">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Status · guided setup
            </span>
            <span className="text-[12.5px] font-medium text-ink-2">{STAGE_LABELS[stage]}</span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="relative flex flex-1 justify-center overflow-y-auto">
          <div key={`stage-${stage}`} className="obd-fade-up relative w-full max-w-[760px] px-12 py-10 pb-12">
            {/* Stage 0 — Welcome */}
            {stage === 0 && (
              <div className="flex flex-col gap-0 py-3.5">
                <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-accent shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  Welcome to AdeHQ
                </span>
                <h1 className="mb-4 max-w-[16ch] text-[40px] font-bold leading-[1.05] tracking-[-0.035em]">
                  Let&apos;s build {companyName}&apos;s AI workforce
                  <span className="text-accent">.</span>
                </h1>
                <p className="mb-6 max-w-[52ch] text-base leading-relaxed text-ink-2">
                  Three quick steps: name the work, open a room, meet Maya. Nothing ships until you
                  say so — you stay the hiring manager.
                </p>
                <div className="mb-[30px] flex gap-[26px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[19px] font-bold">3 steps</span>
                    <span className="text-xs text-ink-3">guided setup</span>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[19px] font-bold">~2 min</span>
                    <span className="text-xs text-ink-3">to finish</span>
                  </div>
                  <div className="w-px bg-border" />
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-[19px] font-bold">Reversible</span>
                    <span className="text-xs text-ink-3">change anytime</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex items-center gap-2.5 self-start rounded-xl border-0 bg-[var(--accent)] px-[26px] py-3.5 text-[15.5px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(47,111,237,.55)] transition hover:brightness-105 active:translate-y-px"
                >
                  Begin setup
                  <ArrowRight className="h-[18px] w-[18px]" />
                </button>
              </div>
            )}

            {/* Stage 1 — Pick a focus (drives room recommendations in the next step) */}
            {stage === 1 && (
              <div className="flex flex-col gap-[26px]">
                <div>
                  <h1 className="mb-2.5 text-[32px] font-bold leading-[1.1] tracking-[-0.025em]">
                    What should your AI workforce focus on
                    <span className="text-accent">?</span>
                  </h1>
                  <p className="max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
                    This picks which rooms and first-hire suggestions we show next. You only open
                    one room in the following step — you can change or add more later.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3.5">
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
                          "relative flex flex-col items-start gap-1.5 rounded-2xl border p-4 pb-[15px] text-left transition duration-150",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_12px_30px_-18px_color-mix(in_srgb,var(--accent)_80%,transparent)]"
                            : "border-border bg-surface hover:-translate-y-0.5 hover:border-ink-3 hover:shadow-[0_12px_30px_-14px_rgba(40,34,24,0.22)]",
                        )}
                      >
                        <div className="flex w-full items-center justify-between">
                          <div
                            className={cn(
                              "flex h-[30px] w-[30px] items-center justify-center rounded-[9px] font-mono text-[12.5px] font-semibold",
                              selected ? "bg-[var(--accent)] text-white" : "bg-muted text-ink-2",
                            )}
                          >
                            {OUTCOME_CODES[outcome.id]}
                          </div>
                          {selected && (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)]">
                              <Check className="h-3 w-3 text-white" strokeWidth={3} />
                            </div>
                          )}
                        </div>
                        <span className="text-[15px] font-semibold tracking-tight text-ink">
                          {outcome.title}
                        </span>
                        <span className="text-[12.5px] leading-snug text-ink-2">{outcome.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stage 2 — First room */}
            {stage === 2 && activePreset && (
              <div className="flex flex-col gap-[26px]">
                <div>
                  <h1 className="mb-2.5 text-[32px] font-bold leading-[1.1] tracking-[-0.025em]">
                    Open your first room
                    <span className="text-accent">.</span>
                  </h1>
                  <p className="max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
                    Based on <span className="font-medium text-ink">{outcomeTitle}</span>, here are
                    rooms that fit. Pick one to open — humans and AI employees will share that desk.
                  </p>
                </div>
                <div className="flex flex-col gap-3.5">
                  <div className="flex flex-wrap gap-2.5">
                    {presets.map((preset) => {
                      const selected =
                        (presetId || presets[0]?.id) === preset.id && !customRoomName.trim();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setPresetId(preset.id);
                            setCustomRoomName("");
                          }}
                          className={cn(
                            "rounded-full px-4 py-2.5 text-[13.5px] font-semibold transition",
                            selected
                              ? "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-d)]"
                              : "border border-border bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                          )}
                        >
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    className="input-field rounded-xl py-3.5"
                    placeholder="Custom room name (optional)"
                    value={customRoomName}
                    onChange={(e) => setCustomRoomName(e.target.value)}
                  />
                </div>
                <div className="rounded-[18px] border border-border bg-surface p-[22px] shadow-[0_1px_3px_rgba(40,30,15,0.06)]">
                  <div className="mb-[18px] flex items-center gap-[11px]">
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-[var(--accent-soft)]">
                      <LayoutGrid className="h-[19px] w-[19px] text-[var(--accent)]" strokeWidth={1.9} />
                    </div>
                    <div className="flex flex-col gap-px">
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                        Room
                      </span>
                      <span className="text-[17px] font-bold tracking-tight">{roomName}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-[22px]">
                    <div>
                      <div className="mb-2.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">
                        Starting topics
                      </div>
                      <div className="flex flex-col gap-2">
                        {activePreset.topics.map((t) => (
                          <div key={t} className="flex items-center gap-2.5 text-[13.5px] text-ink">
                            <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--accent)]" />
                            {t}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">
                        Suggested first hires
                      </div>
                      <div className="flex flex-col gap-2">
                        {activePreset.suggestedHires.map((h) => (
                          <div key={h} className="flex items-center gap-2.5 text-[13.5px] text-ink">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted">
                              <User className="h-3 w-3 text-ink-2" strokeWidth={2} />
                            </span>
                            {h}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stage 3 — Meet Maya */}
            {stage === 3 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h1 className="mb-2.5 text-[32px] font-bold leading-[1.1] tracking-[-0.025em]">
                    Meet Maya
                    <span className="text-accent">.</span>
                  </h1>
                  <p className="max-w-[58ch] text-[15px] leading-relaxed text-ink-2">
                    Your AI Workforce Manager — she helps you hire, organize, improve, and keep the
                    org chart honest.
                  </p>
                </div>
                <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface p-[26px] shadow-[0_12px_30px_-14px_rgba(40,34,24,0.22)]">
                  <div className="pointer-events-none absolute -right-[30px] -top-10 h-[180px] w-[180px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,.16),transparent_65%)]" />
                  <div className="relative mb-[18px] flex items-center gap-3.5">
                    <div className="relative h-[52px] w-[52px] shrink-0">
                      <div className="obd-maya-ring absolute left-1/2 top-1/2 h-[52px] w-[52px] rounded-full border-2 border-cyan-400/50" />
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-600 text-[17px] font-extrabold text-white shadow-[0_8px_22px_-6px_rgba(34,211,238,.5)]">
                        M
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-lg font-bold">Maya</span>
                      <span className="text-[13px] text-ink-2">AI Workforce Manager</span>
                    </div>
                  </div>
                  <p className="relative mb-5 min-h-[76px] text-[15px] leading-relaxed text-ink">
                    {mayaText}
                    {!mayaDone && (
                      <span className="obd-caret ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 bg-[var(--accent)] align-[-2px]" />
                    )}
                  </p>
                  <div className="relative grid grid-cols-2 gap-x-[22px] gap-y-[11px]">
                    {MAYA_CAPABILITIES.map((c) => (
                      <div key={c} className="flex items-center gap-2.5 text-[13.5px] text-ink">
                        <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)]">
                          <Check className="h-[11px] w-[11px] text-[var(--accent)]" strokeWidth={3} />
                        </span>
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-[11px] rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[var(--accent-soft)] px-[17px] py-[15px]">
                  <User className="mt-px h-[18px] w-[18px] shrink-0 text-[var(--accent-d)]" strokeWidth={1.9} />
                  <p className="m-0 text-[13.5px] leading-snug text-ink">
                    Maya will set up <strong className="font-bold">{roomName}</strong> and open a DM,
                    so you can hire from one durable recruiting session — always with your sign-off.
                  </p>
                </div>
              </div>
            )}

            {/* Stage 4 — Finale */}
            {stage === 4 && (
              <>
                <Confetti />
                <div className="relative flex flex-col items-center gap-0 px-0 py-[18px] text-center">
                  <div className="obd-pop-center mb-[18px] flex h-[60px] w-[60px] items-center justify-center rounded-full bg-gradient-to-br from-[#1BA672] to-[#54C79A] shadow-[0_14px_34px_-10px_rgba(27,166,114,.6)]">
                    <Check className="h-[29px] w-[29px] text-white" strokeWidth={2.6} />
                  </div>
                  <span className="obd-fade-up mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-accent shadow-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-green" />
                    Status · setup complete
                  </span>
                  <h1 className="obd-fade-up mb-3 text-[36px] font-bold leading-[1.06] tracking-[-0.03em]">
                    Your workspace is ready
                    <span className="text-accent">.</span>
                  </h1>
                  <p className="obd-fade-up mb-[22px] max-w-[50ch] text-[15.5px] leading-relaxed text-ink-2">
                    {companyName}
                    {outcomeTitle !== "Not set" ? (
                      <>
                        {" "}
                        is wired around{" "}
                        <strong className="font-semibold text-ink">{outcomeTitle}</strong>
                      </>
                    ) : null}
                    {roomName !== "—" ? (
                      <>
                        . Your first room is{" "}
                        <strong className="font-semibold text-ink">{roomName}</strong>
                      </>
                    ) : (
                      "."
                    )}
                    {" "}
                    Maya is ready to help you hire your {hireName}.
                  </p>
                  <div className="obd-fade-up flex w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-surface text-left shadow-[0_12px_30px_-14px_rgba(40,34,24,0.22)]">
                    <div className="flex w-[52px] shrink-0 flex-col items-center gap-3.5 bg-[var(--rail)] py-3.5">
                      <div className="h-[26px] w-[26px] rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)]" />
                      <div className="h-[22px] w-[22px] rounded-md bg-white/14" />
                      <div className="h-[22px] w-[22px] rounded-md bg-white/8" />
                    </div>
                    <div className="min-w-0 flex-1 px-[18px] py-4">
                      <div className="mb-3.5 flex items-center gap-2">
                        <LayoutGrid className="h-[15px] w-[15px] text-ink-2" strokeWidth={1.9} />
                        <span className="text-[13.5px] font-bold">{roomName}</span>
                      </div>
                      <div className="flex items-start gap-2.5 rounded-xl bg-muted px-3.5 py-2.5">
                        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-600 text-xs font-bold text-white">
                          M
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-semibold text-ink-3">Maya · now</span>
                          <span className="text-[13px] leading-snug text-ink">
                            Welcome in! Ready to hire your {hireName} whenever you are.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer — stages 1–3 */}
        {stage >= 1 && stage <= 3 && (
          <footer className="flex flex-none items-center justify-between border-t border-border bg-[color-mix(in_srgb,var(--canvas)_85%,transparent)] px-12 py-4 backdrop-blur-sm">
            <button
              type="button"
              onClick={back}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-[10px] border-0 bg-transparent px-1 py-2.5 text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50"
            >
              <ArrowLeft className="h-[17px] w-[17px]" />
              Back
            </button>
            <div className="flex items-center gap-3.5">
              {stage === 3 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void skipToWorkspace()}
                  className="rounded-[10px] border-0 bg-transparent px-2 py-2.5 text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50"
                >
                  Skip to workspace
                </button>
              )}
              <button
                type="button"
                disabled={!canContinue || busy}
                onClick={() => (stage === 3 ? void continueFromMaya() : next())}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border-0 px-6 py-3.5 text-[14.5px] font-semibold transition",
                  canContinue && !busy
                    ? "cursor-pointer bg-[var(--accent)] text-white shadow-[0_8px_24px_-8px_rgba(47,111,237,.55)] hover:brightness-105 active:translate-y-px"
                    : "cursor-not-allowed bg-muted text-ink-3 shadow-none",
                )}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-[17px] w-[17px]" />
                  </>
                )}
              </button>
            </div>
          </footer>
        )}

        {/* Footer — stage 4 */}
        {stage === 4 && (
          <footer className="flex flex-none items-center justify-between border-t border-border bg-[color-mix(in_srgb,var(--canvas)_85%,transparent)] px-12 py-4 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => void goToWorkspaceFromLaunch()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-[10px] border-0 bg-transparent px-1 py-2.5 text-sm font-medium text-ink-2 transition hover:text-ink disabled:opacity-50"
            >
              Go to workspace
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void openMayaHiringJourney()}
              className="inline-flex items-center gap-2.5 rounded-xl border-0 bg-[var(--accent)] px-[26px] py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(47,111,237,.55)] transition hover:brightness-105 active:translate-y-px disabled:opacity-70"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Rocket className="h-[17px] w-[17px]" />
                  Hire with Maya
                </>
              )}
            </button>
          </footer>
        )}
      </main>

      {/* Opening overlay */}
      {busy && (
        <div className="absolute inset-0 z-50 flex animate-[obdFadeIn_0.3s_ease] flex-col items-center justify-center gap-[22px] bg-gradient-to-br from-[#191512] to-[#2B2119] text-white">
          <div className="h-[46px] w-[46px] animate-spin rounded-full border-[3px] border-white/15 border-t-[var(--accent)]" />
          <span className="text-[15px] font-semibold">{busyLabel}</span>
        </div>
      )}
    </div>
  );
}
