"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { callCandidates, callRecruiter } from "@/lib/hiring/hiring-api";
import { maybeLogBriefUpdated } from "@/lib/hiring/hire-completion";
import { useStore } from "@/lib/demo-store";
import {
  synthesizeBriefForHiringContext,
  welcomeMessage,
} from "@/lib/hiring/build-brief";
import {
  clearOnboardingDrafts,
  readOnboardingContext,
} from "@/lib/hiring/data";
import { candidateToEmployee } from "@/lib/hiring/map-candidate";
import { legacyDepartmentIdForRole, getRoleByKey } from "@/lib/hiring/role-library";
import { buildRecruiterOpeningMessage } from "@/lib/hiring/recruiter-openings";
import { normalizeRecruiterAnswer } from "@/lib/hiring/normalize-recruiter-answer";
import { inferRoleFromText, inferenceOpeningMessage } from "@/lib/hiring/role-inference";
import {
  hiringBackStep,
} from "@/lib/hiring/session";
import { useHiringSessionSync } from "@/lib/hiring/use-hiring-session-sync";
import { useHiringCandidateIntegrity } from "@/lib/hiring/use-hiring-candidate-integrity";
import {
  initialInterviewMessages,
  useCandidateInterview,
} from "@/lib/hiring/use-candidate-interview";
import {
  completeHireFromSession,
  generateCandidatesForSession,
  hiringExitWarningCopy,
  logCandidatesGeneratedForSession,
  shouldWarnBeforeHiringExit,
  type HiringSurface,
} from "@/lib/hiring/hiring-session-service";
import { ActionOnceGuard } from "@/lib/messaging/idempotency";
import { detectBriefChange, type BriefComposeSection } from "@/lib/hiring/detect-brief-change";
import {
  INITIAL_BRIEF_UPDATE_STATE,
  briefSectionToComposeKey,
  inferSectionsUpdating,
  isHiringSmallTalk,
  pickOptimisticAck,
  type BriefUpdateState,
  type MayaRecruiterState,
} from "@/lib/hiring/maya-recruiter-state";
import {
  detectRecruiterUserIntent,
  isProceedToBriefAction,
  mayaReplyForRecruiterIntent,
  mayaReplyForHiringFlowMeta,
  isHiringFlowMetaReply,
  shouldSkipBriefMutationForMessage,
} from "@/lib/hiring/recruiter-intents";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_TITLE,
  MAYA_RECRUITER_TAGLINE,
} from "@/lib/hiring/maya";
import { assessRecruiterReadiness, finalizeReadinessScore, fallbackRecruiterSuggestionChips } from "@/lib/hiring/recruiter-brain";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  CandidatesApiResponse,
  RecruiterApiResponse,
  RecruiterReadiness,
  RecruiterSuggestionChip,
  RefineMode,
} from "@/lib/hiring/types";
import type { ProjectRoom, WorkLogEvent } from "@/lib/types";
import { getGroupRooms } from "@/lib/rooms";
import { resolveUniqueRoomName } from "@/lib/room-naming";
import { resolveMayaDmRoomId } from "@/lib/maya-employee";
import { RecommendationBanner } from "@/components/hiring/RecommendationBanner";
import { cn, nowISO, uid } from "@/lib/utils";
import { BriefDocumentPreview } from "./BriefDocumentPreview";
import { BriefEditor } from "./BriefEditor";
import { TypewriterText } from "./BriefSections";
import { AdeOrb, HireExitConfirmDialog, HireHeader, HireStepper } from "./HireChrome";
import { RoleStepPanel, type RoleStepSelection } from "./RoleStepPanel";
import {
  ApplicantCard,
  AssignScreen,
  GeneratingScreen,
  InterviewOverlay,
  OfferScreen,
  SuccessScreen,
} from "./HireScreens";

type HireFlowProps = {
  onboarding?: boolean;
  entrySource?: Extract<HiringSurface, "hire_route" | "top_nav_hire_button">;
};

