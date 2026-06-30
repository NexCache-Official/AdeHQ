"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/demo-store";
import { buildBriefFromRoleSeed, emptyBrief, mergeAnswers } from "@/lib/hiring/build-brief";
import {
  DEMO_APPLICANTS,
  DEPARTMENT_CARDS,
  GEN_STEPS,
  HIRE_EXAMPLES,
  INTERVIEW_ANSWERS,
  INTERVIEW_QUESTIONS,
  MATCH_BARS,
  ONBOARDING_ROOM_KEY,
  SUCCESS_LABELS,
} from "@/lib/hiring/data";
import { candidateToEmployee } from "@/lib/hiring/map-candidate";
import type {
  DemoApplicant,
  HiringMessage,
  HiringScreen,
  JobBrief,
  OnboardingRoomDraft,
  RecruiterApiResponse,
} from "@/lib/hiring/types";
import type { ProjectRoom, WorkLogEvent } from "@/lib/types";
import { cn, nowISO, uid } from "@/lib/utils";
import { getGroupChannels } from "@/lib/rooms";
import { AdeOrb, HireHeader, HireStepper, MetricDots } from "./HireChrome";

type HireFlowProps = {
  onboarding?: boolean;
};

async function callRecruiter(payload: Record<string, unknown>): Promise<RecruiterApiResponse> {
  const res = await fetch("/api/hiring/recruiter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Recruiter unavailable");
  }
  return res.json();
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("");
}

