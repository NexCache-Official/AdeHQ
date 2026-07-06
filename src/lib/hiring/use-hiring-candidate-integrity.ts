"use client";

import { useEffect, useMemo, useRef } from "react";
import { staleCandidatesClearedMessage } from "@/lib/hiring/candidate-validation";
import {
  candidateContextFromSession,
  visibleCandidatesForSession,
} from "@/lib/hiring/hiring-session-service";
import { clearHiringSessionCandidates } from "@/lib/hiring/hiring-persistence";
import { isPostHireHiringState, type HiringAction } from "@/lib/hiring/session";
import type { HiringSessionState } from "@/lib/hiring/types";
import type { HiringBackendMode } from "@/lib/hiring/hiring-persistence";

type UseHiringCandidateIntegrityOptions = {
  session: HiringSessionState;
  sessionId: string | null;
  backend: HiringBackendMode;
  dispatch: React.Dispatch<HiringAction>;
  onStaleCleared?: (message: string) => void;
};

/** Shared candidate validation — used by Maya DM, Maya topic, and /hire. */
export function useHiringCandidateIntegrity({
  session,
  sessionId,
  backend,
  dispatch,
  onStaleCleared,
}: UseHiringCandidateIntegrityOptions) {
  const staleHandledRef = useRef<string | null>(null);

  const candidateContext = useMemo(
    () => candidateContextFromSession(session, sessionId),
    [session, sessionId],
  );

  const visibleCandidates = useMemo(
    () => visibleCandidatesForSession(session.candidates, candidateContext),
    [session.candidates, candidateContext],
  );

  useEffect(() => {
    if (isPostHireHiringState(session)) return;

    if (session.candidates.length === 0) {
      staleHandledRef.current = null;
      return;
    }
    if (visibleCandidates.length === session.candidates.length) return;

    const signature = `${session.candidates.map((c) => c.id).join("|")}::${candidateContext.roleKey ?? ""}::${candidateContext.roleTitle ?? ""}`;
    if (staleHandledRef.current === signature) return;
    staleHandledRef.current = signature;

    if (process.env.NODE_ENV !== "production") {
      console.warn("[hiring] Cleared stale candidates that did not match the current session.", {
        sessionRoleKey: candidateContext.roleKey,
        sessionRoleTitle: candidateContext.roleTitle,
        sessionId: candidateContext.sessionId,
      });
    }

    dispatch({ type: "SET_CANDIDATES", candidates: visibleCandidates });
    if (visibleCandidates.length === 0) {
      dispatch({ type: "SET_STEP", step: session.briefReady ? "brief" : "recruiter" });
    }
    if (sessionId && backend === "supabase") {
      void clearHiringSessionCandidates(sessionId).catch(() => undefined);
    }

    const note = staleCandidatesClearedMessage(candidateContext.roleTitle);
    onStaleCleared?.(note);
  }, [
    session.candidates,
    session.briefReady,
    session.hiredEmployeeId,
    session.step,
    visibleCandidates,
    candidateContext,
    dispatch,
    sessionId,
    backend,
    onStaleCleared,
  ]);

  return { visibleCandidates, candidateContext };
}