export function HireFlow({ onboarding = false, entrySource = "hire_route" }: HireFlowProps) {
  const { state: appState, actions, backend } = useStore();
  const router = useRouter();
  const mayaRoomId = useMemo(
    () => resolveMayaDmRoomId(appState.rooms),
    [appState.rooms],
  );
  const hiringSurface: HiringSurface = onboarding ? "onboarding" : entrySource;
  const {
    session,
    dispatch,
    sessionId,
    sessionScopeKey,
    tryClaimHireLock,
    releaseHireLock,
    completeDurableHire,
    abandonSession,
  } = useHiringSessionSync({ mayaRoomId, surface: hiringSurface });
  const { visibleCandidates, candidateContext } = useHiringCandidateIntegrity({
    session,
    sessionId,
    backend,
    dispatch,
    onStaleCleared: (note) => {
      dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: note } });
    },
  });
  const getInterviewBrief = useCallback(
    () => session.brief ?? session.briefPartial as AiEmployeeJobBrief | undefined,
    [session.brief, session.briefPartial],
  );
  const { askInterviewQuestion, interviewBusy } = useCandidateInterview({
    getBrief: getInterviewBrief,
    hiringContext: {
      workspaceId: appState.workspace?.id,
      hiringSessionId: sessionId,
      mayaRoomId,
    },
  });
  const sucTimer = useRef<ReturnType<typeof setInterval>>();
  const generateGuardRef = useRef(new ActionOnceGuard());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevBriefRef = useRef<Partial<AiEmployeeJobBrief>>();
  const lastBriefLogRef = useRef<string | null>(null);
  const composeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [briefCompose, setBriefCompose] = useState<{
    active: boolean;
    section: BriefComposeSection | null;
  }>({ active: false, section: null });
  const [mayaState, setMayaState] = useState<MayaRecruiterState>("idle");
  const [briefUpdateState, setBriefUpdateState] = useState<BriefUpdateState>(INITIAL_BRIEF_UPDATE_STATE);
  const [exitIntent, setExitIntent] = useState<"workspace" | "role" | null>(null);
  const [leavingHiring, setLeavingHiring] = useState(false);

  const roleSeed = useMemo(() => {
    if (session.roleInput.trim()) return session.roleInput.trim();
    if (session.roleKey) {
      return getRoleByKey(session.roleKey)?.title ?? session.roleKey;
    }
    return "";
  }, [session.roleInput, session.roleKey]);

  const effectiveDepartmentId = useMemo(
    () => session.departmentId ?? legacyDepartmentIdForRole(session.roleKey),
    [session.departmentId, session.roleKey],
  );

  const recruiterPayload = useCallback(
    (extra: Record<string, unknown> = {}) => ({
      roleSeed,
      selectedDepartment: effectiveDepartmentId,
      roleKey: session.roleKey,
      departmentGroupId: session.departmentGroupId,
      discoveryMode: session.discoveryMode,
      customRoleTitle: session.customRoleTitle,
      workspaceId: appState.workspace?.id ?? null,
      hiringSessionId: sessionId ?? null,
      mayaRoomId,
      ...extra,
    }),
    [
      roleSeed,
      effectiveDepartmentId,
      session.roleKey,
      session.departmentGroupId,
      session.discoveryMode,
      session.customRoleTitle,
      appState.workspace?.id,
      sessionId,
      mayaRoomId,
    ],
  );

  const recruiterTurns = session.recruiterMessages.filter((m) => m.role === "user").length;
  const previewBrief = session.briefPartial ?? session.brief;
  const displayReadiness = useMemo(() => {
    const base = session.readiness;
    const canReview = session.briefReady || base.ready;
    if (!canReview) return base;
    return finalizeReadinessScore(base, previewBrief as AiEmployeeJobBrief, true);
  }, [session.readiness, session.briefReady, previewBrief]);
  const hired =
    visibleCandidates.find((c) => c.id === session.selectedCandidateId) ??
    visibleCandidates.find((c) => c.recommended) ??
    visibleCandidates[1];
  const selectedCandidates = useMemo(() => {
    const ids =
      session.selectedCandidateIds?.length
        ? session.selectedCandidateIds
        : session.selectedCandidateId
          ? [session.selectedCandidateId]
          : hired
            ? [hired.id]
            : [];
    return visibleCandidates.filter((c) => ids.includes(c.id));
  }, [session.selectedCandidateId, session.selectedCandidateIds, visibleCandidates, hired]);
  const ivApplicant = session.interviewWith
    ? visibleCandidates.find((c) => c.id === session.interviewWith)
    : null;

  const rooms = useMemo(
    () => getGroupRooms(appState.rooms).map((r) => ({ id: r.id, name: r.name })),
    [appState.rooms],
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.recruiterMessages, session.step]);

  useEffect(() => {
    return () => {
      if (sucTimer.current) clearInterval(sucTimer.current);
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!shouldWarnBeforeHiringExit(session)) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session]);

  const clearBriefCompose = useCallback(() => {
    if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    setBriefCompose({ active: false, section: null });
  }, []);

  const triggerBriefCompose = useCallback((section: BriefComposeSection) => {
    if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    setBriefCompose({ active: true, section });
    composeTimerRef.current = setTimeout(() => {
      setBriefCompose({ active: false, section: null });
    }, 2800);
  }, []);

  const goBack = useCallback(() => {
    const prev = hiringBackStep(session.step);
    if (prev) dispatch({ type: "SET_STEP", step: prev });
  }, [session.step]);

  const requestBack = useCallback(() => {
    const prev = hiringBackStep(session.step);
    if (!prev) return;
    if (prev === "role" && shouldWarnBeforeHiringExit(session)) {
      setExitIntent("role");
      return;
    }
    goBack();
  }, [session, goBack]);

  const applyRecruiterResponse = useCallback(
    (res: RecruiterApiResponse, conversationBase?: { role: "ade" | "user"; text: string; isOptimistic?: boolean }[], appendMaya = true) => {
      const recruiterMessage = res.recruiterMessage ?? res.message;
      if (appendMaya && recruiterMessage) {
        const base =
          conversationBase ??
          session.recruiterMessages.filter((message) => !message.isOptimistic);
        dispatch({
          type: "SET_MESSAGES",
          messages: [...base, { role: "ade", text: recruiterMessage }],
        });
      }
      if (res.checklist) dispatch({ type: "SET_CHECKLIST", checklist: res.checklist });
      if (res.readiness) {
        dispatch({ type: "SET_READINESS", readiness: res.readiness });
        dispatch({
          type: "SET_BRIEF_READY",
          briefReady: Boolean(res.canReviewBrief ?? res.briefReady),
        });
      }

      const messagesForChips =
        conversationBase ??
        session.recruiterMessages.filter((message) => !message.isOptimistic);
      const chipBrief = res.brief ?? res.briefPartial ?? session.brief ?? session.briefPartial;
      const chipReadiness = res.readiness ?? session.readiness;

      if (res.suggestionChips?.length) {
        dispatch({ type: "SET_SUGGESTION_CHIPS", chips: res.suggestionChips });
      } else if (chipBrief?.roleTitle && chipReadiness && messagesForChips.length) {
        dispatch({
          type: "SET_SUGGESTION_CHIPS",
          chips: fallbackRecruiterSuggestionChips({
            conversation: messagesForChips,
            roleKey: session.roleKey,
            readiness: chipReadiness,
            brief: chipBrief,
            canReviewBrief: Boolean(res.canReviewBrief ?? res.briefReady),
          }),
        });
      }

      const nextBrief = res.brief ?? res.briefPartial;
      if (nextBrief) {
        const section = detectBriefChange(prevBriefRef.current, nextBrief);
        if (section) triggerBriefCompose(section);
        else {
          composeTimerRef.current = setTimeout(() => clearBriefCompose(), 350);
        }
        prevBriefRef.current = { ...nextBrief };
      }

      if (res.briefPartial) dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: res.briefPartial });
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
    },
    [clearBriefCompose, triggerBriefCompose, session.recruiterMessages],
  );

  const goToBrief = useCallback(() => {
    const brief =
      session.brief ??
      synthesizeBriefForHiringContext({
        roleSeed,
        messages: session.recruiterMessages,
        departmentId: effectiveDepartmentId,
        roleKey: session.roleKey,
        existing: session.briefPartial,
      });
    dispatch({ type: "SET_BRIEF", brief });
    dispatch({ type: "SET_STEP", step: "brief" });
  }, [
    roleSeed,
    session.brief,
    session.briefPartial,
    session.recruiterMessages,
    effectiveDepartmentId,
    session.roleKey,
  ]);

  const beginRecruiter = async (seed: string, opts?: { roleKey?: string | null; openingMessage?: string }) => {
    if (!seed && !opts?.roleKey && !effectiveDepartmentId) return;
    dispatch({ type: "RESET_RECRUITER" });
    dispatch({ type: "SET_ERROR", error: null });
    dispatch({ type: "SET_STEP", step: "recruiter" });

    const roleKey = opts?.roleKey ?? session.roleKey;
    const opening =
      opts?.openingMessage ??
      buildRecruiterOpeningMessage({
        roleSeed: seed,
        roleKey,
        departmentId: effectiveDepartmentId,
      });
    const localBrief = synthesizeBriefForHiringContext({
      roleSeed: seed,
      messages: [],
      departmentId: effectiveDepartmentId,
      roleKey,
    });

    dispatch({
      type: "SET_MESSAGES",
      messages: [{ role: "ade", text: opening }],
    });
    dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: localBrief });
    const openingConversation = [{ role: "ade" as const, text: opening }];
    const localReadiness = assessRecruiterReadiness(openingConversation, localBrief, session.roleKey);
    dispatch({ type: "SET_READINESS", readiness: localReadiness });
    dispatch({
      type: "SET_SUGGESTION_CHIPS",
      chips: fallbackRecruiterSuggestionChips({
        conversation: openingConversation,
        roleKey,
        readiness: localReadiness,
        brief: localBrief,
        canReviewBrief: false,
      }),
    });
    prevBriefRef.current = { ...localBrief };
    dispatch({ type: "SET_BRIEF_READY", briefReady: false });
    setBriefCompose({ active: true, section: "title" });
    composeTimerRef.current = setTimeout(() => {
      setBriefCompose({ active: false, section: null });
    }, 2600);

    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const res = await callRecruiter(
        recruiterPayload({
          roleSeed: seed,
          roleKey,
          conversation: [],
          action: "message",
        }),
      );
      const finalOpening = res.recruiterMessage ?? res.message ?? opening;
      const openingConversation = [{ role: "ade" as const, text: finalOpening }];
      if (finalOpening !== opening) {
        dispatch({ type: "SET_MESSAGES", messages: openingConversation });
      }
      applyRecruiterResponse(res, openingConversation, false);
    } catch (e) {
      dispatch({
        type: "SET_ERROR",
        error: e instanceof Error ? e.message : "Could not start recruiter.",
      });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const handleRoleStepSelect = async (selection: RoleStepSelection) => {
    if (selection.type === "role") {
      dispatch({ type: "SET_ROLE_INPUT", roleInput: selection.title });
      dispatch({
        type: "SET_ROLE_KEY",
        roleKey: selection.roleKey,
        departmentGroupId: selection.departmentGroupId,
      });
      dispatch({
        type: "SET_DEPARTMENT",
        departmentId: legacyDepartmentIdForRole(selection.roleKey),
      });
      dispatch({ type: "SET_DISCOVERY", discoveryMode: false });
      await beginRecruiter(selection.title, {
        roleKey: selection.roleKey,
        openingMessage: buildRecruiterOpeningMessage({
          roleSeed: selection.title,
          roleKey: selection.roleKey,
          departmentId: legacyDepartmentIdForRole(selection.roleKey),
        }),
      });
      return;
    }

    if (selection.type === "discovery") {
      dispatch({ type: "SET_DISCOVERY", discoveryMode: true, discoveryStep: "outcome" });
      return;
    }

    const text = selection.title;
    dispatch({ type: "SET_ROLE_INPUT", roleInput: text });
    const inference = inferRoleFromText(text);

    if (selection.custom || inference.matchType === "custom") {
      dispatch({ type: "SET_ROLE_KEY", roleKey: "custom" });
      dispatch({ type: "SET_CUSTOM_ROLE_TITLE", customRoleTitle: text });
      dispatch({ type: "SET_INFERENCE", confidence: "low", suggestedRoleKeys: inference.nearMatchAlternatives ?? [] });
      await beginRecruiter(text, {
        roleKey: "custom",
        openingMessage: inferenceOpeningMessage(text, inference),
      });
      return;
    }

    if (selection.roleKey) {
      dispatch({ type: "SET_ROLE_KEY", roleKey: selection.roleKey });
      dispatch({ type: "SET_DEPARTMENT", departmentId: legacyDepartmentIdForRole(selection.roleKey) });
      dispatch({
        type: "SET_INFERENCE",
        confidence: inference.confidence,
        suggestedRoleKeys: inference.matches.map((m) => m.roleKey),
      });
      await beginRecruiter(selection.roleKey ? getRoleByKey(selection.roleKey)?.title ?? text : text, {
        roleKey: selection.roleKey,
        openingMessage: inferenceOpeningMessage(text, inference),
      });
      return;
    }

    dispatch({
      type: "SET_INFERENCE",
      confidence: inference.confidence,
      suggestedRoleKeys: inference.matches.map((m) => m.roleKey),
    });
    await beginRecruiter(text, { openingMessage: inferenceOpeningMessage(text, inference) });
  };

  const sendUserMessage = async (text: string, action: "message" | "draft_now" | "refine_section" = "message") => {
    const trimmed = normalizeRecruiterAnswer(text);
    if (!trimmed || session.busy) return;
    dispatch({ type: "SET_ERROR", error: null });

    const isDraftNow = action === "draft_now";
    const isReview = action === "message" && trimmed === "Review job brief";
    const onBriefStep = session.step === "brief";

    if (isReview && !onBriefStep) {
      goToBrief();
      return;
    }

    if (isHiringSmallTalk(trimmed) && session.recruiterMessages.length > 0) {
      dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          role: "ade",
          text: "You're welcome — keep shaping the brief and say when you're ready to generate candidates.",
        },
      });
      return;
    }

    const userIntent = detectRecruiterUserIntent(trimmed);
    if (userIntent === "review_brief") {
      dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          role: "ade",
          text: mayaReplyForRecruiterIntent("review_brief")!,
        },
      });
      dispatch({ type: "SET_BRIEF_READY", briefReady: true });
      goToBrief();
      return;
    }

    if (userIntent === "approve_brief") {
      dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
      dispatch({
        type: "ADD_MESSAGE",
        message: {
          role: "ade",
          text: mayaReplyForRecruiterIntent("approve_brief")!,
        },
      });
      if (session.brief || session.briefPartial) {
        dispatch({ type: "SET_BRIEF_READY", briefReady: true });
        setMayaState("ready_to_review");
      }
      return;
    }

    if (isHiringFlowMetaReply(trimmed)) {
      dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "ade", text: mayaReplyForHiringFlowMeta(trimmed)! },
      });
      return;
    }

    const nextMessages = [...session.recruiterMessages, { role: "user" as const, text: trimmed }];
    const skipBriefUi = shouldSkipBriefMutationForMessage(trimmed);
    const optimisticAck = pickOptimisticAck(trimmed);
    const sectionsUpdating = skipBriefUi ? [] : inferSectionsUpdating(trimmed);
    const composeSection = briefSectionToComposeKey(sectionsUpdating[0]) ?? null;

    const existingBrief = session.brief ?? session.briefPartial;
    if (!skipBriefUi) {
      setMayaState("acknowledging");
      setBriefUpdateState({ status: "updating", sectionsUpdating });
      setBriefCompose({ active: true, section: composeSection });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = setTimeout(() => {
        setBriefCompose({ active: false, section: null });
      }, 3200);
    } else {
      setMayaState(userIntent === "generate_candidates" ? "ready_to_review" : "thinking");
    }

    dispatch({
      type: "SET_MESSAGES",
      messages: [
        ...nextMessages,
        { role: "ade", text: optimisticAck, isOptimistic: true },
      ],
    });
    dispatch({ type: "SET_BUSY", busy: true });

    try {
      setMayaState("thinking");
      const res = await callRecruiter(
        recruiterPayload({
          conversation: nextMessages,
          userMessage: trimmed,
          action: onBriefStep ? "refine_section" : isDraftNow ? "draft_now" : "message",
          currentBrief: session.brief ?? session.briefPartial,
          mode: onBriefStep ? "brief_refine" : isDraftNow ? "draft_now" : "chat",
        }),
      );
      setMayaState("updating_brief");
      const nextBrief = res.brief ?? res.briefPartial ?? existingBrief;
      const briefSection = detectBriefChange(prevBriefRef.current, nextBrief);
      if (nextBrief) {
        prevBriefRef.current = { ...nextBrief };
        dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: nextBrief });
      }
      applyRecruiterResponse(res, nextMessages);
      maybeLogBriefUpdated(
        actions,
        mayaRoomId,
        trimmed,
        briefSection,
        res.brief?.roleTitle ?? existingBrief?.roleTitle,
        lastBriefLogRef,
      );
      if (res.brief) {
        dispatch({ type: "SET_BRIEF", brief: res.brief });
      }
      if (res.canReviewBrief ?? res.briefReady) {
        dispatch({ type: "SET_BRIEF_READY", briefReady: true });
        setMayaState("ready_to_review");
      } else if (!isDraftNow) {
        dispatch({ type: "SET_BRIEF_READY", briefReady: false });
        setMayaState("idle");
      }
      if (!skipBriefUi) {
        setBriefUpdateState({
          status: "updated",
          sectionsUpdating,
          lastUpdatedAt: new Date().toISOString(),
        });
        setTimeout(() => {
          setBriefUpdateState(INITIAL_BRIEF_UPDATE_STATE);
        }, 2400);
      }
      if (userIntent === "generate_candidates") {
        generateApplicants(true);
      }
      if (isDraftNow && res.brief) {
        dispatch({ type: "SET_BRIEF_READY", briefReady: true });
      }
    } catch (e) {
      setMayaState("error");
      setBriefUpdateState({ status: "error", sectionsUpdating: [] });
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
      const res = await callRecruiter(
        recruiterPayload({
          conversation: session.recruiterMessages,
          action: "refine_section",
          currentBrief: session.brief,
          mode: "refine",
          refineSection: section,
          refineMode: mode,
          refineInstruction: instruction ?? `Refine the ${section} section`,
        }),
      );
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  };

  const regenerateBrief = async () => {
    dispatch({ type: "SET_REGEN_SPIN", spin: true });
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const res = await callRecruiter(
        recruiterPayload({
          conversation: session.recruiterMessages,
          currentBrief: session.brief,
          mode: "regenerate",
        }),
      );
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
      else if (session.brief) {
        dispatch({
          type: "SET_BRIEF",
          brief: synthesizeBriefForHiringContext({
            roleSeed,
            messages: session.recruiterMessages,
            departmentId: effectiveDepartmentId,
            roleKey: session.roleKey,
            existing: session.brief,
          }),
        });
      }
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
      setTimeout(() => dispatch({ type: "SET_REGEN_SPIN", spin: false }), 700);
    }
  };

  const generateApplicants = (force = false) => {
    if (!session.brief) return;
    if (!force && !session.readiness.ready) {
      dispatch({
        type: "SET_ERROR",
        error: "This role brief is still light. Ask one more question or choose Generate anyway.",
      });
      return;
    }
    const genKey = `gen:${sessionScopeKey}:${sessionId ?? "local"}`;
    if (generateGuardRef.current.isInFlight(genKey)) return;
    if (!force && visibleCandidates.length > 0) return;
    if (!generateGuardRef.current.tryBegin(genKey, { allowRetry: force })) return;

    const brief = session.brief;
    dispatch({ type: "SET_STEP", step: "generating_applicants" });
    dispatch({ type: "SET_GEN_STEP", genStep: 0 });

    void (async () => {
      const roleTitle = brief.roleTitle ?? roleSeed;
      try {
        const candidates = await generateCandidatesForSession({
          brief,
          departmentId: effectiveDepartmentId,
          roleKey: session.roleKey,
          sessionScopeKey,
          sessionId,
          roleTitle,
          workspaceId: appState.workspace?.id ?? null,
        });
        dispatch({ type: "SET_CANDIDATES", candidates });
        logCandidatesGeneratedForSession(actions, mayaRoomId, roleTitle);
        generateGuardRef.current.complete(genKey);
      } catch {
        generateGuardRef.current.abort(genKey);
        dispatch({
          type: "SET_ERROR",
          error: "Could not generate candidates. Please try again.",
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
      visibleCandidates.length > 0
    ) {
      dispatch({ type: "SET_STEP", step: "shortlist" });
    }
  }, [session.step, session.genStep, visibleCandidates.length]);

  const confirmHire = async () => {
    const toHire = selectedCandidates.length ? selectedCandidates : hired ? [hired] : [];
    if (!toHire.length || !session.brief || !appState.user || session.busy) return;

    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const context = onboarding ? readOnboardingContext() : null;
      const defaultRoomId =
        context?.roomId ?? appState.rooms.find((r) => r.kind === "room")?.id;

      const result = await completeHireFromSession({
        actions,
        candidate: toHire[0]!,
        candidatesToHire: toHire,
        session,
        sessionCandidates: visibleCandidates,
        ctx: candidateContext,
        brief: session.brief,
        departmentId: effectiveDepartmentId,
        roleKey: session.roleKey,
        workspaceId: appState.workspace.id || null,
        userId: appState.user.id,
        sessionId,
        existingMemory: appState.memory,
        userName: appState.user.name,
        mayaRoomId,
        tryClaimHireLock,
        releaseHireLock,
        completeDurableHire,
        onboarding: onboarding
          ? {
              defaultRoomId,
              onComplete: () => clearOnboardingDrafts(),
            }
          : undefined,
      });

      if (!result.ok) {
        dispatch({ type: "SET_ERROR", error: result.message });
        return;
      }

      dispatch({
        type: "COMPLETE_HIRE",
        employeeId: result.employeeId,
        employeeIds: result.employeeIds ?? [result.employeeId],
        dmRoomId: result.dmRoomId,
      });
      runSuccessAnimation();
      setTimeout(() => dispatch({ type: "SET_STEP", step: "assign_optional" }), 2400);
    } catch (e) {
      releaseHireLock();
      dispatch({
        type: "SET_ERROR",
        error: e instanceof Error ? e.message : "Could not complete hire.",
      });
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
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
    const hiredIds =
      session.hiredEmployeeIds?.length
        ? session.hiredEmployeeIds
        : session.hiredEmployeeId
          ? [session.hiredEmployeeId]
          : [];
    if (roomId && hiredIds[0]) {
      actions.updateEmployee(hiredIds[0], { defaultRoomId: roomId });
      actions.addEmployeeToRoom(roomId, hiredIds[0]);
    }
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

  const goToWorkspace = () => {
    if (onboarding) {
      actions.completeOnboarding();
      clearOnboardingDrafts();
    }
    router.replace("/rooms");
  };

  const requestLeaveHiring = () => {
    if (shouldWarnBeforeHiringExit(session)) {
      setExitIntent("workspace");
      return;
    }
    goToWorkspace();
  };

  const confirmLeaveHiring = async () => {
    const intent = exitIntent;
    setLeavingHiring(true);
    try {
      await abandonSession();
      setExitIntent(null);
      if (intent === "workspace") {
        goToWorkspace();
      }
    } finally {
      setLeavingHiring(false);
    }
  };

  const exitCopy = hiringExitWarningCopy(session, exitIntent ?? "workspace");

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <HireExitConfirmDialog
        open={exitIntent !== null}
        title={exitCopy.title}
        body={exitCopy.body}
        confirmLabel={exitCopy.confirmLabel}
        busy={leavingHiring}
        onConfirm={() => void confirmLeaveHiring()}
        onCancel={() => setExitIntent(null)}
      />
      <HireHeader
        onBack={hiringBackStep(session.step) ? requestBack : undefined}
        backLabel={backLabel ? `← ${backLabel}` : undefined}
        onGoToWorkspace={requestLeaveHiring}
      />
      <HireStepper step={session.step} recruiterTurns={recruiterTurns} />

      <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col items-center px-5 pb-20 pt-4">
        {session.error && (
          <div className="mb-4 w-full rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {session.error}
          </div>
        )}

        {session.step === "role" && (
          <RoleStepPanel
            roleInput={session.roleInput}
            onRoleInputChange={(value) => dispatch({ type: "SET_ROLE_INPUT", roleInput: value })}
            onSelect={handleRoleStepSelect}
            busy={session.busy}
          />
        )}

        {session.step === "recruiter" && (
          <div className="grid w-full grid-cols-1 items-start gap-5 lg:grid-cols-[1.65fr_1fr]">
            <RecruiterChat
              messages={session.recruiterMessages}
              chips={session.suggestionChips}
              readiness={displayReadiness}
              briefReady={session.briefReady || displayReadiness.ready}
              busy={session.busy}
              mayaState={mayaState}
              onSend={sendUserMessage}
              onReview={goToBrief}
            />
            <BriefDocumentPreview
              brief={previewBrief}
              composing={session.busy || briefCompose.active}
              composingSection={briefCompose.section}
              updateState={briefUpdateState}
            />
          </div>
        )}

        {session.step === "brief" && session.brief && (
          <div className="grid w-full grid-cols-1 items-start gap-[18px] lg:grid-cols-[1.2fr_0.85fr]">
            <div>
              <div className="mb-5">
                <h1 className="text-[32px] font-semibold tracking-tight">Review the AI employee job brief</h1>
                <p className="text-[15px] text-ink-2">
                  Edit the brief on the left. Chat with {MAYA_EMPLOYEE_NAME} on the right to refine it in real time.
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
                  onClick={() => generateApplicants()}
                  className="rounded-[11px] bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-sm"
                >
                  Generate applicants →
                </button>
              </div>
              {!session.readiness.ready && (
                <div className="mt-4 rounded-[14px] border border-amber/40 bg-amber/10 p-4">
                  <div className="text-sm font-semibold">This role brief is still light.</div>
                  <p className="mt-1 text-sm text-ink-2">
                    You can generate applicants now, but results may be generic.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "SET_STEP", step: "recruiter" })}
                      className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm"
                    >
                      Ask 1 more question
                    </button>
                    <button
                      type="button"
                      onClick={() => generateApplicants(true)}
                      className="rounded-[10px] bg-ink px-3.5 py-2 text-sm font-medium text-white"
                    >
                      Generate anyway
                    </button>
                  </div>
                </div>
              )}
            </div>
            <RecruiterChat
              variant="refinement"
              messages={session.recruiterMessages}
              chips={session.suggestionChips.filter((chip) => chip.intent !== "review_brief")}
              readiness={session.readiness}
              briefReady={false}
              busy={session.busy}
              mayaState={mayaState}
              onSend={sendUserMessage}
              onReview={goToBrief}
              placeholder={`Tell ${MAYA_EMPLOYEE_NAME} what to change — e.g. add compliance focus, make more senior…`}
            />
          </div>
        )}

        {session.step === "generating_applicants" && (
          <GeneratingScreen genStep={session.genStep} />
        )}

        {session.step === "shortlist" && (
          <div className="w-full">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[32px] font-semibold tracking-tight">3 candidates are ready</h1>
                <p className="max-w-[560px] text-[15px] text-ink-2">
                  Same job brief — three different working styles. Select up to 3 to hire together.
                </p>
              </div>
              {(session.selectedCandidateIds?.length ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={session.busy}
                  onClick={() =>
                    dispatch({
                      type: "SELECT_CANDIDATES",
                      ids: session.selectedCandidateIds ?? [],
                    })
                  }
                  className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
                >
                  Hire {session.selectedCandidateIds!.length} selected
                </button>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[18px]">
              {visibleCandidates.map((a) => (
                <ApplicantCard
                  key={a.id}
                  applicant={a}
                  advOpen={!!session.advOpen[a.id]}
                  onToggleAdv={() => dispatch({ type: "TOGGLE_ADV", id: a.id })}
                  selected={session.selectedCandidateIds?.includes(a.id) ?? false}
                  onToggleSelect={() => dispatch({ type: "TOGGLE_CANDIDATE_SELECT", id: a.id })}
                  onInterview={() => {
                    const cur =
                      session.interviewMsgs[a.id] ?? initialInterviewMessages(a);
                    dispatch({ type: "SET_INTERVIEW_MSGS", id: a.id, messages: cur });
                    dispatch({ type: "SET_INTERVIEW", id: a.id });
                  }}
                  onHire={() => dispatch({ type: "SELECT_CANDIDATE", id: a.id })}
                  hireDisabled={session.busy}
                />
              ))}
            </div>
            {visibleCandidates.find((c) => c.recommended) && (
              <RecommendationBanner
                candidate={visibleCandidates.find((c) => c.recommended)!}
                hireDisabled={session.busy}
                onHire={() =>
                  dispatch({
                    type: "SELECT_CANDIDATE",
                    id: visibleCandidates.find((c) => c.recommended)!.id,
                  })
                }
              />
            )}
          </div>
        )}

        {session.step === "offer" && selectedCandidates.length > 0 && session.brief && (
          <OfferScreen
            applicants={selectedCandidates}
            brief={session.brief}
            onBack={() => dispatch({ type: "SET_STEP", step: "shortlist" })}
            onConfirm={confirmHire}
          />
        )}

        {session.step === "success" && selectedCandidates.length > 0 && (
          <SuccessScreen applicants={selectedCandidates} successStep={session.successStep} />
        )}

        {session.step === "assign_optional" && (
          <AssignScreen
            rooms={rooms}
            hireCount={session.hiredEmployeeIds?.length ?? (session.hiredEmployeeId ? 1 : 0)}
            onAssignLater={() => finishAssign()}
            onAssign={(roomId) => finishAssign(roomId)}
          />
        )}
      </main>

      {session.interviewWith && ivApplicant && (
        <InterviewOverlay
          applicant={ivApplicant}
          messages={session.interviewMsgs[session.interviewWith] ?? []}
          busy={interviewBusy}
          onClose={() => dispatch({ type: "SET_INTERVIEW", id: null })}
          onHire={() => dispatch({ type: "SELECT_CANDIDATE", id: ivApplicant.id })}
          onAsk={(question) => {
            const cur = session.interviewMsgs[ivApplicant.id] ?? initialInterviewMessages(ivApplicant);
            void askInterviewQuestion(ivApplicant, question, cur, (next) => {
              dispatch({
                type: "SET_INTERVIEW_MSGS",
                id: ivApplicant.id,
                messages: next,
              });
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
  readiness,
  briefReady,
  busy,
  mayaState = "idle",
  onSend,
  onReview,
  variant = "recruiter",
  placeholder = "Type your answer…",
}: {
  messages: { role: "ade" | "user"; text: string; isOptimistic?: boolean }[];
  chips: RecruiterSuggestionChip[];
  readiness: RecruiterReadiness;
  briefReady: boolean;
  busy: boolean;
  mayaState?: MayaRecruiterState;
  onSend: (text: string, action?: "message" | "draft_now" | "refine_section") => void;
  onReview: () => void;
  variant?: "recruiter" | "refinement";
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const allChips = chips.filter((chip) => chip.intent !== "review_brief");

  const readinessLabel =
    readiness.ready ? "Ready to review" : readiness.score >= 50 ? "Almost ready" : "Understanding role…";

  const handleChip = (chip: RecruiterSuggestionChip) => {
    if (
      chip.intent === "review_brief" ||
      isProceedToBriefAction(chip.value) ||
      isProceedToBriefAction(chip.label)
    ) {
      onReview();
      return;
    }
    onSend(
      chip.value,
      chip.intent === "draft_brief_now"
        ? "draft_now"
        : chip.intent === "refine_more" ||
            chip.intent === "add_personality" ||
            chip.intent === "add_tools" ||
            chip.intent === "add_approval_rules"
          ? "message"
          : "message",
    );
  };

  const thinkingLabel =
    mayaState === "acknowledging"
      ? `${MAYA_EMPLOYEE_NAME} is updating the brief…`
      : mayaState === "updating_brief"
        ? `${MAYA_EMPLOYEE_NAME} is refining the brief…`
        : `${MAYA_EMPLOYEE_NAME} is thinking…`;

  return (
    <div className="flex h-[min(720px,calc(100vh-11rem))] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-md lg:sticky lg:top-24">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <AdeOrb size={32} initials="M" />
        <div>
          <div className="text-sm font-semibold">{MAYA_EMPLOYEE_NAME}</div>
          <div className="text-xs text-ink-3">
            {variant === "refinement"
              ? "Refine the job brief in real time"
              : `${MAYA_EMPLOYEE_TITLE} · ${MAYA_RECRUITER_TAGLINE}`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-ink-2">
            {readinessLabel} · {readiness.score}%
          </div>
          {briefReady && variant === "recruiter" && (
            <button
              type="button"
              onClick={onReview}
              disabled={busy}
              className="rounded-full bg-green px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green/90 disabled:opacity-50"
            >
              Review job brief
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
        {messages.map((m, i) => (
          <RecruiterMessageRow
            key={`${i}-${m.text.slice(0, 24)}`}
            message={m}
            index={i}
            typeOut={m.role === "ade" && i === messages.length - 1 && !m.isOptimistic}
          />
        ))}
        {busy && !messages.some((m) => m.isOptimistic) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2"
          >
            <AdeOrb size={26} initials="M" />
            <div className="rounded-[4px_14px_14px_14px] border border-border bg-muted px-3.5 py-2.5 text-sm text-ink-2">
              {thinkingLabel}
            </div>
          </motion.div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border bg-muted/40 p-4">
        {allChips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {allChips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleChip(c)}
                disabled={busy}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-[13px] disabled:opacity-50",
                  c.intent === "review_brief"
                    ? "border-green bg-green text-white hover:bg-green/90"
                    : "border-border bg-surface hover:border-ink hover:bg-ink hover:text-white",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <p className="mb-2 text-[11px] text-ink-3">{MAYA_EMPLOYEE_NAME} is updating the brief…</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend(input);
            setInput("");
          }}
          className="flex gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function RecruiterMessageRow({
  message,
  index,
  typeOut = false,
}: {
  message: { role: "ade" | "user"; text: string; isOptimistic?: boolean };
  index: number;
  typeOut?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, x: isUser ? 28 : -20, y: 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        duration: 0.32,
        delay: Math.min(index * 0.04, 0.2),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        isUser ? "flex justify-end" : "flex items-start gap-2",
        message.isOptimistic && "opacity-95",
      )}
    >
      {!isUser && <AdeOrb size={26} initials="M" />}
      <div
        className={cn(
          "max-w-[84%] px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-[14px_14px_4px_14px] bg-ink text-white shadow-[0_8px_24px_-16px_rgba(17,17,19,0.55)]"
            : "rounded-[4px_14px_14px_14px] border border-border bg-muted",
          message.isOptimistic && !isUser && "border-accent/30 bg-accent-soft/25",
        )}
      >
        {typeOut && !hasChatMarkdown(message.text) ? (
          <TypewriterText text={message.text} active speed={3} />
        ) : (
          <ChatMarkdown text={message.text} />
        )}
      </div>
    </motion.div>
  );
}

function hasChatMarkdown(text: string): boolean {
  return /\*\*[^*]+\*\*|(?:^|\s)-\s+\S/.test(text);
}

function ChatMarkdown({ text }: { text: string }) {
  const normalized = text.replace(/\s+-\s+(?=\*\*|[A-Z0-9])/g, "\n- ");
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const blocks: Array<{ type: "p"; text: string } | { type: "ul"; items: string[] }> = [];

  for (const line of lines) {
    if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") {
        last.items.push(line.slice(2).trim());
      } else {
        blocks.push({ type: "ul", items: [line.slice(2).trim()] });
      }
    } else {
      blocks.push({ type: "p", text: line });
    }
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.type === "ul" ? (
          <ul key={index} className="space-y-1 pl-1">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current opacity-45" />
                <span>{renderInlineMarkdown(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>{renderInlineMarkdown(block.text)}</p>
        ),
      )}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}