export function HireFlow({ onboarding = false }: HireFlowProps) {
  const { state, actions } = useStore();
  const router = useRouter();

  const [screen, setScreen] = useState<HiringScreen>("landing");
  const [roleInput, setRoleInput] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HiringMessage[]>([]);
  const [brief, setBrief] = useState<JobBrief>(emptyBrief());
  const [briefEditable, setBriefEditable] = useState(false);
  const [briefReady, setBriefReady] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [refineInput, setRefineInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [advOpen, setAdvOpen] = useState<Record<string, boolean>>({});
  const [compareOpen, setCompareOpen] = useState(false);
  const [interviewWith, setInterviewWith] = useState<string | null>(null);
  const [interviewMsgs, setInterviewMsgs] = useState<Record<string, HiringMessage[]>>({});
  const [hireId, setHireId] = useState("eleanor");
  const [successStep, setSuccessStep] = useState(0);
  const [regenSpin, setRegenSpin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const genTimer = useRef<ReturnType<typeof setInterval>>();
  const sucTimer = useRef<ReturnType<typeof setInterval>>();

  const rooms = useMemo(() => {
    const channels = getGroupChannels(state.rooms);
    const options = channels.slice(0, 6).map((r) => `${r.name} → General`);
    return [...options, "Create a new room…"];
  }, [state.rooms]);

  const recruiterTurns = messages.filter((m) => m.role === "user").length;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, screen]);

  useEffect(() => {
    return () => {
      if (genTimer.current) clearInterval(genTimer.current);
      if (sucTimer.current) clearInterval(sucTimer.current);
    };
  }, []);

  const roleSeed = useMemo(() => {
    if (roleInput.trim()) return roleInput.trim();
    const dept = DEPARTMENT_CARDS.find((d) => d.id === departmentId);
    return dept && dept.id !== "custom" ? dept.name : "";
  }, [roleInput, departmentId]);

  const applyRecruiterResponse = useCallback(
    (res: RecruiterApiResponse, appendAde = true) => {
      if (appendAde && res.message) {
        setMessages((prev) => [...prev, { role: "ade", text: res.message }]);
      }
      setChips(res.chips ?? []);
      setShowLocationPicker(res.showLocationPicker ?? false);
      setBriefReady(res.briefReady ?? false);
      if (res.brief) setBrief(res.brief);
      else if (res.answers) {
        setBrief((prev) => mergeAnswers(prev, res.answers!));
      }
    },
    [],
  );

  const startRecruiter = async (seed?: string) => {
    const nextSeed = seed ?? roleSeed;
    if (!nextSeed && !departmentId) return;
    setError(null);
    setScreen("recruiter");
    setMessages([]);
    setBriefReady(false);
    setBusy(true);
    try {
      const res = await callRecruiter({
        roleSeed: nextSeed,
        departmentId,
        messages: [],
      });
      setMessages([{ role: "ade", text: res.message }]);
      applyRecruiterResponse(res, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recruiter.");
    } finally {
      setBusy(false);
    }
  };

  const sendUserMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const nextMessages: HiringMessage[] = [...messages, { role: "user", text: trimmed }];
    setMessages(nextMessages);
    setChatInput("");
    setBusy(true);
    try {
      const res = await callRecruiter({
        roleSeed,
        departmentId,
        messages: nextMessages,
        currentBrief: brief,
      });
      applyRecruiterResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message failed.");
    } finally {
      setBusy(false);
    }
  };

  const refineBrief = async () => {
    const instruction = refineInput.trim();
    if (!instruction || busy) return;
    setError(null);
    setBusy(true);
    const nextMessages: HiringMessage[] = [
      ...messages,
      { role: "user", text: instruction },
    ];
    setMessages(nextMessages);
    setRefineInput("");
    try {
      const res = await callRecruiter({
        roleSeed,
        departmentId,
        messages: nextMessages,
        currentBrief: brief,
        mode: "refine",
        refineInstruction: instruction,
      });
      applyRecruiterResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refine brief.");
    } finally {
      setBusy(false);
    }
  };

  const regenerateBrief = async () => {
    setRegenSpin(true);
    setBusy(true);
    try {
      const res = await callRecruiter({
        roleSeed,
        departmentId,
        messages,
        currentBrief: brief,
        mode: "regenerate",
      });
      if (res.brief) setBrief(res.brief);
      else setBrief(buildBriefFromRoleSeed(roleSeed, brief, departmentId));
    } catch {
      setBrief(buildBriefFromRoleSeed(roleSeed, brief, departmentId));
    } finally {
      setBusy(false);
      setTimeout(() => setRegenSpin(false), 700);
    }
  };

  const generateApplicants = () => {
    setScreen("generating");
    setGenStep(0);
    if (genTimer.current) clearInterval(genTimer.current);
    genTimer.current = setInterval(() => {
      setGenStep((n) => {
        if (n >= GEN_STEPS.length) {
          if (genTimer.current) clearInterval(genTimer.current);
          setScreen("shortlist");
          return n;
        }
        return n + 1;
      });
    }, 620);
  };

  const pickApplicant = (id: string) => {
    setHireId(id);
    setInterviewWith(null);
    setCompareOpen(false);
    setScreen("offer");
  };

  const confirmHire = async () => {
    const candidate = DEMO_APPLICANTS.find((a) => a.id === hireId) ?? DEMO_APPLICANTS[1];
    const roomId = state.rooms.find((r) => brief.startLocation.includes(r.name))?.id;
    const employee = candidateToEmployee(candidate, brief, departmentId, roomId);

    if (onboarding) {
      const draftRaw = sessionStorage.getItem(ONBOARDING_ROOM_KEY);
      let room: ProjectRoom;
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as OnboardingRoomDraft;
        const timestamp = nowISO();
        room = {
          id: uid("room"),
          name: draft.name,
          kind: "channel",
          description: `${draft.name} workspace channel`,
          brief: brief.mission,
          humans: state.user ? [state.user.id] : [],
          aiEmployees: [employee.id],
          accent: draft.accent,
          messages: [
            {
              id: uid("msg"),
              roomId: "",
              senderType: "system",
              senderId: "system",
              senderName: "AdeHQ",
              content: `Welcome to ${draft.name}. Mention @${employee.name} to get started.`,
              createdAt: timestamp,
            },
          ],
          tasks: [],
          memory: [],
          unread: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        room.messages[0].roomId = room.id;
        employee.defaultRoomId = room.id;
      } else {
        const firstChannel = getGroupChannels(state.rooms)[0];
        employee.defaultRoomId = firstChannel?.id;
        room = firstChannel
          ? {
              ...firstChannel,
              aiEmployees: [...firstChannel.aiEmployees, employee.id],
              updatedAt: nowISO(),
            }
          : {
              id: uid("room"),
              name: "General",
              kind: "channel",
              description: "General workspace channel",
              brief: brief.mission,
              humans: state.user ? [state.user.id] : [],
              aiEmployees: [employee.id],
              accent: "#e85d2c",
              messages: [],
              tasks: [],
              memory: [],
              unread: 0,
              createdAt: nowISO(),
              updatedAt: nowISO(),
            };
      }

      const workLog: WorkLogEvent = {
        id: uid("wl"),
        roomId: room.id,
        employeeId: employee.id,
        action: "Onboarding hire complete",
        summary: `${employee.name} joined via Ade Recruiter.`,
        status: "success",
        createdAt: nowISO(),
      };

      try {
        const { roomId: savedRoomId } = await actions.finishOnboarding({
          workspaceName: state.workspace.name,
          employee,
          room,
          workLog,
        });
        sessionStorage.removeItem(ONBOARDING_ROOM_KEY);
        setScreen("success");
        runSuccessAnimation();
        setTimeout(() => router.replace(`/rooms/${savedRoomId}`), 3200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not complete hire.");
      }
      return;
    }

    actions.hireEmployee(employee);
    const dm = actions.openOrCreateDM(employee.id);
    setScreen("success");
    runSuccessAnimation();
    setTimeout(() => router.replace(`/rooms/${dm.id}`), 3200);
  };

  const runSuccessAnimation = () => {
    setSuccessStep(0);
    if (sucTimer.current) clearInterval(sucTimer.current);
    sucTimer.current = setInterval(() => {
      setSuccessStep((n) => {
        if (n >= SUCCESS_LABELS.length) {
          if (sucTimer.current) clearInterval(sucTimer.current);
          return n;
        }
        return n + 1;
      });
    }, 380);
  };

  const openInterview = (a: DemoApplicant) => {
    const cur = interviewMsgs[a.id] ?? [
      {
        role: "ade",
        text: `Hi — I'm ${a.name}. Ask me anything about how I'd work with you.`,
      },
    ];
    setInterviewMsgs((prev) => ({ ...prev, [a.id]: cur }));
    setInterviewWith(a.id);
  };

  const askInterview = (qid: string) => {
    if (!interviewWith) return;
    const q = INTERVIEW_QUESTIONS.find((x) => x.id === qid);
    if (!q) return;
    const a =
      INTERVIEW_ANSWERS[interviewWith]?.[qid] ??
      "That's a great question — I'd tailor my approach to your goals and check in with you before anything goes external.";
    setInterviewMsgs((prev) => ({
      ...prev,
      [interviewWith]: [
        ...(prev[interviewWith] ?? []),
        { role: "user", text: q.label },
        { role: "ade", text: a },
      ],
    }));
  };

  const hired = DEMO_APPLICANTS.find((a) => a.id === hireId) ?? DEMO_APPLICANTS[1];
  const ivApplicant = interviewWith
    ? DEMO_APPLICANTS.find((a) => a.id === interviewWith)
    : null;

  const previewRows = [
    { label: "Role", value: brief.roleTitle || roleSeed || "—" },
    { label: "Industry", value: brief.industry || "—" },
    { label: "Focus", value: brief.focus || "—" },
    { label: "Tone", value: brief.tone || "—" },
    { label: "Proactivity", value: brief.proactivity || "—" },
    { label: "Priority", value: brief.priority || "—" },
    { label: "Start location", value: brief.startLocation || "—" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <HireHeader />
      <HireStepper screen={screen} recruiterTurns={recruiterTurns} />

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-5 pb-20 pt-5">
        {error && (
          <div className="mb-4 w-full max-w-[1080px] rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {/* LANDING */}
        {screen === "landing" && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-[920px]"
          >
            <div className="mb-8 mt-3.5 text-center">
              <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green" />
                Your AI workforce, hired like real teammates
              </div>
              <h1 className="mb-3.5 text-[46px] font-semibold leading-[1.04] tracking-[-1.6px] text-ink">
                Who do you want to hire?
              </h1>
              <p className="mx-auto max-w-[560px] text-[17px] leading-relaxed text-ink-2">
                Describe the role your business needs. Ade Recruiter will help craft the job brief
                and find the best AI employee candidates.
              </p>
            </div>

            <div className="rounded-[18px] border border-border bg-surface p-2 shadow-[0_1px_2px_rgba(34,31,26,0.04),0_24px_48px_-28px_rgba(34,31,26,0.22)]">
              <div className="flex flex-wrap items-center gap-2.5 px-4 py-1.5 sm:flex-nowrap">
                <span className="whitespace-nowrap text-base text-ink-3">I need someone who can…</span>
                <input
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  placeholder="get my startup press coverage"
                  className="min-w-0 flex-1 border-none bg-transparent py-2.5 text-base text-ink outline-none"
                  onKeyDown={(e) => e.key === "Enter" && startRecruiter()}
                />
                <button
                  type="button"
                  onClick={() => startRecruiter()}
                  disabled={!roleInput.trim() && !departmentId}
                  className="whitespace-nowrap rounded-xl bg-ink px-[18px] py-3.5 text-[14.5px] font-medium text-white transition hover:bg-ink/90 disabled:opacity-40"
                >
                  Continue with Ade Recruiter →
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2 px-0.5">
              {HIRE_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setRoleInput(ex)}
                  className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] text-ink-2 transition hover:border-ink/30 hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>

            <div className="my-8 flex items-center gap-3.5">
              <div className="h-px flex-1 bg-border" />
              <span className="font-mono text-xs uppercase tracking-wider text-ink-3">
                Or pick a department
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
              {DEPARTMENT_CARDS.map((rc) => {
                const selected = departmentId === rc.id;
                return (
                  <button
                    key={rc.id}
                    type="button"
                    onClick={() => {
                      setDepartmentId(rc.id);
                      if (rc.id !== "custom") startRecruiter(rc.name);
                    }}
                    className={cn(
                      "flex flex-col gap-2 rounded-[14px] border p-3.5 text-left transition hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-lg",
                      selected ? "border-accent/40 bg-accent-soft/40" : "border-border bg-surface",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted font-mono text-[11px] font-medium text-ink-2">
                        {rc.mono}
                      </div>
                      <span className="text-sm font-semibold">{rc.name}</span>
                    </div>
                    <span className="text-[12.5px] leading-snug text-ink-2">{rc.desc}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* RECRUITER */}
        {screen === "recruiter" && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid w-full max-w-[1080px] grid-cols-1 items-start gap-[18px] lg:grid-cols-[1.45fr_1fr]"
          >
            <ChatPanel
              messages={messages}
              chips={chips}
              showLocationPicker={showLocationPicker}
              rooms={rooms}
              briefReady={briefReady}
              busy={busy}
              chatInput={chatInput}
              onChatInput={setChatInput}
              onSend={sendUserMessage}
              onLocationPick={sendUserMessage}
              onReviewBrief={() => {
                setBrief((prev) =>
                  prev.mission
                    ? prev
                    : buildBriefFromRoleSeed(roleSeed, prev, departmentId),
                );
                setScreen("brief");
              }}
            />
            <BriefPreview title={brief.title || roleSeed} rows={previewRows} />
          </motion.div>
        )}

        {/* BRIEF */}
        {screen === "brief" && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid w-full max-w-[1100px] grid-cols-1 items-start gap-[18px] lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="w-full">
              <div className="mb-6 text-center lg:text-left">
                <h1 className="mb-2 text-[32px] font-semibold tracking-[-1px]">
                  Review the AI employee job brief
                </h1>
                <p className="text-[15.5px] text-ink-2">
                  This becomes the foundation for how your AI employee works, communicates, and
                  makes decisions.
                </p>
              </div>
              <BriefEditor brief={brief} editable={briefEditable} onChange={setBrief} />
              <div className="mt-[18px] flex flex-wrap justify-between gap-2.5">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={regenerateBrief}
                    disabled={busy}
                    className="flex items-center gap-2 rounded-[11px] border border-border bg-surface px-4 py-2.5 text-sm transition hover:border-ink/30"
                  >
                    <span className={cn(regenSpin && "animate-spin")}>↻</span> Regenerate brief
                  </button>
                  <button
                    type="button"
                    onClick={() => setBriefEditable((v) => !v)}
                    className={cn(
                      "rounded-[11px] border px-4 py-2.5 text-sm transition",
                      briefEditable
                        ? "border-ink bg-ink text-white"
                        : "border-border bg-surface hover:border-ink/30",
                    )}
                  >
                    {briefEditable ? "Done editing" : "Edit manually"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={generateApplicants}
                  className="rounded-[11px] bg-ink px-5 py-2.5 text-[14.5px] font-medium text-white transition hover:bg-ink/90"
                >
                  Generate applicants →
                </button>
              </div>
            </div>
            <RefinePanel
              messages={messages}
              refineInput={refineInput}
              onRefineInput={setRefineInput}
              onRefine={refineBrief}
              busy={busy}
            />
          </motion.div>
        )}

        {/* GENERATING */}
        {screen === "generating" && (
          <GeneratingScreen genStep={genStep} />
        )}

        {/* SHORTLIST */}
        {screen === "shortlist" && (
          <ShortlistScreen
            applicants={DEMO_APPLICANTS}
            advOpen={advOpen}
            onToggleAdv={(id) => setAdvOpen((s) => ({ ...s, [id]: !s[id] }))}
            onInterview={openInterview}
            onHire={pickApplicant}
            onCompare={() => setCompareOpen(true)}
          />
        )}

        {/* OFFER */}
        {screen === "offer" && (
          <OfferScreen applicant={hired} brief={brief} onBack={() => setScreen("shortlist")} onConfirm={confirmHire} />
        )}

        {/* SUCCESS */}
        {screen === "success" && (
          <SuccessScreen applicant={hired} successStep={successStep} />
        )}
      </main>

      {/* Compare modal */}
      {compareOpen && (
        <CompareModal onClose={() => setCompareOpen(false)} onHireRecommended={() => pickApplicant("eleanor")} />
      )}

      {/* Interview overlay */}
      {interviewWith && ivApplicant && (
        <InterviewOverlay
          applicant={ivApplicant}
          messages={interviewMsgs[interviewWith] ?? []}
          onClose={() => setInterviewWith(null)}
          onHire={() => pickApplicant(ivApplicant.id)}
          onAsk={askInterview}
        />
      )}
    </div>
  );
}

function ChatPanel({
  messages,
  chips,
  showLocationPicker,
  rooms,
  briefReady,
  busy,
  chatInput,
  onChatInput,
  onSend,
  onLocationPick,
  onReviewBrief,
}: {
  messages: HiringMessage[];
  chips: string[];
  showLocationPicker: boolean;
  rooms: string[];
  briefReady: boolean;
  busy: boolean;
  chatInput: string;
  onChatInput: (v: string) => void;
  onSend: (text: string) => void;
  onLocationPick: (text: string) => void;
  onReviewBrief: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-[0_1px_2px_rgba(34,31,26,0.04),0_18px_40px_-30px_rgba(34,31,26,0.2)]">
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-4">
        <AdeOrb size={32} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Ade Recruiter</div>
          <div className="text-xs text-ink-3">Recruiting manager · guiding your hire</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-[18px]">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "animate-[hireMsgIn_0.35s_ease_both]",
              m.role === "ade" ? "flex items-start gap-2" : "flex justify-end",
            )}
          >
            {m.role === "ade" && <AdeOrb size={26} />}
            <div
              className={cn(
                "max-w-[84%] px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "ade"
                  ? "rounded-[4px_14px_14px_14px] border border-border bg-muted text-ink"
                  : "rounded-[14px_14px_4px_14px] bg-ink text-white",
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <AdeOrb size={26} />
            <div className="rounded-[4px_14px_14px_14px] border border-border bg-muted px-3.5 py-2.5 text-sm text-ink-2">
              Thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border bg-muted/60 p-4">
        {!briefReady && chips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onSend(c)}
                disabled={busy}
                className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] transition hover:border-ink hover:bg-ink hover:text-white disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {showLocationPicker && (
          <select
            className="mb-3 w-full cursor-pointer rounded-[10px] border border-border bg-surface px-3 py-2.5 text-[13.5px]"
            defaultValue=""
            onChange={(e) => e.target.value && onLocationPick(e.target.value)}
          >
            <option value="">Choose a room & topic…</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        {briefReady ? (
          <button
            type="button"
            onClick={onReviewBrief}
            className="w-full rounded-xl bg-ink py-3 text-[14.5px] font-medium text-white transition hover:bg-ink/90"
          >
            Review job brief →
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend(chatInput);
            }}
            className="flex gap-2"
          >
            <input
              value={chatInput}
              onChange={(e) => onChatInput(e.target.value)}
              placeholder="Type your answer…"
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink/30"
            />
            <button
              type="submit"
              disabled={busy || !chatInput.trim()}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function BriefPreview({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <div className="sticky top-[90px] rounded-[18px] border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
          Role brief preview
        </span>
        <span className="text-[11px] text-ink-3">live</span>
      </div>
      <div className="mb-1 text-lg font-semibold leading-tight tracking-tight">{title || "—"}</div>
      <div className="mb-4 text-[13px] text-ink-2">Drafted by Ade Recruiter</div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex justify-between gap-3.5 border-t border-border py-2.5"
        >
          <span className="whitespace-nowrap text-[12.5px] text-ink-3">{r.label}</span>
          <span
            className={cn(
              "max-w-[170px] text-right text-[12.5px] font-medium",
              r.value === "—" ? "text-ink/30" : "text-ink",
            )}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function RefinePanel({
  messages,
  refineInput,
  onRefineInput,
  onRefine,
  busy,
}: {
  messages: HiringMessage[];
  refineInput: string;
  onRefineInput: (v: string) => void;
  onRefine: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex h-[min(560px,70vh)] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-4 py-3.5">
        <div className="text-sm font-semibold">Refine with Ade Recruiter</div>
        <div className="text-xs text-ink-3">Ask for changes to the brief anytime</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {messages.slice(-4).map((m, i) => (
          <div key={i} className={cn("mb-2 text-xs", m.role === "user" ? "text-ink-2" : "text-ink")}>
            <span className="font-medium">{m.role === "ade" ? "Ade" : "You"}:</span> {m.text}
          </div>
        ))}
      </div>
      <form
        className="border-t border-border bg-muted/50 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onRefine();
        }}
      >
        <textarea
          value={refineInput}
          onChange={(e) => onRefineInput(e.target.value)}
          rows={3}
          placeholder="e.g. Make the tone more conservative and add compliance review…"
          className="mb-2 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={busy || !refineInput.trim()}
          className="w-full rounded-xl bg-ink py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Update brief
        </button>
      </form>
    </div>
  );
}

function BriefEditor({
  brief,
  editable,
  onChange,
}: {
  brief: JobBrief;
  editable: boolean;
  onChange: (b: JobBrief) => void;
}) {
  const editCls = editable ? "outline outline-1 outline-dashed outline-ink/20 rounded-md px-1.5 -mx-1.5" : "";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(34,31,26,0.04),0_24px_60px_-34px_rgba(34,31,26,0.26)]">
      <div className="border-b border-border bg-gradient-to-b from-muted/80 to-surface px-7 py-6">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">Role title</div>
        {editable ? (
          <input
            value={brief.title}
            onChange={(e) => onChange({ ...brief, title: e.target.value })}
            className={cn("w-full bg-transparent text-2xl font-semibold tracking-tight", editCls)}
          />
        ) : (
          <h2 className="text-2xl font-semibold tracking-tight">{brief.title}</h2>
        )}
      </div>
      <div className="px-7 pb-6">
        <BriefSection label="Mission" editable={editable} editCls={editCls}>
          {editable ? (
            <textarea
              value={brief.mission}
              onChange={(e) => onChange({ ...brief, mission: e.target.value })}
              className="w-full resize-none bg-transparent font-serif text-lg italic leading-relaxed"
              rows={2}
            />
          ) : (
            <p className="font-serif text-lg italic leading-relaxed">{brief.mission}</p>
          )}
        </BriefSection>
        <BriefSection label="Core responsibilities" editable={editable} editCls={editCls}>
          <ul className="space-y-2">
            {brief.responsibilities.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed">
                <span className="text-ink/30">—</span>
                {editable ? (
                  <input
                    value={item}
                    onChange={(e) => {
                      const next = [...brief.responsibilities];
                      next[i] = e.target.value;
                      onChange({ ...brief, responsibilities: next });
                    }}
                    className={cn("flex-1 bg-transparent", editCls)}
                  />
                ) : (
                  <span>{item}</span>
                )}
              </li>
            ))}
          </ul>
        </BriefSection>
        {(
          [
            ["Industry context", "industryContext", false],
            ["Working style", "workingStyle", false],
            ["Communication style", "communicationStyle", false],
          ] as const
        ).map(([label, key]) => (
          <BriefSection key={key} label={label} editable={editable} editCls={editCls}>
            {editable ? (
              <textarea
                value={brief[key]}
                onChange={(e) => onChange({ ...brief, [key]: e.target.value })}
                className="w-full resize-none bg-transparent text-[14.5px] leading-relaxed"
                rows={2}
              />
            ) : (
              <p className="text-[14.5px] leading-relaxed">{brief[key]}</p>
            )}
          </BriefSection>
        ))}
        <BriefSection label="Approval rules" editable={editable} editCls={editCls}>
          <ul className="space-y-2">
            {brief.approvalRules.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px]">
                <span className="text-ink/30">—</span>
                {editable ? (
                  <input
                    value={item}
                    onChange={(e) => {
                      const next = [...brief.approvalRules];
                      next[i] = e.target.value;
                      onChange({ ...brief, approvalRules: next });
                    }}
                    className={cn("flex-1 bg-transparent", editCls)}
                  />
                ) : (
                  <span>{item}</span>
                )}
              </li>
            ))}
          </ul>
        </BriefSection>
        <BriefSection label="Success criteria" editable={editable} editCls={editCls} last>
          <ul className="space-y-2">
            {brief.successCriteria.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px]">
                <span className="text-ink/30">—</span>
                {editable ? (
                  <input
                    value={item}
                    onChange={(e) => {
                      const next = [...brief.successCriteria];
                      next[i] = e.target.value;
                      onChange({ ...brief, successCriteria: next });
                    }}
                    className={cn("flex-1 bg-transparent", editCls)}
                  />
                ) : (
                  <span>{item}</span>
                )}
              </li>
            ))}
          </ul>
        </BriefSection>
      </div>
    </div>
  );
}

function BriefSection({
  label,
  children,
  editable,
  editCls,
  last,
}: {
  label: string;
  children: React.ReactNode;
  editable: boolean;
  editCls: string;
  last?: boolean;
}) {
  void editable;
  void editCls;
  return (
    <div className={cn("border-b border-border/60 py-[18px]", last && "border-none")}>
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function GeneratingScreen({ genStep }: { genStep: number }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas p-8">
      <div className="pointer-events-none absolute left-1/2 top-[32%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(232,93,44,0.12),transparent_62%)] blur-md animate-pulse" />
      <div className="relative mb-8 text-center">
        <div className="mx-auto mb-5 h-16 w-16 animate-spin rounded-[18px] bg-[conic-gradient(from_0deg,#e85d2c,#f59e0b,#e85d2c)] shadow-lg" />
        <h1 className="mb-2.5 text-[30px] font-semibold tracking-tight">
          Finding your best AI employee candidates
        </h1>
        <p className="mx-auto max-w-[480px] text-[14.5px] text-ink-2">
          Matching candidates based on role fit, work style, intelligence mode, and weekly capacity.
        </p>
      </div>
      <div className="relative grid w-full max-w-[760px] grid-cols-1 items-start gap-8 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-2.5">
          {GEN_STEPS.map((label, i) => {
            const done = i < genStep;
            const on = i === genStep;
            return (
              <div
                key={label}
                className="flex items-center gap-3 transition-opacity"
                style={{ opacity: i <= genStep ? 1 : 0.32 }}
              >
                <div
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    done && "bg-ink text-white",
                    on && "animate-spin border-2 border-ink/20 border-t-ink",
                    !done && !on && "border border-border",
                  )}
                >
                  {done ? "✓" : ""}
                </div>
                <span
                  className={cn(
                    "text-[15px]",
                    on ? "font-semibold text-ink" : i <= genStep ? "text-ink" : "text-ink-3",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-md">
          <div className="mb-3.5 font-mono text-[11px] uppercase tracking-wider text-ink-3">
            Model matching
          </div>
          {MATCH_BARS.map((mb) => (
            <div key={mb.label} className="mb-3">
              <div className="mb-1 text-xs text-ink-2">{mb.label}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-amber transition-all duration-1000"
                  style={{ width: genStep >= GEN_STEPS.length ? `${mb.w}%` : `${Math.min(mb.w, genStep * 18)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortlistScreen({
  applicants,
  advOpen,
  onToggleAdv,
  onInterview,
  onHire,
  onCompare,
}: {
  applicants: DemoApplicant[];
  advOpen: Record<string, boolean>;
  onToggleAdv: (id: string) => void;
  onInterview: (a: DemoApplicant) => void;
  onHire: (id: string) => void;
  onCompare: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[1140px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-2 text-[32px] font-semibold tracking-tight">3 strong candidates are ready</h1>
          <p className="max-w-[560px] text-[15px] text-ink-2">
            Each candidate has a different balance of quality, speed, cost, and weekly AI work capacity.
          </p>
        </div>
        <button
          type="button"
          onClick={onCompare}
          className="whitespace-nowrap rounded-[11px] border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:border-ink"
        >
          ⇄ Compare candidates
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-[18px]">
        {applicants.map((a) => (
          <ApplicantCard
            key={a.id}
            applicant={a}
            advOpen={!!advOpen[a.id]}
            onToggleAdv={() => onToggleAdv(a.id)}
            onInterview={() => onInterview(a)}
            onHire={() => onHire(a.id)}
          />
        ))}
      </div>
      <div className="mt-5 rounded-[14px] bg-gradient-to-b from-ink to-ink/90 p-5 text-white">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-accent-soft">
          Ade&apos;s recommendation
        </div>
        <p className="text-[15px] leading-relaxed text-white/85">
          <b className="text-white">Recommended: Eleanor Price.</b> She balances professional finance
          communication, strong writing quality, and enough weekly capacity for regular outreach work.
        </p>
        <button
          type="button"
          onClick={() => onHire("eleanor")}
          className="mt-3.5 rounded-[10px] bg-white px-[18px] py-2.5 text-sm font-semibold text-ink transition hover:bg-muted"
        >
          Hire recommended candidate →
        </button>
      </div>
    </motion.div>
  );
}

function ApplicantCard({
  applicant: a,
  advOpen,
  onToggleAdv,
  onInterview,
  onHire,
}: {
  applicant: DemoApplicant;
  advOpen: boolean;
  onToggleAdv: () => void;
  onInterview: () => void;
  onHire: () => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[18px] border bg-surface p-5 transition hover:-translate-y-1 hover:shadow-xl",
        a.recommended ? "border-accent/40 shadow-[0_20px_44px_-28px_rgba(232,93,44,0.35)]" : "border-border",
      )}
    >
      {a.recommended && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-accent to-amber" />
      )}
      <div className="mb-3.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AdeOrb grad={a.grad} size={46} initials={initials(a.name)} />
          <div>
            <div className="text-[17px] font-semibold tracking-tight">{a.name}</div>
            <div className="text-[13px] text-ink-2">{a.title}</div>
          </div>
        </div>
        <span
          className={cn(
            "whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
            a.badgeKind === "rec"
              ? "bg-gradient-to-br from-accent to-amber text-white"
              : "bg-muted text-ink-2",
          )}
        >
          {a.badge}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {a.tags.map((t) => (
          <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-ink-2">
            {t}
          </span>
        ))}
      </div>
      <div className="mb-3.5 rounded-xl border border-border bg-muted/40 p-3.5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
            Weekly AI Work Hours
          </span>
          <span className="text-[13px] text-ink-2">{a.engine}</span>
        </div>
        <div className="mb-2 flex items-baseline gap-1.5">
          <span className="text-[26px] font-semibold tracking-tight">{a.hours}</span>
          <span className="text-[13px] text-ink-2">hrs / week estimated</span>
        </div>
        <div className="h-[7px] overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-ink to-ink/60 transition-all duration-700"
            style={{ width: `${Math.round(a.cap * 100)}%` }}
          />
        </div>
      </div>
      <div className="mb-4 space-y-2.5">
        {(
          [
            ["Quality", a.quality, a.qualityText],
            ["Speed", a.speed, a.speedText],
            ["Cost", a.cost, a.costText],
          ] as const
        ).map(([label, level, text]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-[46px] text-[12.5px] text-ink-2">{label}</span>
            <MetricDots level={level} />
            <span className="w-[74px] text-right text-[12.5px] font-medium">{text}</span>
          </div>
        ))}
      </div>
      <div className="mb-3">
        <div className="mb-1.5 text-[11.5px] font-semibold text-ink-3">Strengths</div>
        <ul className="space-y-1">
          {a.strengths.map((s) => (
            <li key={s} className="flex gap-2 text-[13px] leading-snug">
              <span className="text-green">+</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-3.5">
        <div className="mb-1.5 text-[11.5px] font-semibold text-ink-3">Watch-outs</div>
        <ul className="space-y-1">
          {a.weaknesses.map((w) => (
            <li key={w} className="flex gap-2 text-[13px] leading-snug text-ink-2">
              <span className="text-ink/30">–</span>
              {w}
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-3 rounded-[10px] bg-muted/50 px-3 py-2 text-[12.5px] text-ink-2">
        <span className="text-ink-3">Best for</span> · {a.bestFor}
      </div>
      <button
        type="button"
        onClick={onToggleAdv}
        className="flex w-full items-center justify-between border-t border-border pt-3 text-[12.5px] text-ink-3"
      >
        <span>Advanced engine details</span>
        <span className={cn("transition", advOpen && "rotate-180")}>⌄</span>
      </button>
      {advOpen && (
        <div className="mt-2.5 animate-[hireMsgIn_0.25s_ease_both] rounded-[10px] bg-ink p-3.5 font-mono text-xs">
          <div className="flex justify-between py-1 text-white/55">
            <span>Intelligence mode</span>
            <span className="text-white">{a.engine}</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Provider · model</span>
            <span className="text-accent-soft">{a.advModel}</span>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onInterview}
          className="flex-1 rounded-[10px] border border-border py-2.5 text-sm transition hover:border-ink"
        >
          Interview
        </button>
        <button
          type="button"
          onClick={onHire}
          className="flex-1 rounded-[10px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/90"
        >
          Hire {a.first}
        </button>
      </div>
    </div>
  );
}

function CompareModal({
  onClose,
  onHireRecommended,
}: {
  onClose: () => void;
  onHireRecommended: () => void;
}) {
  const rows = [
    ["Role fit", "Execution", "Best overall", "Strategic"],
    ["Quality", "Standard", "High", "Premium"],
    ["Speed", "Fast", "Standard", "Slower"],
    ["Weekly capacity", "120 hrs", "80 hrs", "30 hrs"],
    ["Cost intensity", "Low", "Medium", "High"],
    ["Best use case", "Volume outreach", "Day-to-day PR", "Crisis & exec"],
    ["For current plan", "Good", "Recommended", "Premium"],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-[900px] overflow-auto rounded-[20px] bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Compare candidates</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-ink-2">
              <th className="py-2 text-left font-medium" />
              <th className="py-2 text-center font-medium">Nova</th>
              <th className="py-2 text-center font-medium text-accent">Eleanor</th>
              <th className="py-2 text-center font-medium">Marcus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, ...vals]) => (
              <tr key={label} className="border-b border-border/60">
                <td className="py-2 pr-4 text-ink-2">{label}</td>
                {vals.map((v, i) => (
                  <td
                    key={v}
                    className={cn(
                      "py-2 text-center",
                      i === 1 && "rounded-lg bg-accent-soft/60 font-semibold",
                    )}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={onHireRecommended}
          className="mt-5 w-full rounded-xl bg-ink py-3 text-sm font-medium text-white"
        >
          Hire recommended candidate →
        </button>
      </div>
    </div>
  );
}

function InterviewOverlay({
  applicant: a,
  messages,
  onClose,
  onHire,
  onAsk,
}: {
  applicant: DemoApplicant;
  messages: HiringMessage[];
  onClose: () => void;
  onHire: () => void;
  onAsk: (qid: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm">
      <div className="grid h-[78vh] w-full max-w-[960px] grid-cols-1 overflow-hidden rounded-[20px] bg-surface shadow-2xl md:grid-cols-[300px_1fr]">
        <div className="flex flex-col border-b border-border bg-muted/50 p-6 md:border-b-0 md:border-r">
          <AdeOrb grad={a.grad} size={60} initials={initials(a.name)} />
          <div className="mt-4 text-[19px] font-semibold tracking-tight">{a.name}</div>
          <div className="mb-3.5 text-[13px] text-ink-2">{a.title}</div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {a.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-1 text-[11.5px] text-ink-2">
                {t}
              </span>
            ))}
          </div>
          <p className="border-t border-border pt-3.5 text-[12.5px] leading-relaxed text-ink-3">
            {a.engine} · estimated {a.hours} hrs/week capacity
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-6">
            <button type="button" onClick={onHire} className="rounded-[10px] bg-ink py-2.5 text-sm text-white">
              Hire {a.first}
            </button>
            <button type="button" onClick={onClose} className="rounded-[10px] border border-border py-2.5 text-sm">
              Back to applicants
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-border px-5 py-4 text-[13px] text-ink-3">
            Interview · {a.name}
            <span className="float-right text-ink/30">mock conversation</span>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "ade" ? "flex gap-2" : "flex justify-end"}>
                {m.role === "ade" && (
                  <AdeOrb grad={a.grad} size={40} initials={initials(a.name)} />
                )}
                <div
                  className={cn(
                    "max-w-[82%] whitespace-pre-line px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "ade"
                      ? "rounded-[4px_14px_14px_14px] border border-border bg-muted"
                      : "rounded-[14px_14px_4px_14px] bg-ink text-white",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border bg-muted/50 p-4">
            {INTERVIEW_QUESTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onAsk(q.id)}
                className="rounded-full border border-border bg-surface px-3 py-2 text-[12.5px] transition hover:border-ink"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OfferScreen({
  applicant: a,
  brief,
  onBack,
  onConfirm,
}: {
  applicant: DemoApplicant;
  brief: JobBrief;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const rows = [
    { label: "Mission", value: brief.mission, serif: true },
    { label: "Personality", value: brief.workingStyle },
    { label: "Weekly AI Work Capacity", value: `${a.hours} AI Work Hours estimated.` },
    {
      label: "Approval rules",
      value: brief.approvalRules.join(" "),
    },
    { label: "Start location", value: brief.startLocation || "Workspace channel" },
    { label: "Engine", value: `${a.engine} · Advanced: ${a.advModel}`, mono: true },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-[720px]"
    >
      <div className="mb-6 text-center">
        <AdeOrb grad={a.grad} size={76} initials={initials(a.name)} />
        <h1 className="mt-4 text-[32px] font-semibold tracking-tight">Hire {a.name}?</h1>
        <p className="text-[15px] text-ink-2">Review the offer before adding them to your workforce.</p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-md">
        {rows.map((r) => (
          <div key={r.label} className="border-b border-border/60 py-4 last:border-none">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-3">
              {r.label}
            </div>
            <p
              className={cn(
                "text-[14.5px] leading-relaxed",
                r.serif && "font-serif text-base italic",
                r.mono && "font-mono text-[13px]",
              )}
            >
              {r.value}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2.5">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-border py-3 text-sm">
          Back to applicants
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-ink py-3 text-sm font-medium text-white"
        >
          Confirm hire →
        </button>
      </div>
    </motion.div>
  );
}

function SuccessScreen({
  applicant: a,
  successStep,
}: {
  applicant: DemoApplicant;
  successStep: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-[520px] text-center"
    >
      <AdeOrb grad={a.grad} size={72} initials={initials(a.name)} />
      <h1 className="mt-5 text-[28px] font-semibold tracking-tight">{a.name} is on your team</h1>
      <p className="mt-2 text-[15px] text-ink-2">Setting up their profile and workspace access…</p>
      <div className="mt-8 text-left">
        {SUCCESS_LABELS.map((label, i) => {
          const on = i < successStep;
          return (
            <div
              key={label}
              className="flex items-center gap-2.5 border-b border-border/50 py-2 transition-opacity"
              style={{ opacity: on ? 1 : 0.4 }}
            >
              <div
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  on ? "animate-[hirePop_0.3s_ease_both] bg-green text-white" : "border border-border",
                )}
              >
                {on ? "✓" : ""}
              </div>
              <span className="text-sm">{label}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
