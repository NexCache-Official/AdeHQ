"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { synthesizeBriefForHiringContext } from "@/lib/hiring/build-brief";
import { detectBriefChange, type BriefComposeSection } from "@/lib/hiring/detect-brief-change";
import {
  completeHireFromCandidate,
  logCandidatesGenerated,
  maybeLogBriefUpdated,
} from "@/lib/hiring/hire-completion";
import { callCandidates, callRecruiter } from "@/lib/hiring/hiring-api";
import {
  INITIAL_BRIEF_UPDATE_STATE,
  briefSectionToComposeKey,
  inferSectionsUpdating,
  isHiringSmallTalk,
  pickOptimisticAck,
  type BriefUpdateState,
  type MayaRecruiterState,
} from "@/lib/hiring/maya-recruiter-state";
import { buildRecruiterOpeningMessage } from "@/lib/hiring/recruiter-openings";
import {
  assessRecruiterReadiness,
  finalizeReadinessScore,
  generateSuggestionChips,
} from "@/lib/hiring/recruiter-brain";
import { inferRoleFromText, inferenceOpeningMessage } from "@/lib/hiring/role-inference";
import { getRoleByKey, legacyDepartmentIdForRole } from "@/lib/hiring/role-library";
import {
  hiringReducer,
  initialHiringSession,
  loadHiringSession,
  persistHiringSession,
  clearHiringSession,
  normalizeRestoredHiringSession,
} from "@/lib/hiring/session";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  RecruiterApiResponse,
  RecruiterSuggestionChip,
} from "@/lib/hiring/types";

type UseMayaDmHiringOptions = {
  mayaRoomId: string;
  mayaTopicId?: string;
};

function mayaDmInitialSession() {
  const saved = loadHiringSession({ dmFirst: true });
  if (saved) return normalizeRestoredHiringSession({ ...saved, step: saved.step === "role" ? "recruiter" : saved.step }, { dmFirst: true });
  return { ...initialHiringSession(), step: "recruiter" as const };
}

