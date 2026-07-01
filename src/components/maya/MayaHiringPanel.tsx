"use client";

import { BriefDocumentPreview } from "@/components/hiring/BriefDocumentPreview";
import { ApplicantCard } from "@/components/hiring/HireScreens";
import { Button } from "@/components/ui";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import { Loader2, Sparkles } from "lucide-react";

import type { useMayaDmHiring } from "@/components/maya/useMayaDmHiring";

type Hiring = ReturnType<typeof useMayaDmHiring>;

export function MayaHiringPanel({ hiring }: { hiring: Hiring }) {
  const {
    session,
    previewBrief,
    briefCompose,
    briefUpdateState,
    displayReadiness,
    generatingCandidates,
    generateCandidates,
    hireCandidate,
  } = hiring;

  const statusLabel =
    session.candidates.length > 0
      ? "Candidates ready"
      : session.briefReady || displayReadiness.ready
        ? "Brief ready"
        : session.recruiterMessages.length > 0
          ? "Drafting brief"
          : "Waiting to start";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Hiring session
        </div>
        <div className="mt-1 text-sm font-medium text-ink">{statusLabel}</div>
        {session.recruiterMessages.length > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${displayReadiness.score}%` }}
            />
          </div>
        )}
      </div>

      {session.error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {session.error}
        </div>
      )}

      <div className="flex-1 space-y-4 p-4">
        {previewBrief && session.recruiterMessages.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Job brief
            </h3>
            <BriefDocumentPreview
              brief={previewBrief}
              composing={session.busy || briefCompose.active}
              composingSection={briefCompose.section}
              updateState={briefUpdateState}
            />
          </section>
        )}

        {session.candidates.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Candidates
            </h3>
            <div className="space-y-3">
              {session.candidates.map((a: AiEmployeeApplicant) => (
                <div key={a.id} className="scale-[0.92] origin-top">
                  <ApplicantCard
                    applicant={a}
                    advOpen={!!session.advOpen[a.id]}
                    onToggleAdv={() => hiring.dispatch({ type: "TOGGLE_ADV", id: a.id })}
                    onInterview={() => {}}
                    onHire={() => void hireCandidate(a)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {session.briefReady && session.candidates.length === 0 && (
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
        )}
      </div>
    </div>
  );
}
