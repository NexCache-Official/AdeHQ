"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { synthesizeBriefForHiringContext } from "@/lib/hiring/build-brief";
import { detectBriefChange, type BriefComposeSection } from "@/lib/hiring/detect-brief-change";
import { maybeLogBriefUpdated } from "@/lib/hiring/hire-completion";
import { callRecruiter } from "@/lib/hiring/hiring-api";
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
import { classifyMayaDmIntent, workspaceGuideReply } from "@/lib/hiring/maya-dm-intent";
import {
  detectRecruiterUserIntent,
  mayaReplyForRecruiterIntent,
  shouldSkipBriefUpdateIntent,
} from "@/lib/hiring/recruiter-intents";
import type { HiringSurface } from "@/lib/hiring/hiring-session-service";
import {
  completeHireFromSession,
  generateCandidatesForSession,
  logCandidatesGeneratedForSession,
  resolveBriefForSession,
} from "@/lib/hiring/hiring-session-service";
import { useHiringCandidateIntegrity } from "@/lib/hiring/use-hiring-candidate-integrity";
import {
  ActionOnceGuard,
  createClientMessageId,
  messageSendFingerprint,
  roomHasMessageId,
  SendGuard,
} from "@/lib/messaging/idempotency";
import {
  detectInTopicRoleChange,
  mayaInTopicRoleChangeMessage,
  parseHiringTopicRole,
  type InTopicRoleChange,
} from "@/lib/hiring/hiring-topic-utils";
import { clearHiringSessionCandidates } from "@/lib/hiring/hiring-persistence";
import { updateMayaHiringTopic } from "@/lib/hiring/maya-dm-topics";
import type { RoomTopic } from "@/lib/types";
import { inferRoleFromText, inferenceOpeningMessage } from "@/lib/hiring/role-inference";
import { getRoleByKey, legacyDepartmentIdForRole } from "@/lib/hiring/role-library";
import { useHiringSessionSync } from "@/lib/hiring/use-hiring-session-sync";
import { generalTopicForRoom } from "@/lib/topics";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  RecruiterApiResponse,
  RecruiterSuggestionChip,
} from "@/lib/hiring/types";

type UseMayaDmHiringOptions = {
  mayaRoomId: string;
  mayaTopicId?: string;
  topic?: RoomTopic;
  pendingStartText?: string;
  onPendingStartConsumed?: () => void;
  directChat?: boolean;
  surface?: HiringSurface;
  source?: import("@/lib/hiring/canonical-session").HiringSessionSource;
  onNavigateToTopic?: (topicId: string) => void;
  onCreateHiringTopicForRole?: (params: {
    roleTitle: string;
    roleKey: string;
    userText: string;
    forceNew?: boolean;
  }) => Promise<void>;
};

