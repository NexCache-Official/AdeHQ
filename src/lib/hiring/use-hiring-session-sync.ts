"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useStore } from "@/lib/demo-store";
import type { HiringSessionScope, HiringSessionSource } from "@/lib/hiring/canonical-session";
import {
  resolveHiringSurface,
  type HiringSurface,
} from "@/lib/hiring/hiring-session-service";
import {
  beginFreshHiringSession,
  claimHireLock,
  abandonDurableHiringSession,
  finalizeDurableHiringSession,
  loadDurableHiringSession,
  persistDurableHiringSession,
} from "@/lib/hiring/hiring-persistence";
import {
  hiringReducer,
  initialHiringSession,
  loadHiringSession,
  normalizeRestoredHiringSession,
} from "@/lib/hiring/session";
import type { HiringSessionState } from "@/lib/hiring/types";

type UseHiringSessionSyncOptions = {
  mayaRoomId: string;
  mayaTopicId?: string;
  /** Preferred — resolves scope, source, and dmFirst for a hiring surface */
  surface?: HiringSurface;
  dmFirst?: boolean;
  directChat?: boolean;
  hireRoute?: boolean;
  source?: HiringSessionSource;
  topicBootstrap?: { topicId: string; roleTitle: string; roleKey: string | null };
};

export function useHiringSessionSync({
  mayaRoomId,
  mayaTopicId,
  surface,
  dmFirst: dmFirstProp,
  directChat: directChatProp,
  hireRoute: hireRouteProp,
  source: sourceProp,
  topicBootstrap,
}: UseHiringSessionSyncOptions) {
  const surfaceConfig = useMemo(() => {
    if (!surface) return null;
    return resolveHiringSurface({ surface, mayaRoomId, mayaTopicId });
  }, [surface, mayaRoomId, mayaTopicId]);

  const dmFirst = surfaceConfig?.dmFirst ?? dmFirstProp ?? false;
  const source = surfaceConfig?.source ?? sourceProp;
  const startFresh = surfaceConfig?.startFresh ?? false;

  const { state: appState, backend } = useStore();
  const workspaceId = appState.workspace?.id;
  const userId = appState.user?.id;

  const scope = useMemo<HiringSessionScope>(
    () => ({
      ...(surfaceConfig?.scope ?? {
        mayaRoomId,
        mayaTopicId,
        directChat: directChatProp,
        hireRoute: hireRouteProp,
        source: sourceProp,
      }),
      workspaceId: workspaceId ?? null,
    }),
    [
      surfaceConfig,
      mayaRoomId,
      mayaTopicId,
      directChatProp,
      hireRouteProp,
      sourceProp,
      workspaceId,
    ],
  );

  const sessionScopeKey =
    `${workspaceId ?? "none"}:` +
    (surfaceConfig?.sessionScopeKey ??
      (mayaTopicId && !directChatProp && !hireRouteProp
        ? mayaTopicId
        : hireRouteProp
          ? "hire-route"
          : directChatProp
            ? `direct-${mayaRoomId}`
            : `room-${mayaRoomId}`));

  const sessionIdRef = useRef<string | null>(null);
  const hireInFlightRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [hydrated, setHydrated] = useState(false);

  const [session, dispatch] = useReducer(hiringReducer, null, () => {
    if (startFresh) {
      return {
        ...initialHiringSession(),
        ...(source ? { sessionSource: source } : {}),
      };
    }
    const cached = loadHiringSession({ dmFirst, scope });
    if (cached) return normalizeRestoredHiringSession(cached, { dmFirst });
    return {
      ...initialHiringSession(),
      ...(dmFirst ? { step: "recruiter" as const } : {}),
      ...(source ? { sessionSource: source } : {}),
    };
  });

  useEffect(() => {
    let cancelled = false;
    const load = startFresh
      ? beginFreshHiringSession({
          backend,
          workspaceId,
          userId,
          mayaRoomId,
          scope,
          dmFirst,
          source,
        })
      : loadDurableHiringSession({
          backend,
          workspaceId,
          userId,
          mayaRoomId,
          scope,
          dmFirst,
          topicBootstrap,
        });

    void load.then((result) => {
      if (cancelled) return;
      sessionIdRef.current = result.sessionId;
      dispatch({ type: "RESTORE", state: result.state });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId, userId, mayaRoomId, scope, dmFirst, topicBootstrap, startFresh, source]);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void persistDurableHiringSession({
        backend,
        sessionId: sessionIdRef.current,
        workspaceId,
        userId,
        mayaRoomId,
        scope,
        state: session,
      }).then((id) => {
        if (id) sessionIdRef.current = id;
      });
    }, 400);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [session, hydrated, backend, workspaceId, userId, mayaRoomId, scope]);

  const tryClaimHireLock = useCallback(async () => {
    if (hireInFlightRef.current) return false;
    if (sessionIdRef.current && backend === "supabase") {
      try {
        const locked = await claimHireLock(sessionIdRef.current);
        if (!locked) return false;
      } catch (error) {
        console.warn("[AdeHQ hiring] Hire lock failed.", error);
        return false;
      }
    }
    hireInFlightRef.current = true;
    return true;
  }, [backend]);

  const releaseHireLock = useCallback(() => {
    hireInFlightRef.current = false;
  }, []);

  const completeDurableHire = useCallback(
    async (params: {
      state: HiringSessionState;
      hiredEmployeeId: string;
      dmRoomId: string;
      candidateId: string;
    }) => {
      await finalizeDurableHiringSession({
        backend,
        sessionId: sessionIdRef.current,
        workspaceId,
        state: params.state,
        hiredEmployeeId: params.hiredEmployeeId,
        dmRoomId: params.dmRoomId,
        candidateId: params.candidateId,
        scope,
      });
      hireInFlightRef.current = false;
    },
    [backend, workspaceId, scope],
  );

  const resetAfterMayaHire = useCallback(() => {
    dispatch({
      type: "RESTORE",
      state: { ...initialHiringSession(), step: "recruiter", sessionSource: source },
    });
  }, [source]);

  const abandonSession = useCallback(async () => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    await abandonDurableHiringSession({
      backend,
      sessionId: sessionIdRef.current,
      workspaceId,
      scope,
    });
    sessionIdRef.current = null;
    dispatch({
      type: "RESTORE",
      state: {
        ...initialHiringSession(),
        ...(source ? { sessionSource: source } : {}),
      },
    });
  }, [backend, workspaceId, scope, source]);

  return {
    session,
    dispatch,
    hydrated,
    sessionId: sessionIdRef.current,
    scope,
    sessionScopeKey,
    source,
    tryClaimHireLock,
    releaseHireLock,
    completeDurableHire,
    resetAfterMayaHire,
    abandonSession,
  };
}
