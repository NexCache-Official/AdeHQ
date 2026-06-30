"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { authHeaders } from "@/lib/api/auth-client";
import { useStore } from "@/lib/demo-store";
import {
  synthesizeBriefFromConversation,
  welcomeMessage,
} from "@/lib/hiring/build-brief";
import {
  DEPARTMENT_CARDS,
  HIRE_EXAMPLES,
  INTERVIEW_ANSWERS,
  ONBOARDING_ROOM_KEY,
} from "@/lib/hiring/data";
import { candidateToEmployee } from "@/lib/hiring/map-candidate";
import { DEFAULT_CHIPS, shouldOfferDraftNow } from "@/lib/hiring/recruiter-checklist";
import {
  clearHiringSession,
  hiringBackStep,
  hiringReducer,
  initialHiringSession,
  persistHiringSession,
} from "@/lib/hiring/session";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  CandidatesApiResponse,
  RecruiterApiResponse,
  RefineMode,
} from "@/lib/hiring/types";
import type { ProjectRoom, WorkLogEvent } from "@/lib/types";
import { getGroupChannels } from "@/lib/rooms";
import { cn, nowISO, uid } from "@/lib/utils";
import { BriefDocumentPreview } from "./BriefDocumentPreview";
import { BriefEditor } from "./BriefEditor";
import { AdeOrb, HireHeader, HireStepper } from "./HireChrome";
import {
  ApplicantCard,
  AssignScreen,
  GeneratingScreen,
  InterviewOverlay,
  OfferScreen,
  SuccessScreen,
} from "./HireScreens";

type HireFlowProps = { onboarding?: boolean };

async function callRecruiter(payload: Record<string, unknown>): Promise<RecruiterApiResponse> {
  const headers = await authHeaders();
  const res = await fetch("/api/hiring/recruiter", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Recruiter unavailable");
  }
  return res.json();
}

async function callCandidates(brief: AiEmployeeJobBrief, departmentId: string | null) {
  const headers = await authHeaders();
  const res = await fetch("/api/hiring/candidates", {
    method: "POST",
    headers,
    body: JSON.stringify({ brief, departmentId }),
  });
  if (!res.ok) throw new Error("Could not generate candidates");
  return res.json() as Promise<CandidatesApiResponse>;
}