export function useMayaDmHiring({
  mayaRoomId,
  mayaTopicId,
  topic,
  pendingStartText,
  onPendingStartConsumed,
  directChat = false,
  surface: surfaceProp,
  source: sourceProp,
  onNavigateToTopic,
  onCreateHiringTopicForRole,
}: UseMayaDmHiringOptions) {
  const surface: HiringSurface =
    surfaceProp ??
    (mayaTopicId && !directChat ? "maya_hiring_topic" : "maya_direct_chat");
  const { state: appState, actions, backend } = useStore();
  const router = useRouter();

  const topicRole = useMemo(
    () => (topic ? parseHiringTopicRole(topic) : null),
    [topic],
  );

  const topicBootstrap = useMemo(() => {
    if (!topic || directChat || !topicRole || !mayaTopicId) return undefined;
    return {
      topicId: mayaTopicId,
      roleTitle: topicRole.roleTitle,
      roleKey: topicRole.roleKey,
    };
  }, [topic, directChat, topicRole, mayaTopicId]);

  const {
    session,
    dispatch,
    sessionId,
    scope,
    sessionScopeKey,
    tryClaimHireLock,
    releaseHireLock,
    completeDurableHire,
    resetAfterMayaHire,
  } = useHiringSessionSync({
    mayaRoomId,
    mayaTopicId,
    surface,
    directChat,
    source: sourceProp,
    topicBootstrap,
  });

  const [pendingRoleChange, setPendingRoleChange] = useState<InTopicRoleChange | null>(null);

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
  const sendGuardRef = useRef(new SendGuard());
  const generateGuardRef = useRef(new ActionOnceGuard());
  const syncedRoomMessageIdsRef = useRef(new Set<string>());

  const syncMessageToRoom = useCallback(
    (role: "human" | "ai", text: string, clientMessageId?: string) => {
      const messageId = clientMessageId ?? createClientMessageId(role === "human" ? "maya-h" : "maya-a");
      const syncKey = `${mayaTopicId ?? "general"}:${messageId}`;
      if (syncedRoomMessageIdsRef.current.has(syncKey)) return;

      const room = appState.rooms.find((r) => r.id === mayaRoomId);
      if (roomHasMessageId(room?.messages, messageId)) {
        syncedRoomMessageIdsRef.current.add(syncKey);
        return;
      }

      syncedRoomMessageIdsRef.current.add(syncKey);
      const userId = appState.user?.id ?? "user";
      actions.addMessage(mayaRoomId, {
        id: messageId,
        clientMessageId: role === "human" ? messageId : undefined,
        senderType: role === "human" ? "human" : "ai",
        senderId: role === "human" ? userId : "emp-maya",
        senderName: role === "human" ? (appState.user?.name ?? "You") : "Maya",
        content: text,
        topicId: mayaTopicId,
      });
    },
    [actions, appState.rooms, appState.user, mayaRoomId, mayaTopicId],
  );

  const { visibleCandidates, candidateContext } = useHiringCandidateIntegrity({
    session,
    sessionId,
    backend,
    dispatch,
    onStaleCleared: (note) => {
      dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: note } });
      syncMessageToRoom("ai", note);
    },
  });

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
      workspaceId: appState.workspace?.id ?? null,
      hiringSessionId: sessionId ?? null,
      topicId: mayaTopicId ?? null,
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
      mayaTopicId,
      mayaRoomId,
    ],
  );

  const previewBrief = session.briefPartial ?? session.brief;
  const displayReadiness = useMemo(() => {
    const base = session.readiness;
    const canReview = session.briefReady || base.ready;
    if (!canReview) return base;
    return finalizeReadinessScore(base, previewBrief as AiEmployeeJobBrief, true);
  }, [session.readiness, session.briefReady, previewBrief]);

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
      if (res.readiness) {
        dispatch({ type: "SET_READINESS", readiness: res.readiness });
        dispatch({
          type: "SET_BRIEF_READY",
          briefReady: Boolean(res.canReviewBrief ?? res.briefReady),
        });
      }

      const nextMessages =
        appendMaya && recruiterMessage
          ? [
              ...(conversationBase ??
                session.recruiterMessages.filter((m) => !m.isOptimistic)),
              { role: "ade" as const, text: recruiterMessage },
            ]
          : (conversationBase ?? session.recruiterMessages.filter((m) => !m.isOptimistic));
      const chipBrief = res.brief ?? res.briefPartial ?? session.brief ?? session.briefPartial;
      const chipReadiness = res.readiness ?? session.readiness;
      if (chipBrief?.roleTitle && chipReadiness) {
        dispatch({
          type: "SET_SUGGESTION_CHIPS",
          chips: generateSuggestionChips(
            chipReadiness,
            chipBrief as AiEmployeeJobBrief,
            nextMessages,
            session.roleKey,
          ),
        });
      } else if (res.suggestionChips) {
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
    async (
      seed: string,
      opts?: {
        roleKey?: string | null;
        openingMessage?: string;
        userText?: string;
        skipUserMessageSync?: boolean;
      },
    ) => {
      const roleKey = opts?.roleKey ?? session.roleKey;
      const opening =
        opts?.openingMessage ??
        buildRecruiterOpeningMessage({
          roleSeed: seed,
          roleKey,
          departmentId: effectiveDepartmentId,
        });
      const userText = opts?.userText?.trim();

      dispatch({ type: "SET_STEP", step: "recruiter" });
      const localBrief = synthesizeBriefForHiringContext({
        roleSeed: seed,
        messages: userText ? [{ role: "user", text: userText }] : [],
        departmentId: effectiveDepartmentId,
        roleKey,
      });

      const openingMessages = userText
        ? [
            { role: "user" as const, text: userText },
            { role: "ade" as const, text: opening },
          ]
        : [{ role: "ade" as const, text: opening }];

      dispatch({ type: "SET_MESSAGES", messages: openingMessages });
      if (userText && !opts?.skipUserMessageSync) syncMessageToRoom("human", userText);
      syncMessageToRoom("ai", opening);

      const openingConversation = openingMessages;
      const localReadiness = assessRecruiterReadiness(openingConversation, localBrief, roleKey);
      dispatch({ type: "SET_READINESS", readiness: localReadiness });
      dispatch({
        type: "SET_SUGGESTION_CHIPS",
        chips: generateSuggestionChips(localReadiness, localBrief, openingConversation, roleKey),
      });
      prevBriefRef.current = { ...localBrief };
      dispatch({ type: "SET_BRIEF_PARTIAL", briefPartial: localBrief });
      dispatch({ type: "SET_BRIEF_READY", briefReady: false });

      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const res = await callRecruiter(
          recruiterPayload({
            roleSeed: seed,
            roleKey,
            conversation: openingConversation,
            action: "message",
          }),
        );
        const finalOpening = res.recruiterMessage ?? res.message ?? opening;
        if (finalOpening !== opening) {
          dispatch({
            type: "SET_MESSAGES",
            messages: userText
              ? [
                  { role: "user", text: userText },
                  { role: "ade", text: finalOpening },
                ]
              : [{ role: "ade", text: finalOpening }],
          });
        }
        applyRecruiterResponse(res, openingMessages, false);
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
    async (text: string, opts?: { skipUserMessageSync?: boolean }) => {
      dispatch({ type: "SET_ROLE_INPUT", roleInput: text });
      dispatch({ type: "SET_CANDIDATES", candidates: [] });
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
          userText: text,
          skipUserMessageSync: opts?.skipUserMessageSync,
        });
        return;
      }

      dispatch({ type: "SET_ROLE_KEY", roleKey: "custom" });
      dispatch({ type: "SET_CUSTOM_ROLE_TITLE", customRoleTitle: text });
      await beginRecruiter(text, {
        roleKey: "custom",
        openingMessage: inferenceOpeningMessage(text, inference),
        userText: text,
        skipUserMessageSync: opts?.skipUserMessageSync,
      });
    },
    [beginRecruiter],
  );

  const pendingStartedRef = useRef(false);
  useEffect(() => {
    if (!pendingStartText || session.recruiterMessages.length > 0) {
      return;
    }
    const startKey = `adehq-hiring-pending:${sessionScopeKey}:${pendingStartText.trim()}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(startKey)) {
      onPendingStartConsumed?.();
      return;
    }
    if (pendingStartedRef.current) return;
    pendingStartedRef.current = true;
    if (typeof window !== "undefined") sessionStorage.setItem(startKey, "1");

    void startFromUserText(pendingStartText, { skipUserMessageSync: directChat }).finally(() => {
      onPendingStartConsumed?.();
    });
  }, [
    pendingStartText,
    session.recruiterMessages.length,
    sessionScopeKey,
    startFromUserText,
    onPendingStartConsumed,
    directChat,
  ]);

  const generateCandidates = useCallback(async (forceRegenerate = false) => {
    const genKey = `gen:${sessionScopeKey}:${sessionId ?? "local"}`;
    if (generateGuardRef.current.isInFlight(genKey)) return;
    if (!forceRegenerate && visibleCandidates.length > 0) return;
    if (!generateGuardRef.current.tryBegin(genKey, { allowRetry: forceRegenerate })) return;

    if (!forceRegenerate) {
      const briefForReadiness = resolveBriefForSession(session, roleSeed, effectiveDepartmentId);
      const readyNow = assessRecruiterReadiness(
        session.recruiterMessages,
        briefForReadiness,
        session.roleKey,
      );
      if (!readyNow.ready) {
        generateGuardRef.current.abort(genKey);
        dispatch({
          type: "SET_ERROR",
          error: "Let's answer a few more questions before generating candidates.",
        });
        return;
      }
    }

    const brief = resolveBriefForSession(session, roleSeed, effectiveDepartmentId);
    if (!brief.roleTitle && !roleSeed) {
      generateGuardRef.current.abort(genKey);
      return;
    }

    dispatch({ type: "SET_BRIEF", brief });
    setGeneratingCandidates(true);
    dispatch({ type: "SET_BUSY", busy: true });

    try {
      const candidates = await generateCandidatesForSession({
        brief,
        departmentId: effectiveDepartmentId,
        roleKey: session.roleKey,
        sessionScopeKey,
        sessionId,
        roleTitle: brief.roleTitle ?? roleSeed,
        workspaceId: appState.workspace?.id ?? null,
        topicId: mayaTopicId ?? null,
        mayaRoomId,
      });
      dispatch({ type: "SET_CANDIDATES", candidates });
      dispatch({ type: "SET_STEP", step: "shortlist" });
      logCandidatesGeneratedForSession(actions, mayaRoomId, brief.roleTitle ?? roleSeed);

      const mayaNote = `I've prepared 3 candidates for ${brief.roleTitle ?? roleSeed}. Review them in the panel on the right — I'd start with the recommended option.`;
      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "ade", text: mayaNote },
      });
      const aiMsgId = createClientMessageId("maya-gen");
      syncMessageToRoom("ai", mayaNote, aiMsgId);
      generateGuardRef.current.complete(genKey);
    } catch {
      generateGuardRef.current.abort(genKey);
      throw new Error("Could not generate candidates.");
    } finally {
      setGeneratingCandidates(false);
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }, [
    actions,
    effectiveDepartmentId,
    mayaRoomId,
    roleSeed,
    session,
    sessionScopeKey,
    sessionId,
    syncMessageToRoom,
    visibleCandidates.length,
  ]);

  const hireCandidate = useCallback(
    async (candidate: AiEmployeeApplicant) => {
      const brief = session.brief;
      if (!brief || session.busy) return;

      dispatch({ type: "SET_BUSY", busy: true });
      try {
        const result = await completeHireFromSession({
          actions,
          candidate,
          session,
          sessionCandidates: visibleCandidates,
          ctx: candidateContext,
          brief,
          departmentId: effectiveDepartmentId,
          roleKey: session.roleKey,
          workspaceId: appState.workspace.id || null,
          userId: appState.user?.id,
          sessionId,
          existingMemory: appState.memory,
          userName: appState.user?.name,
          mayaRoomId,
          mayaTopicId,
          allTopics: appState.topics,
          tryClaimHireLock,
          releaseHireLock,
          completeDurableHire,
        });

        if (!result.ok) {
          dispatch({ type: "SET_ERROR", error: result.message });
          return;
        }

        resetAfterMayaHire();
        const mayaGeneral = generalTopicForRoom(appState.topics, mayaRoomId);
        if (mayaGeneral) {
          router.push(`/rooms/${mayaRoomId}?topic=${mayaGeneral.id}`);
        } else {
          router.push(`/rooms/${result.dmRoomId}`);
        }
      } catch (e) {
        releaseHireLock();
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
      appState.memory,
      appState.topics,
      appState.user?.id,
      appState.user?.name,
      appState.workspace.id,
      candidateContext,
      completeDurableHire,
      effectiveDepartmentId,
      mayaRoomId,
      mayaTopicId,
      releaseHireLock,
      resetAfterMayaHire,
      router,
      session,
      session.brief,
      session.busy,
      sessionId,
      tryClaimHireLock,
      visibleCandidates,
    ],
  );

  const changeTopicRole = useCallback(
    async (change: InTopicRoleChange) => {
      if (!topic || !mayaTopicId) return;
      dispatch({
        type: "RESET_FOR_ROLE",
        roleKey: change.newRoleKey,
        roleTitle: change.newRoleTitle,
        roleInput: change.newRoleTitle,
        departmentId: legacyDepartmentIdForRole(change.newRoleKey),
      });
      if (sessionId && backend === "supabase") {
        await clearHiringSessionCandidates(sessionId).catch(() => undefined);
      }
      const updated = await updateMayaHiringTopic({
        topicId: mayaTopicId,
        roleTitle: change.newRoleTitle,
        roleKey: change.newRoleKey,
        backend,
        upsertTopic: actions.upsertTopic,
        currentTopic: topic,
      });
      actions.upsertTopic(updated);
      const opening = buildRecruiterOpeningMessage({
        roleSeed: change.newRoleTitle,
        roleKey: change.newRoleKey,
        departmentId: legacyDepartmentIdForRole(change.newRoleKey),
      });
      const mayaReply = `Got it — I've updated this topic to ${change.newRoleTitle}. ${opening}`;
      dispatch({
        type: "SET_MESSAGES",
        messages: [
          { role: "user", text: change.userText },
          { role: "ade", text: mayaReply },
        ],
      });
      syncMessageToRoom("ai", mayaReply);
      setPendingRoleChange(null);
    },
    [actions, backend, mayaTopicId, sessionId, syncMessageToRoom, topic],
  );

  const handleRoleChangeAction = useCallback(
    async (
      action: "create_new" | "change_topic" | "keep_current",
      change: InTopicRoleChange,
    ) => {
      if (action === "keep_current") {
        setPendingRoleChange(null);
        const reply = `Sounds good — we'll keep this session focused on ${change.currentRoleTitle}.`;
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply);
        return;
      }
      if (action === "create_new") {
        setPendingRoleChange(null);
        await onCreateHiringTopicForRole?.({
          roleTitle: change.newRoleTitle,
          roleKey: change.newRoleKey,
          userText: change.userText,
          forceNew: true,
        });
        return;
      }
      await changeTopicRole(change);
    },
    [changeTopicRole, dispatch, onCreateHiringTopicForRole, syncMessageToRoom],
  );

  const sendUserMessage = useCallback(
    async (text: string, action: "message" | "draft_now" | "refine_section" = "message") => {
      const trimmed = text.trim();
      if (!trimmed || session.busy) return;

      const fingerprint = messageSendFingerprint(
        `${sessionScopeKey}:${mayaTopicId ?? "dm"}`,
        trimmed,
        "human",
      );
      if (!sendGuardRef.current.tryBegin(fingerprint)) return;

      dispatch({ type: "SET_BUSY", busy: true });
      dispatch({ type: "SET_ERROR", error: null });

      const userClientId = createClientMessageId("maya-h");

      try {
      if (topicRole && !directChat && !pendingRoleChange) {
        const roleChange = detectInTopicRoleChange(trimmed, topicRole);
        if (roleChange) {
          syncMessageToRoom("human", trimmed, userClientId);
          const mayaReply = mayaInTopicRoleChangeMessage(
            roleChange.currentRoleTitle,
            roleChange.newRoleTitle,
          );
          dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
          dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: mayaReply } });
          syncMessageToRoom("ai", mayaReply, createClientMessageId("maya-a"));
          setPendingRoleChange(roleChange);
          return;
        }
      }

      const isDraftNow = action === "draft_now";
      const userIntent = detectRecruiterUserIntent(trimmed);
      const forceGenerate = /generate candidates now|generate now/i.test(trimmed);
      const isHireRecommended =
        /hire (the )?recommended/i.test(trimmed) || /hire (them|this one)/i.test(trimmed);

      if (userIntent === "generate_candidates" && (session.brief || session.briefPartial)) {
        syncMessageToRoom("human", trimmed, userClientId);
        dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
        const reply = mayaReplyForRecruiterIntent("generate_candidates")!;
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply, createClientMessageId("maya-a"));
        dispatch({ type: "SET_BRIEF_READY", briefReady: true });
        await generateCandidates(true);
        return;
      }

      if (userIntent === "review_brief") {
        syncMessageToRoom("human", trimmed, userClientId);
        dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
        const reply = mayaReplyForRecruiterIntent("review_brief")!;
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply, createClientMessageId("maya-a"));
        const briefForReview =
          session.brief ??
          synthesizeBriefForHiringContext({
            roleSeed,
            messages: [...session.recruiterMessages, { role: "user", text: trimmed }],
            departmentId: effectiveDepartmentId,
            roleKey: session.roleKey,
            existing: session.briefPartial,
          });
        dispatch({ type: "SET_BRIEF", brief: briefForReview });
        dispatch({ type: "SET_BRIEF_READY", briefReady: true });
        return;
      }

      if (isHireRecommended && visibleCandidates.length) {
        const rec =
          visibleCandidates.find((c) => c.recommended) ?? visibleCandidates[1] ?? visibleCandidates[0];
        if (rec) await hireCandidate(rec);
        return;
      }

      if (isHiringSmallTalk(trimmed) && session.recruiterMessages.length > 0) {
        syncMessageToRoom("human", trimmed, userClientId);
        const reply =
          "You're welcome — tell me more about the role whenever you're ready, or say \"Generate candidates\" when the brief looks good.";
        dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply, createClientMessageId("maya-a"));
        return;
      }

      if (session.recruiterMessages.length === 0) {
        const intent = classifyMayaDmIntent(trimmed);
        if (intent === "workspace_guide") {
          syncMessageToRoom("human", trimmed, userClientId);
          const reply = workspaceGuideReply(trimmed, appState.user?.name?.split(" ")[0]);
          dispatch({ type: "SET_MESSAGES", messages: [{ role: "user", text: trimmed }, { role: "ade", text: reply }] });
          syncMessageToRoom("ai", reply, createClientMessageId("maya-a"));
          return;
        }
        if (isHiringSmallTalk(trimmed)) {
          syncMessageToRoom("human", trimmed, userClientId);
          const greeting =
            "Hey — I'm Maya, your recruiting guide. Tell me what kind of AI employee you want to hire.";
          dispatch({ type: "SET_MESSAGES", messages: [{ role: "user", text: trimmed }, { role: "ade", text: greeting }] });
          syncMessageToRoom("ai", greeting, createClientMessageId("maya-a"));
          return;
        }
        syncMessageToRoom("human", trimmed, userClientId);
        await startFromUserText(trimmed, { skipUserMessageSync: true });
        return;
      }

      const midIntent = classifyMayaDmIntent(trimmed, {
        inHiringTopic: true,
        hasHiringMessages: session.recruiterMessages.length > 0,
      });
      if (midIntent === "workspace_guide") {
        syncMessageToRoom("human", trimmed, userClientId);
        const reply = workspaceGuideReply(trimmed, appState.user?.name?.split(" ")[0]);
        dispatch({ type: "ADD_MESSAGE", message: { role: "user", text: trimmed } });
        dispatch({ type: "ADD_MESSAGE", message: { role: "ade", text: reply } });
        syncMessageToRoom("ai", reply, createClientMessageId("maya-a"));
        return;
      }

      const nextMessages = [...session.recruiterMessages, { role: "user" as const, text: trimmed }];
      const skipBriefUi = shouldSkipBriefUpdateIntent(userIntent);
      const optimisticAck = pickOptimisticAck(trimmed);
      const sectionsUpdating = skipBriefUi ? [] : inferSectionsUpdating(trimmed);
      const composeSection = briefSectionToComposeKey(sectionsUpdating[0]) ?? "mission";

      syncMessageToRoom("human", trimmed, userClientId);

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
      if (!skipBriefUi) {
        setMayaState("acknowledging");
        setBriefUpdateState({ status: "updating", sectionsUpdating });
        setBriefCompose({ active: true, section: composeSection });
        composeTimerRef.current = setTimeout(() => {
          setBriefCompose({ active: false, section: null });
        }, 3200);
      } else {
        setMayaState(userIntent === "generate_candidates" ? "ready_to_review" : "thinking");
      }

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
        if (res.canReviewBrief ?? res.briefReady) {
          dispatch({ type: "SET_BRIEF_READY", briefReady: true });
          setMayaState("ready_to_review");
        } else {
          dispatch({ type: "SET_BRIEF_READY", briefReady: false });
          setMayaState("idle");
        }
        if (!skipBriefUi) {
          setBriefUpdateState({
            status: "updated",
            sectionsUpdating,
            lastUpdatedAt: new Date().toISOString(),
          });
          setTimeout(() => setBriefUpdateState(INITIAL_BRIEF_UPDATE_STATE), 2400);
        }
        if (userIntent === "generate_candidates") {
          await generateCandidates(true);
        }
      } catch (e) {
        setMayaState("error");
        setBriefUpdateState({ status: "error", sectionsUpdating: [] });
        dispatch({
          type: "SET_ERROR",
          error: e instanceof Error ? e.message : "Message failed.",
        });
      }
      } finally {
        sendGuardRef.current.end();
        dispatch({ type: "SET_BUSY", busy: false });
      }
    },
    [
      applyRecruiterResponse,
      appState.user?.name,
      directChat,
      effectiveDepartmentId,
      pendingRoleChange,
      recruiterPayload,
      roleSeed,
      session.brief,
      session.briefPartial,
      session.busy,
      session.candidates,
      session.recruiterMessages,
      session.roleKey,
      startFromUserText,
      sessionScopeKey,
      syncMessageToRoom,
      topicRole,
      generateCandidates,
      hireCandidate,
      visibleCandidates,
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
    const canReview = session.briefReady || displayReadiness.ready;
    if (canReview && !chips.some((c) => c.intent === "review_brief")) {
      chips.unshift({
        id: "review-brief",
        label: "Review job brief",
        value: "Review job brief",
        intent: "review_brief",
      });
    }
    if (displayReadiness.ready && !chips.some((c) => c.intent === "generate_candidates")) {
      chips.unshift({
        id: "gen-candidates",
        label: "Generate candidates",
        value: "Generate candidates",
        intent: "generate_candidates",
      });
    }
    if (visibleCandidates.length && !chips.some((c) => c.label.includes("Hire recommended"))) {
      chips.unshift({
        id: "hire-rec",
        label: "Hire the recommended candidate",
        value: "Hire the recommended candidate",
        intent: "hire_recommended",
      });
    }
    return chips;
  }, [displayReadiness.ready, session.briefReady, visibleCandidates.length, session.suggestionChips]);

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
    visibleCandidates,
    hasConversation: session.recruiterMessages.length > 0,
    pendingRoleChange,
    handleRoleChangeAction,
    topicRole,
  };
}
