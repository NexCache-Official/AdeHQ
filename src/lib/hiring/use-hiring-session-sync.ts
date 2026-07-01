"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useStore } from "@/lib/demo-store";
import {
  claimHireLock,
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
  dmFirst?: boolean;
};

export function useHiringSessionSync({
  mayaRoomId,
  mayaTopicId,
  dmFirst = false,
}: UseHiringSessionSyncOptions) {
  const { state: appState, backend } = useStore();
  const workspaceId = appState.workspace?.id;
  const userId = appState.user?.id;

  const sessionIdRef = useRef<string | null>(null);
  const hireInFlightRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [hydrated, setHydrated] = useState(false);

  const [session, dispatch] = useReducer(hiringReducer, null, () => {
    const cached = loadHiringSession({ dmFirst });
    if (cached) return normalizeRestoredHiringSession(cached, { dmFirst });
    return {
      ...initialHiringSession(),
      ...(dmFirst ? { step: "recruiter" as const } : {}),
    };
  });

  useEffect(() => {
    let cancelled = false;
    void loadDurableHiringSession({
      backend,
      workspaceId,
      userId,
      mayaRoomId,
      dmFirst,
    }).then((result) => {
      if (cancelled) return;
      sessionIdRef.current = result.sessionId;
      dispatch({ type: "RESTORE", state: result.state });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId, userId, mayaRoomId, dmFirst]);

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
        mayaTopicId,
        state: session,
      }).then((id) => {
        if (id) sessionIdRef.current = id;
      });
    }, 400);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [session, hydrated, backend, workspaceId, userId, mayaRoomId, mayaTopicId]);

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
      });
      sessionIdRef.current = null;
      hireInFlightRef.current = false;
    },
    [backend, workspaceId],
  );

  const resetAfterMayaHire = useCallback(() => {
    dispatch({
      type: "RESTORE",
      state: { ...initialHiringSession(), step: "recruiter" },
    });
  }, []);

  return {
    session,
    dispatch,
    hydrated,
    tryClaimHireLock,
    releaseHireLock,
    completeDurableHire,
    resetAfterMayaHire,
  };
}