export function HireFlow({ onboarding = false }: HireFlowProps) {
  const { state: appState, actions } = useStore();
  const router = useRouter();
  const [session, dispatch] = useReducer(hiringReducer, undefined, initialHiringSession);
  const sucTimer = useRef<ReturnType<typeof setInterval>>();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const roleSeed = useMemo(() => {
    if (session.roleInput.trim()) return session.roleInput.trim();
    const dept = DEPARTMENT_CARDS.find((d) => d.id === session.departmentId);
    return dept && dept.id !== "custom" ? dept.name : "";
  }, [session.roleInput, session.departmentId]);

  const recruiterTurns = session.recruiterMessages.filter((m) => m.role === "user").length;
  const previewBrief = session.briefPartial ?? session.brief;
  const hired =
    session.candidates.find((c) => c.id === session.selectedCandidateId) ??
    session.candidates.find((c) => c.recommended) ??
    session.candidates[1];
  const ivApplicant = session.interviewWith
    ? session.candidates.find((c) => c.id === session.interviewWith)
    : null;

  const channels = useMemo(
    () => getGroupChannels(appState.rooms).map((r) => ({ id: r.id, name: r.name })),
    [appState.rooms],
  );

  useEffect(() => {
    persistHiringSession(session);
  }, [session]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.recruiterMessages, session.step]);

  useEffect(() => {
    return () => {
      if (sucTimer.current) clearInterval(sucTimer.current);
    };
  }, []);

  const goBack = useCallback(() => {
    const prev = hiringBackStep(session.step);
    if (prev) dispatch({ type: "SET_STEP", step: prev });
  }, [session.step]);

  const applyRecruiterResponse = useCallback((res: RecruiterApiResponse, appendAde = true) => {
    if (appendAde && res.message) {
      dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: res.message } });
    }
    if (res.checklist) dispatch({ type: "SET_CHECKLIST", checklist: res.checklist });
    if (res.briefPartial) dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: res.briefPartial });
    if (res.brief) {
      dispatch({ type: "SET_BRIEF", brief: res.brief });
      dispatch({ type: "SET_BRIEF_READY", briefReady: true });
    } else {
      dispatch({ type: "SET_BRIEF_READY", briefReady: res.briefReady });
    }
  }, []);

  const startRecruiter = async (seed?: string) => {
    const nextSeed = seed ?? roleSeed;
    if (!nextSeed && !session.departmentId) return;
    dispatch({ type: "SET_ERROR", error: null });
    dispatch({ type: "SET_STEP", step: "recruiter" });
    dispatch({ type: "SET_MESSAGES", messages: [] });
    dispatch({ type: "SET_BRIEF_READY", briefReady: false });
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const res = await callRecruiter({
        roleSeed: nextSeed,
        departmentId: session.departmentId,
        messages: [],
      });
      dispatch({ type: "SET_MESSAGES", messages: [{ role: "ade", text: res.message }] });
      applyRecruiterResponse(res, false);
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        error: e instanceof Error ? e.message : "Could not start recruiter.",
      });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const sendUserMessage = async (text: string, mode?: string) => {
    const trimmed = text.trim();
    if (!trimmed || session.busy) return;
    dispatch({ type: "SET_ERROR", error: null });

    const isDraftNow = trimmed === DEFAULT_CHIPS.draftNow;
    const isReview = trimmed === DEFAULT_CHIPS.reviewBrief;

    const nextMessages = [...session.recruiterMessages, { role: "user" as const, text: trimmed }];
    dispatch({ type: "SET_MESSAGES", messages: nextMessages });
    dispatch({ type: "SET_BUSY", busy: true });

    try {
      if (isReview && session.brief) {
        dispatch({ type: "SET_STEP", step: "brief" });
        return;
      }

      const res = await callRecruiter({
        roleSeed,
        departmentId: session.departmentId,
        messages: nextMessages,
        currentBrief: session.brief,
        mode: isDraftNow || trimmed === DEFAULT_CHIPS.draftNow ? "draft_now" : mode ?? "chat",
      });
      applyRecruiterResponse(res);
      if (res.briefReady && res.brief) {
        dispatch({ type: "SET_BRIEF", brief: res.brief });
      }
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        error: e instanceof Error ? e.message : "Message failed.",
      });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const refineBrief = async (
    section: string,
    mode: RefineMode,
    instruction?: string,
  ) => {
    if (!session.brief) return;
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const res = await callRecruiter({
        roleSeed,
        departmentId: session.departmentId,
        messages: session.recruiterMessages,
        currentBrief: session.brief,
        mode: "refine",
        refineSection: section,
        refineMode: mode,
        refineInstruction: instruction ?? `Refine the ${section} section`,
      });
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const regenerateBrief = async () => {
    dispatch({ type: "SET_REGEN_SPIN", spin: true });
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const res = await callRecruiter({
        roleSeed,
        departmentId: session.departmentId,
        messages: session.recruiterMessages,
        currentBrief: session.brief,
        mode: "regenerate",
      });
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
      else if (session.brief) {
        dispatch({
          type: "SET_BRIEF",
          brief: synthesizeBriefFromConversation(
            roleSeed,
            session.recruiterMessages,
            session.departmentId,
            session.brief,
          ),
        });
      }
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
      setTimeout(() => dispatch({ type: "SET_REGEN_SPIN", spin: false }), 700);
    }
  };

  const generateApplicants = () => {
    if (!session.brief) return;
    const brief = session.brief;
    dispatch({ type: "SET_STEP", step: "generating_applicants" });
    dispatch({ type: "SET_GEN_STEP", genStep: 0 });

    void (async () => {
      try {
        const { candidates } = await callCandidates(brief, session.departmentId);
        dispatch({ type: "SET_CANDIDATES", candidates });
      } catch {
        const { generateDeterministicCandidates } = await import("@/lib/hiring/candidate-engine");
        dispatch({
          type: "SET_CANDIDATES",
          candidates: generateDeterministicCandidates(brief, session.departmentId),
        });
      }
    })();
  };

  const genStepRef = useRef(0);

  useEffect(() => {
    if (session.step !== "generating_applicants") return;
    genStepRef.current = 0;
    dispatch({ type: "SET_GEN_STEP", genStep: 0 });
    const timer = setInterval(() => {
      genStepRef.current = Math.min(genStepRef.current + 1, 6);
      dispatch({ type: "SET_GEN_STEP", genStep: genStepRef.current });
    }, 620);
    return () => clearInterval(timer);
  }, [session.step]);

  useEffect(() => {
    if (
      session.step === "generating_applicants" &&
      session.genStep >= 6 &&
      session.candidates.length > 0
    ) {
      dispatch({ type: "SET_STEP", step: "shortlist" });
    }
  }, [session.step, session.genStep, session.candidates.length]);

  const confirmHire = async () => {
    if (!hired || !session.brief || !appState.user) return;
    const employee = candidateToEmployee(hired, session.brief, session.departmentId);
    employee.id = uid("emp");

    try {
      if (onboarding) {
        const draftRaw = sessionStorage.getItem(ONBOARDING_ROOM_KEY);
        let room: ProjectRoom;
        if (draftRaw) {
          const draft = JSON.parse(draftRaw);
          const timestamp = nowISO();
          room = {
            id: uid("room"),
            name: draft.name,
            kind: "channel",
            description: `${draft.name} workspace channel`,
            brief: session.brief.mission,
            humans: [appState.user.id],
            aiEmployees: [],
            accent: draft.accent,
            messages: [
              {
                id: uid("msg"),
                roomId: "",
                senderType: "system",
                senderId: "system",
                senderName: "AdeHQ",
                content: `Welcome to ${draft.name}.`,
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
        } else {
          room = {
            id: uid("room"),
            name: "General",
            kind: "channel",
            description: "General workspace channel",
            brief: session.brief.mission,
            humans: [appState.user.id],
            aiEmployees: [],
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

        await actions.finishOnboarding({
          workspaceName: appState.workspace.name,
          employee,
          room,
          workLog,
        });
        sessionStorage.removeItem(ONBOARDING_ROOM_KEY);
      } else {
        actions.hireEmployee(employee);
      }

      const dm = actions.openOrCreateDM(employee.id);
      const firstName = appState.user.name?.split(" ")[0] ?? "there";
      actions.addMessage(dm.id, {
        senderType: "ai",
        senderId: employee.id,
        senderName: employee.name,
        content: welcomeMessage(employee.name, hired.title, firstName, session.brief),
      });

      dispatch({ type: "COMPLETE_HIRE", employeeId: employee.id, dmRoomId: dm.id });
      runSuccessAnimation();
      setTimeout(() => dispatch({ type: "SET_STEP", step: "assign_optional" }), 2400);
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        error: e instanceof Error ? e.message : "Could not complete hire.",
      });
    }
  };

  const runSuccessAnimation = () => {
    dispatch({ type: "SET_SUCCESS_STEP", successStep: 0 });
    if (sucTimer.current) clearInterval(sucTimer.current);
    let step = 0;
    sucTimer.current = setInterval(() => {
      step += 1;
      dispatch({ type: "SET_SUCCESS_STEP", successStep: step });
      if (step >= 6 && sucTimer.current) clearInterval(sucTimer.current);
    }, 380);
  };

  const finishAssign = (roomId?: string) => {
    if (roomId && session.hiredEmployeeId) {
      actions.updateEmployee(session.hiredEmployeeId, { defaultRoomId: roomId });
      actions.addEmployeeToRoom(roomId, session.hiredEmployeeId);
    }
    clearHiringSession();
    router.replace(session.dmRoomId ? `/rooms/${session.dmRoomId}` : "/workforce");
  };

  const backLabel =
    session.step === "recruiter"
      ? "Role"
      : session.step === "brief"
        ? "Recruiter"
        : session.step === "shortlist"
          ? "Brief"
          : session.step === "offer"
            ? "Applicants"
            : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <HireHeader
        onBack={hiringBackStep(session.step) ? goBack : undefined}
        backLabel={backLabel ? `← ${backLabel}` : undefined}
      />
      <HireStepper step={session.step} recruiterTurns={recruiterTurns} />

      <main className="mx-auto flex w-full max-w-[1140px] flex-1 flex-col items-center px-5 pb-20 pt-4">
        {session.error && (
          <div className="mb-4 w-full rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {session.error}
          </div>
        )}

        {session.step === "role" && (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[920px]">
            <div className="mb-8 mt-2 text-center">
              <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-green" />
                Your AI workforce, hired like real teammates
              </div>
              <h1 className="mb-3 text-[42px] font-semibold leading-[1.04] tracking-[-1.6px]">
                Who do you want to hire?
              </h1>
              <p className="mx-auto max-w-[560px] text-[17px] leading-relaxed text-ink-2">
                Describe the role. Ade Recruiter will ask only what&apos;s missing, draft a job brief,
                and shortlist three candidates.
              </p>
            </div>
            <div className="rounded-[18px] border border-border bg-surface p-2 shadow-md">
              <div className="flex flex-wrap items-center gap-2.5 px-4 py-1.5 sm:flex-nowrap">
                <span className="whitespace-nowrap text-base text-ink-3">I need someone who can…</span>
                <input
                  value={session.roleInput}
                  onChange={(e) => dispatch({ type: "SET_ROLE_INPUT", roleInput: e.target.value })}
                  placeholder="optimize enterprise AI performance"
                  className="min-w-0 flex-1 border-none bg-transparent py-2.5 text-base outline-none"
                  onKeyDown={(e) => e.key === "Enter" && startRecruiter()}
                />
                <button
                  type="button"
                  onClick={() => startRecruiter()}
                  disabled={!session.roleInput.trim() && !session.departmentId}
                  className="whitespace-nowrap rounded-xl bg-ink px-5 py-3.5 text-sm font-medium text-white shadow-sm hover:bg-ink/90 disabled:opacity-40"
                >
                  Continue with Ade Recruiter →
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {HIRE_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => dispatch({ type: "SET_ROLE_INPUT", roleInput: ex })}
                  className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] text-ink-2 hover:border-ink/30"
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
              {DEPARTMENT_CARDS.map((rc) => (
                <button
                  key={rc.id}
                  type="button"
                  onClick={() => {
                    dispatch({ type: "SET_DEPARTMENT", departmentId: rc.id });
                    if (rc.id !== "custom") startRecruiter(rc.name);
                  }}
                  className={cn(
                    "flex flex-col gap-2 rounded-[14px] border p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                    session.departmentId === rc.id
                      ? "border-accent/40 bg-accent-soft/30"
                      : "border-border bg-surface",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted font-mono text-[11px]">
                      {rc.mono}
                    </div>
                    <span className="text-sm font-semibold">{rc.name}</span>
                  </div>
                  <span className="text-[12.5px] text-ink-2">{rc.desc}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {session.step === "recruiter" && (
          <div className="grid w-full grid-cols-1 items-start gap-[18px] lg:grid-cols-[1.45fr_1fr]">
            <RecruiterChat
              messages={session.recruiterMessages}
              chips={
                session.briefReady
                  ? [DEFAULT_CHIPS.reviewBrief]
                  : [
                      ...(shouldOfferDraftNow(
                        session.recruiterMessages,
                        roleSeed,
                        session.checklist,
                      )
                        ? [DEFAULT_CHIPS.draftNow]
                        : []),
                      ...(recruiterTurns >= 1 ? [DEFAULT_CHIPS.refineMore] : []),
                    ]
              }
              briefReady={session.briefReady}
              busy={session.busy}
              onSend={sendUserMessage}
              onReview={() => dispatch({ type: "SET_STEP", step: "brief" })}
            />
            <BriefDocumentPreview brief={previewBrief} />
          </div>
        )}

        {session.step === "brief" && session.brief && (
          <div className="grid w-full grid-cols-1 items-start gap-[18px] lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="mb-5">
                <h1 className="text-[32px] font-semibold tracking-tight">Review the AI employee job brief</h1>
                <p className="text-[15px] text-ink-2">
                  Edit anything, then generate three candidate applicants.
                </p>
              </div>
              <BriefEditor
                brief={session.brief}
                editable={session.briefEditable}
                onChange={(b) => dispatch({ type: "SET_BRIEF", brief: b })}
                onRefineSection={refineBrief}
                busy={session.busy}
              />
              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={regenerateBrief}
                    className="rounded-[11px] border border-border px-4 py-2.5 text-sm"
                  >
                    <span className={cn(session.regenSpin && "inline-block animate-spin")}>↻</span> Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: "SET_BRIEF_EDITABLE", editable: !session.briefEditable })
                    }
                    className={cn(
                      "rounded-[11px] border px-4 py-2.5 text-sm",
                      session.briefEditable ? "border-ink bg-ink text-white" : "border-border",
                    )}
                  >
                    {session.briefEditable ? "Done editing" : "Edit manually"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={generateApplicants}
                  className="rounded-[11px] bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-sm"
                >
                  Generate applicants →
                </button>
              </div>
            </div>
            <BriefDocumentPreview brief={session.brief} live={false} />
          </div>
        )}

        {session.step === "generating_applicants" && (
          <GeneratingScreen genStep={session.genStep} />
        )}

        {session.step === "shortlist" && (
          <div className="w-full">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[32px] font-semibold tracking-tight">3 strong candidates are ready</h1>
                <p className="max-w-[560px] text-[15px] text-ink-2">
                  Each balances quality, speed, cost, and weekly AI work capacity differently.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[18px]">
              {session.candidates.map((a) => (
                <ApplicantCard
                  key={a.id}
                  applicant={a}
                  advOpen={!!session.advOpen[a.id]}
                  onToggleAdv={() => dispatch({ type: "TOGGLE_ADV", id: a.id })}
                  onInterview={() => {
                    const cur = session.interviewMsgs[a.id] ?? [
                      {
                        role: "ade",
                        text: `Hi — I'm ${a.name}. Ask me anything about how I'd work with you.`,
                      },
                    ];
                    dispatch({ type: "SET_INTERVIEW_MSGS", id: a.id, messages: cur });
                    dispatch({ type: "SET_INTERVIEW", id: a.id });
                  }}
                  onHire={() => dispatch({ type: "SELECT_CANDIDATE", id: a.id })}
                />
              ))}
            </div>
            {session.candidates.find((c) => c.recommended) && (
              <div className="mt-5 rounded-[14px] bg-gradient-to-b from-ink to-ink/90 p-5 text-white">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-accent-soft">
                  Ade&apos;s recommendation
                </div>
                <p className="text-[15px] leading-relaxed text-white/85">
                  <b className="text-white">
                    Recommended: {session.candidates.find((c) => c.recommended)?.name}.
                  </b>{" "}
                  {session.candidates.find((c) => c.recommended)?.whyThisCandidate}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SELECT_CANDIDATE",
                      id: session.candidates.find((c) => c.recommended)!.id,
                    })
                  }
                  className="mt-3 rounded-[10px] bg-white px-5 py-2.5 text-sm font-semibold text-ink"
                >
                  Hire recommended candidate →
                </button>
              </div>
            )}
          </div>
        )}

        {session.step === "offer" && hired && session.brief && (
          <OfferScreen
            applicant={hired}
            brief={session.brief}
            onBack={() => dispatch({ type: "SET_STEP", step: "shortlist" })}
            onConfirm={confirmHire}
          />
        )}

        {session.step === "success" && hired && (
          <SuccessScreen applicant={hired} successStep={session.successStep} />
        )}

        {session.step === "assign_optional" && (
          <AssignScreen
            rooms={channels}
            onAssignLater={() => finishAssign()}
            onAssign={(roomId) => finishAssign(roomId)}
          />
        )}
      </main>

      {session.interviewWith && ivApplicant && (
        <InterviewOverlay
          applicant={ivApplicant}
          messages={session.interviewMsgs[session.interviewWith] ?? []}
          onClose={() => dispatch({ type: "SET_INTERVIEW", id: null })}
          onHire={() => dispatch({ type: "SELECT_CANDIDATE", id: ivApplicant.id })}
          onAsk={(qid) => {
            const q = INTERVIEW_ANSWERS[ivApplicant.id]?.[qid];
            const label =
              qid === "week"
                ? "What would your first week look like?"
                : qid;
            const answer =
              q ??
              "That's a great question — I'd tailor my approach to your goals and check in before anything goes external.";
            const cur = session.interviewMsgs[ivApplicant.id] ?? [];
            dispatch({
              type: "SET_INTERVIEW_MSGS",
              id: ivApplicant.id,
              messages: [
                ...cur,
                { role: "user", text: label },
                { role: "ade", text: answer },
              ],
            });
          }}
        />
      )}
    </div>
  );
}

function RecruiterChat({
  messages,
  chips,
  briefReady,
  busy,
  onSend,
  onReview,
}: {
  messages: { role: "ade" | "user"; text: string }[];
  chips: string[];
  briefReady: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onReview: () => void;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-md">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <AdeOrb size={32} />
        <div>
          <div className="text-sm font-semibold">Ade Recruiter</div>
          <div className="text-xs text-ink-3">Recruiting manager · guiding your hire</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
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
                  ? "rounded-[4px_14px_14px_14px] border border-border bg-muted"
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
      <div className="border-t border-border bg-muted/40 p-4">
        {!briefReady && chips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onSend(c)}
                disabled={busy}
                className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] hover:border-ink hover:bg-ink hover:text-white disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {briefReady ? (
          <button
            type="button"
            onClick={onReview}
            className="w-full rounded-xl bg-ink py-3 text-sm font-medium text-white"
          >
            Review job brief →
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend(input);
              setInput("");
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your answer…"
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
