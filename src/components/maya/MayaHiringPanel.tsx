"use client";

import { BriefDocumentPreview } from "@/components/hiring/BriefDocumentPreview";
import { ApplicantCard } from "@/components/hiring/HireScreens";
import { useMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import { Loader2, Sparkles } from "lucide-react";

export function MayaHiringPanel() {
  const hiring = useMayaDmHiringContext();
  const {
    session,
    previewBrief,
    briefCompose,
    briefUpdateState,
    displayReadiness,
    generatingCandidates,
    generateCandidates,
    hireCandidate,
    visibleCandidates,
    dispatch,
  } = hiring;

  const statusLabel =
    session.hiredEmployeeId
      ? "Hired"
      : visibleCandidates.length > 0
        ? "Candidates ready"
        : session.briefReady || displayReadiness.ready
          ? "Brief ready"
          : session.recruiterMessages.length > 0
            ? "Drafting brief"
            : "Waiting to start";

  const nextStep =
    session.hiredEmployeeId
      ? "Hire complete — open their DM to assign the first task."
      : visibleCandidates.length > 0
        ? "Review candidates and hire the best fit."
        : session.briefReady || displayReadiness.ready
          ? "Generate candidates when the brief looks good."
          : session.recruiterMessages.length > 0
            ? "Answer Maya's questions to complete the brief."
            : "Tell Maya what role you want to hire.";

  const showBrief = Boolean(previewBrief && session.recruiterMessages.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Hiring session
        </div>
        <div className="mt-1 text-sm font-medium text-ink">{statusLabel}</div>
        {session.recruiterMessages.length > 0 && (
          <>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
              <span>Readiness</span>
              <span>{Math.round(displayReadiness.score)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${displayReadiness.score}%` }}
              />
            </div>
          </>
        )}
        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-ink-2">
          <span className="font-semibold text-ink-3">Next:</span>
          <span>{nextStep}</span>
        </div>
      </div>

      {session.error && (
        <div className="mx-4 mt-3 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {session.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {displayReadiness.ready && visibleCandidates.length === 0 && (
          <div className="shrink-0 border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={() => void generateCandidates()}
              disabled={generatingCandidates || session.busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {generatingCandidates ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate 3 candidates
            </button>
          </div>
        )}

        {showBrief && (
          <section className="min-h-0 shrink-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Job brief
            </h3>
            <BriefDocumentPreview
              variant="panel"
              brief={previewBrief}
              composing={session.busy || briefCompose.active}
              composingSection={briefCompose.section}
              updateState={briefUpdateState}
            />
          </section>
        )}

        {!showBrief && session.recruiterMessages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
            <p className="text-sm text-ink-2">
              Your job brief will appear here as you describe the role in chat.
            </p>
          </div>
        )}

        {visibleCandidates.length > 0 && (
          <section className="shrink-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Candidates
            </h3>
            <div className="space-y-3">
              {visibleCandidates.map((a: AiEmployeeApplicant) => (
                <div key={a.id} className="origin-top scale-[0.92]">
                  <ApplicantCard
                    applicant={a}
                    advOpen={!!session.advOpen[a.id]}
                    onToggleAdv={() => dispatch({ type: "TOGGLE_ADV", id: a.id })}
                    onInterview={() => {}}
                    onHire={() => void hireCandidate(a)}
                    hireDisabled={session.busy || !!session.hiredEmployeeId}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