export function useMayaDmHiring({ mayaRoomId, mayaTopicId }: UseMayaDmHiringOptions) {
  const { state: appState, actions } = useStore();
  const router = useRouter();
  const [session, dispatch] = useReducer(hiringReducer, null, mayaDmInitialSession);

  const [mayaState, setMayaState] = useState<MayaRecruiterState>("idle");
  const [briefUpdateState, setBriefUpdateState] = useState<BriefUpdateState>(INITIAL_BRIEF_UPDATE_STATE);
  const [briefCompose, setBriefCompose] = useState<{
    active: boolean;
    section: BriefComposeSection | null;
  }>({ active: false, section: null });
  const [generatingCandidates, setGeneratingCandidates] = useState(false);

  const prevBriefRef = useRef<Partial<AiEmployeeJobBrief>>();
  const composeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastBriefLogRef = useRef<string | null>(null);

  const roleSeed = useMemo(() => {
    if (session.roleInput.trim()) return session.roleInput.trim();
    if (session.roleKey) return getRoleByKey(session.roleKey)?.title ?? session.roleKey;
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
      ...extra,
    }),
    [
      roleSeed,
      effectiveDepartmentId,
      session.roleKey,
      session.departmentGroupId,
      session.discoveryMode,
      session.customRoleTitle,
    ],
  );

  const previewBrief = session.briefPartial ?? session.brief;
  const displayReadiness = useMemo(() => {
    const base = session.readiness;
    const canReview = session.briefReady || base.ready;
    if (!canReview) return base;
    return finalizeReadinessScore(base, previewBrief as AiEmployeeJobBrief, true);
  }, [session.readiness, session.briefReady, previewBrief]);

  const syncMessageToRoom = useCallback(
    (role: "human" | "ai", text: string) => {
      const userId = appState.user?.id ?? "user";
      actions.addMessage(mayaRoomId, {
        senderType: role === "human" ? "human" : "ai",
        senderId: role === "human" ? userId : "emp-maya",
        senderName: role === "human" ? (appState.user?.name ?? "You") : "Maya",
        content: text,
        topicId: mayaTopicId,
      });
    },
    [actions, appState.user, mayaRoomId, mayaTopicId],
  );

  useEffect(() => {
    persistHiringSession(session);
  }, [session]);

  useEffect(() => {
    return () => {
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    };
  }, []);

  const applyRecruiterResponse = useCallback(
    (
      res: RecruiterApiResponse,
      conversationBase?: { role: "ade" | "user"; text: string; isOptimistic?: boolean }[],
      appendMaya = true,
    ) => {
      const recruiterMessage = res.recruiterMessage ?? res.message;
      if (appendMaya && recruiterMessage) {
        const base =
          conversationBase ?? session.recruiterMessages.filter((m) => !m.isOptimistic);
        dispatch({
          type: "SET_MESSAGES",
          messages: [...base, { role: "ade", text: recruiterMessage }],
        });
        syncMessageToRoom("ai", recruiterMessage);
      }
      if (res.checklist) dispatch({ type: "SET_CHECKLIST", checklist: res.checklist });
      if (res.readiness) dispatch({ type: "SET_READINESS", readiness: res.readiness });
      if (res.suggestionChips) {
        dispatch({ type: "SET_SUGGESTION_CHIPS", chips: res.suggestionChips });
      }

      const nextBrief = res.brief ?? res.briefPartial;
      if (nextBrief) {
        const section = detectBriefChange(prevBriefRef.current, nextBrief);
        if (section) {
          setBriefCompose({ active: true, section });
          composeTimerRef.current = setTimeout(() => {
            setBriefCompose({ active: false, section: null });
          }, 2800);
        }
        prevBriefRef.current = { ...nextBrief };
      }

      if (res.briefPartial) dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: res.briefPartial });
      if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
    },
    [session.recruiterMessages, syncMessageToRoom],
  );

  const beginRecruiter = useCallback(
    async (seed: string, opts?: { roleKey?: string | null; openingMessage?: string }) => {
      const roleKey = opts?.roleKey ?? session.roleKey;
      const opening =
        opts?.openingMessage ??
        buildRecruiterOpeningMessage({
          roleSeed: seed,
          roleKey,
          departmentId: effectiveDepartmentId,
        });

      dispatch({ type: "SET_STEP", step: "recruiter" });
      const localBrief = synthesizeBriefForHiringContext({
        roleSeed: seed,
        messages: [],
        departmentId: effectiveDepartmentId,
        roleKey,
      });

      dispatch({ type: "SET_MESSAGES", messages: [{ role: "ade", text: opening }] });
      syncMessageToRoom("ai", opening);
      dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: localBrief });
      const openingConversation = [{ role: "ade" as const, text: opening }];
      const localReadiness = assessRecruiterReadiness(openingConversation, localBrief);
      dispatch({ type: "SET_READINESS", readiness: localReadiness });
      dispatch({
        type: "SET_SUGGESTION_CHIPS",
        chips: generateSuggestionChips(localReadiness, localBrief, openingConversation, roleKey),
      });
      prevBriefRef.current = { ...localBrief };
      dispatch({ type: "SET_BRIEF_READY", briefReady: false });

      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const res = await callRecruiter(
          recruiterPayload({ roleSeed: seed, roleKey, conversation: [], action: "message" }),
        );
        const finalOpening = res.recruiterMessage ?? res.message ?? opening;
        if (finalOpening !== opening) {
          dispatch({ type: "SET_MESSAGES", messages: [{ role: "ade", text: finalOpening }] });
        }
        applyRecruiterResponse(res, undefined, false);
      } catch (e) {
        dispatch({
          type: "SET_ERROR",
          error: e instanceof Error ? e.message : "Could not start recruiter.",
        });
      } finally {
        dispatch({ type: "SET_BUSY", busy: false });
      }
    },
    [applyRecruiterResponse, effectiveDepartmentId, recruiterPayload, session.roleKey, syncMessageToRoom],
  );

  const startFromUserText = useCallback(
    async (text: string) => {
      dispatch({ type: "SET_ROLE_INPUT", roleInput: text });
      const inference = inferRoleFromText(text);

      if (inference.matches[0]?.roleKey) {
        const match = inference.matches[0];
        dispatch({ type: "SET_ROLE_KEY", roleKey: match.roleKey });
        dispatch({ type: "SET_DEPARTMENT", departmentId: legacyDepartmentIdForRole(match.roleKey) });
        dispatch({
          type: "SET_INFERENCE",
          confidence: inference.confidence,
          suggestedRoleKeys: inference.matches.map((m) => m.roleKey),
        });
        await beginRecruiter(match.title, {
          roleKey: match.roleKey,
          openingMessage: inferenceOpeningMessage(text, inference),
        });
        return;
      }

      dispatch({ type: "SET_ROLE_KEY", roleKey: "custom" });
      dispatch({ type: "SET_CUSTOM_ROLE_TITLE", customRoleTitle: text });
      await beginRecruiter(text, {
        roleKey: "custom",
        openingMessage: inferenceOpeningMessage(text, inference),
      });
    },
    [beginRecruiter],
  );

  const generateCandidates = useCallback(async () => {
    const brief =
      session.brief ??
      synthesizeBriefForHiringContext({
        roleSeed,
        messages: session.recruiterMessages,
        departmentId: effectiveDepartmentId,
        roleKey: session.roleKey,
        existing: session.briefPartial,
      });
    if (!brief.roleTitle && !roleSeed) return;

    dispatch({ type: "SET_BRIEF", brief });
    setGeneratingCandidates(true);
    dispatch({ type: "SET_BUSY", busy: true });

    try {
      let candidates;
      try {
        const res = await callCandidates(brief, effectiveDepartmentId, session.roleKey);
        candidates = res.candidates;
      } catch {
        const { generateDeterministicCandidates } = await import("@/lib/hiring/candidate-engine");
        candidates = generateDeterministicCandidates(brief, effectiveDepartmentId, session.roleKey);
      }
      dispatch({ type: "SET_CANDIDATES", candidates });
      dispatch({ type: "SET_STEP", step: "shortlist" });
      logCandidatesGenerated(actions, mayaRoomId, brief.roleTitle ?? roleSeed);

      const mayaNote = `I've prepared 3 candidates for ${brief.roleTitle ?? roleSeed}. Review them in the panel on the right — I'd start with the recommended option.`;
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "ade", text: mayaNote },
      });
      syncMessageToRoom("ai", mayaNote);
    } finally {
      setGeneratingCandidates(false);
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }, [
    actions,
    effectiveDepartmentId,
    mayaRoomId,
    roleSeed,
    session.brief,
    session.briefPartial,
    session.recruiterMessages,
    session.roleKey,
    syncMessageToRoom,
  ]);

  const hireCandidate = useCallback(
    async (candidate: AiEmployeeApplicant) => {
      const brief = session.brief;
      if (!brief) return;
      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const { employeeId, dmRoomId } = completeHireFromCandidate({
          actions,
          userName: appState.user?.name,
          candidate,
          brief,
          departmentId: effectiveDepartmentId,
          roleKey: session.roleKey,
          mayaRoomId,
          mayaTopicId,
        });
        dispatch({ type: "COMPLETE_HIRE", employeeId, dmRoomId });
        clearHiringSession();
        router.push(`/rooms/${dmRoomId}`);
      } catch (e) {
        dispatch({
          type: "SET_ERROR",
          error: e instanceof Error ? e.message : "Could not complete hire.",
        });
      } finally {
        dispatch({ type: "SET_BUSY", busy: false });
      }
    },
    [
      actions,
      appState.user?.name,
      effectiveDepartmentId,
      mayaRoomId,
      mayaTopicId,
      router,
      session.brief,
      session.roleKey,
    ],
  );

  const sendUserMessage = useCallback(
    async (text: string, action: "message" | "draft_now" | "refine_section" = "message") => {
      const trimmed = text.trim();
      if (!trimmed || session.busy) return;
      dispatch({ type: "SET_ERROR", error: null });

      const isDraftNow = action === "draft_now";
      const isGenerate =
        /generate candidates/i.test(trimmed) || /show (me )?candidates/i.test(trimmed);
      const isHireRecommended =
        /hire (the )?recommended/i.test(trimmed) || /hire (them|this one)/i.test(trimmed);

      if (isGenerate && session.brief) {
        await generateCandidates();
        return;
      }

      if (isHireRecommended && session.candidates.length) {
        const rec =
          session.candidates.find((c) => c.recommended) ?? session.candidates[1];
        if (rec) await hireCandidate(rec);
        return;
      }

      if (isHiringSmallTalk(trimmed) && session.recruiterMessages.length > 0) {
        syncMessageToRoom("human", trimmed);
        const reply =
          "You're welcome — tell me more about the role whenever you're ready, or say \"Generate candidates\" when the brief looks good.";
        dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply);
        return;
      }

      if (session.recruiterMessages.length === 0) {
        syncMessageToRoom("human", trimmed);
        if (isHiringSmallTalk(trimmed)) {
          const greeting =
            "Hey — I'm Maya, your recruiting guide. Tell me what kind of AI employee you want to hire, or use a quick action above.";
          dispatch({ type: "SET_MESSAGES", messages: [{ role: "ade", text: greeting }] });
          syncMessageToRoom("ai", greeting);
          return;
        }
        await startFromUserText(trimmed);
        return;
      }

      const nextMessages = [...session.recruiterMessages, { role: "user" as const, text: trimmed }];
      const optimisticAck = pickOptimisticAck(trimmed);
      const sectionsUpdating = inferSectionsUpdating(trimmed);
      const composeSection = briefSectionToComposeKey(sectionsUpdating[0]) ?? "mission";

      syncMessageToRoom("human", trimmed);

      const localBrief = synthesizeBriefForHiringContext({
        roleSeed,
        messages: nextMessages,
        departmentId: effectiveDepartmentId,
        roleKey: session.roleKey,
        existing: session.brief ?? session.briefPartial,
      });
      dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: localBrief });

      dispatch({
        type: "SET_MESSAGES",
        messages: [...nextMessages, { role: "ade", text: optimisticAck, isOptimistic: true }],
      });
      setMayaState("acknowledging");
      setBriefUpdateState({ status: "updating", sectionsUpdating });
      setBriefCompose({ active: true, section: composeSection });
      composeTimerRef.current = setTimeout(() => {
        setBriefCompose({ active: false, section: null });
      }, 3200);
      dispatch({ type: "SET_BUSY", busy: true });

      try {
        setMayaState("thinking");
        const res = await callRecruiter(
          recruiterPayload({
            conversation: nextMessages,
            userMessage: trimmed,
            action: isDraftNow ? "draft_now" : "message",
            currentBrief: session.brief ?? session.briefPartial,
            mode: isDraftNow ? "draft_now" : "chat",
          }),
        );
        setMayaState("updating_brief");
        const nextBrief = res.brief ?? res.briefPartial ?? localBrief;
        const briefSection = detectBriefChange(prevBriefRef.current, nextBrief);
        applyRecruiterResponse(res, nextMessages);
        maybeLogBriefUpdated(
          actions,
          mayaRoomId,
          trimmed,
          briefSection,
          res.brief?.roleTitle ?? localBrief.roleTitle,
          lastBriefLogRef,
        );
        if (res.brief) dispatch({ type: "SET_BRIEF", brief: res.brief });
        if (res.canReviewBrief || res.briefReady) {
          dispatch({ type: "SET_BRIEF_READY", briefReady: true });
          setMayaState("ready_to_review");
        } else {
          setMayaState("idle");
        }
        setBriefUpdateState({
          status: "updated",
          sectionsUpdating,
          lastUpdatedAt: new Date().toISOString(),
        });
        setTimeout(() => setBriefUpdateState(INITIAL_BRIEF_UPDATE_STATE), 2400);
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
    },
    [
      applyRecruiterResponse,
      effectiveDepartmentId,
      recruiterPayload,
      roleSeed,
      session.brief,
      session.briefPartial,
      session.busy,
      session.candidates,
      session.recruiterMessages,
      session.roleKey,
      startFromUserText,
      syncMessageToRoom,
      generateCandidates,
      hireCandidate,
    ],
  );

  const goToBriefReview = useCallback(() => {
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
    dispatch({ type: "SET_BRIEF_READY", briefReady: true });
  }, [
    effectiveDepartmentId,
    roleSeed,
    session.brief,
    session.briefPartial,
    session.recruiterMessages,
    session.roleKey,
  ]);

  const extraChips = useMemo((): RecruiterSuggestionChip[] => {
    const chips = [...session.suggestionChips];
    if (session.briefReady && !chips.some((c) => c.intent === "generate_candidates")) {
      chips.unshift({
        id: "gen-candidates",
        label: "Generate candidates",
        value: "Generate candidates",
        intent: "generate_candidates",
      });
    }
    if (session.candidates.length && !chips.some((c) => c.label.includes("Hire recommended"))) {
      chips.unshift({
        id: "hire-rec",
        label: "Hire the recommended candidate",
        value: "Hire the recommended candidate",
        intent: "hire_recommended",
      });
    }
    return chips;
  }, [session.briefReady, session.candidates.length, session.suggestionChips]);

  return {
    session,
    dispatch: dispatch as React.Dispatch<import("@/lib/hiring/session").HiringAction>,
    mayaState,
    briefUpdateState,
    briefCompose,
    displayReadiness,
    previewBrief,
    generatingCandidates,
    sendUserMessage,
    generateCandidates,
    hireCandidate,
    goToBriefReview,
    extraChips,
    hasConversation: session.recruiterMessages.length > 0,
  };
}
