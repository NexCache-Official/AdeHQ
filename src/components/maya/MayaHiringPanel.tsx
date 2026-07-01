"use client";

import { BriefDocumentPreview } from "@/components/hiring/BriefDocumentPreview";
import { ApplicantCard } from "@/components/hiring/HireScreens";
import { Button } from "@/components/ui";
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
    dispatch,
  } = hiring;

  const statusLabel =
    session.candidates.length > 0
      ? "Candidates ready"
      : session.briefReady || displayReadiness.ready
        ? "Brief ready"
        : session.recruiterMessages.length > 0
          ? "Drafting brief"
          : "Waiting to start";

  const showBrief = Boolean(previewBrief && session.recruiterMessages.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Hiring session
        </div>
        <div className="mt-1 text-sm font-medium text-ink">{statusLabel}</div>
        {session.recruiterMessages.length > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${displayReadiness.score}%` }}
            />
          </div>
        )}
      </div>

      {session.error && (
        <div className="mx-4 mt-3 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {session.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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

        {session.candidates.length > 0 && (
          <section className="shrink-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Candidates
            </h3>
            <div className="space-y-3">
              {session.candidates.map((a: AiEmployeeApplicant) => (
                <div key={a.id} className="origin-top scale-[0.92]">
                  <ApplicantCard
                    applicant={a}
                    advOpen={!!session.advOpen[a.id]}
                    onToggleAdv={() => dispatch({ type: "TOGGLE_ADV", id: a.id })}
                    onInterview={() => {}}
                    onHire={() => void hireCandidate(a)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {session.briefReady && session.candidates.length === 0 && (
          <div className="shrink-0 pt-1">
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => void generateCandidates()}
              disabled={generatingCandidates || session.busy}
            >
              {generatingCandidates ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate 3 candidates
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
