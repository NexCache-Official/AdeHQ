"use client";

import { useState } from "react";
import { BriefDocumentPreview } from "@/components/hiring/BriefDocumentPreview";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { useOptionalMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import { initials } from "@/components/hiring/HireScreens";
import { FileText, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";

function HiringSessionCard({
  roleTitle,
  status,
  readinessLabel,
  onReviewBrief,
  onGenerateCandidates,
  generating,
  busy,
}: {
  roleTitle: string;
  status: string;
  readinessLabel: string;
  onReviewBrief?: () => void;
  onGenerateCandidates?: () => void;
  generating?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-2 w-full max-w-lg rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Hiring session
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{roleTitle}</p>
          <p className="mt-1 text-xs text-ink-2">
            {status} · {readinessLabel}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {onReviewBrief && (
              <button
                type="button"
                disabled={busy}
                onClick={onReviewBrief}
                className="rounded-lg bg-green px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Review brief
              </button>
            )}
            {onGenerateCandidates && (
              <button
                type="button"
                disabled={busy || generating}
                onClick={onGenerateCandidates}
                className="rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate candidates"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobBriefArtifactCard({
  roleTitle,
  brief,
  onReview,
  onGenerateCandidates,
  generating,
  busy,
}: {
  roleTitle: string;
  brief: import("@/lib/hiring/types").AiEmployeeJobBrief;
  onReview?: () => void;
  onGenerateCandidates?: () => void;
  generating?: boolean;
  busy?: boolean;
}) {
  const mission = brief.mission?.trim() || brief.domain?.trim() || "Role brief in progress";
  const responsibilities = (brief.coreResponsibilities ?? []).slice(0, 3);

  return (
    <div className="mt-2 w-full max-w-lg rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-2">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Job brief</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">Job Brief: {roleTitle}</p>
          <p className="mt-1 line-clamp-2 text-xs text-ink-2">{mission}</p>
          {responsibilities.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink-3">
              {responsibilities.map((r) => (
                <li key={r} className="truncate">
                  · {r}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] text-ink-3">Source: Maya hiring session</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {onReview && (
              <button
                type="button"
                disabled={busy}
                onClick={onReview}
                className="rounded-lg bg-green px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Open
              </button>
            )}
            {onGenerateCandidates && (
              <button
                type="button"
                disabled={busy || generating}
                onClick={onGenerateCandidates}
                className="rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate candidates"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateSetCard({
  candidates,
  onInterview,
  onHire,
  busy,
}: {
  candidates: AiEmployeeApplicant[];
  onInterview?: (c: AiEmployeeApplicant) => void;
  onHire?: (c: AiEmployeeApplicant) => void;
  busy?: boolean;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="mt-2 w-full max-w-2xl rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Users className="h-4 w-4 text-ink-3" />
        <p className="text-sm font-semibold text-ink">Candidate shortlist</p>
        <span className="text-xs text-ink-3">{candidates.length} candidates</span>
      </div>
      <div className="space-y-2">
        {candidates.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2.5"
          >
            <AdeOrb grad={c.grad} size={36} initials={initials(c.name)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{c.name}</p>
              <p className="truncate text-xs text-ink-2">{c.title}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {onInterview && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onInterview(c)}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-ink disabled:opacity-50"
                >
                  Interview
                </button>
              )}
              {onHire && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onHire(c)}
                  className="rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  Hire
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type MayaHiringInlineCardsProps = {
  className?: string;
  onInterviewCandidate?: (c: AiEmployeeApplicant) => void;
};

export function MayaHiringInlineCards({
  className,
  onInterviewCandidate,
}: MayaHiringInlineCardsProps) {
  const hiring = useOptionalMayaDmHiringContext();
  if (!hiring || !hiring.hasConversation) return null;

  const { session, displayReadiness, visibleCandidates, generatingCandidates } = hiring;
  const roleTitle =
    session.customRoleTitle || session.roleKey?.replace(/_/g, " ") || "AI Employee";
  const previewBrief = session.briefPartial ?? session.brief;
  const readinessLabel = displayReadiness.ready
    ? "Ready to generate"
    : displayReadiness.score >= 50
      ? "Almost ready"
      : "Gathering requirements";
  const status =
    session.step === "shortlist"
      ? "Candidates ready"
      : session.briefReady
        ? "Brief ready"
        : "In progress";

  const showBriefCard = Boolean(previewBrief && session.briefReady && displayReadiness.ready);
  const showCandidates = session.step === "shortlist" && visibleCandidates.length > 0;

  return (
    <div className={cn("mx-auto w-full max-w-3xl space-y-2 px-1 pb-3", className)}>
      <HiringSessionCard
        roleTitle={roleTitle}
        status={status}
        readinessLabel={readinessLabel}
        onReviewBrief={showBriefCard ? () => hiring.goToBriefReview() : undefined}
        onGenerateCandidates={
          displayReadiness.ready && session.step !== "shortlist"
            ? () => void hiring.generateCandidates()
            : undefined
        }
        generating={generatingCandidates}
        busy={session.busy}
      />
      {showBriefCard && session.brief && (
        <JobBriefArtifactCard
          roleTitle={roleTitle}
          brief={session.brief}
          onReview={() => hiring.goToBriefReview()}
          onGenerateCandidates={
            session.step !== "shortlist" ? () => void hiring.generateCandidates() : undefined
          }
          generating={generatingCandidates}
          busy={session.busy}
        />
      )}
      {showCandidates && (
        <CandidateSetCard
          candidates={visibleCandidates}
          onInterview={onInterviewCandidate}
          onHire={(c) => void hiring.hireCandidate(c)}
          busy={session.busy || !!session.hiredEmployeeId}
        />
      )}
      {session.brief && session.step === "brief" && (
        <div className="rounded-xl border border-border bg-canvas p-3">
          <BriefDocumentPreview brief={session.brief} />
        </div>
      )}
    </div>
  );
}
