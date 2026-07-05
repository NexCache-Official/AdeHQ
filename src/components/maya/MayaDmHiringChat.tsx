"use client";

import { MayaDmEmptyState } from "@/components/maya/MayaDmEmptyState";
import { useMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { RecruiterChat } from "@/components/hiring/RecruiterChat";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import { cn } from "@/lib/utils";

type MayaDmHiringChatProps = {
  firstName?: string;
  className?: string;
  candidates?: AiEmployeeApplicant[];
  onGenerateCandidates?: () => void;
  onInterviewCandidate?: (candidate: AiEmployeeApplicant) => void;
  onHireCandidate?: (candidate: AiEmployeeApplicant) => void;
};

function RoleChangeActions() {
  const hiring = useMayaDmHiringContext();
  const change = hiring.pendingRoleChange;
  if (!change) return null;

  const newLabel = change.newRoleTitle;
  const currentLabel = change.currentRoleTitle;

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-surface px-3.5 py-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={hiring.session.busy}
          onClick={() => void hiring.handleRoleChangeAction("create_new", change)}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Create new {newLabel} topic
        </button>
        <button
          type="button"
          disabled={hiring.session.busy}
          onClick={() => void hiring.handleRoleChangeAction("change_topic", change)}
          className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        >
          Change this topic to {newLabel}
        </button>
        <button
          type="button"
          disabled={hiring.session.busy}
          onClick={() => void hiring.handleRoleChangeAction("keep_current", change)}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-3 hover:bg-muted disabled:opacity-50"
        >
          Keep {currentLabel}
        </button>
      </div>
    </div>
  );
}

export function MayaDmHiringChat({
  firstName,
  className,
  candidates,
  onGenerateCandidates,
  onInterviewCandidate,
  onHireCandidate,
}: MayaDmHiringChatProps) {
  const hiring = useMayaDmHiringContext();

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <RoleChangeActions />
      <RecruiterChat
        messages={hiring.session.recruiterMessages}
        chips={hiring.extraChips}
        readiness={hiring.displayReadiness}
        briefReady={hiring.session.briefReady || hiring.displayReadiness.ready}
        busy={hiring.session.busy || hiring.generatingCandidates}
        mayaState={hiring.mayaState}
        onSend={hiring.sendUserMessage}
        onReview={hiring.goToBriefReview}
        placeholder="What job do you need done? e.g. sales outreach, market research…"
        candidates={
          hiring.session.step === "shortlist" ? (candidates ?? hiring.visibleCandidates) : []
        }
        onGenerateCandidates={onGenerateCandidates ?? (() => void hiring.generateCandidates())}
        onInterviewCandidate={onInterviewCandidate}
        onHireCandidate={onHireCandidate ?? ((c) => void hiring.hireCandidate(c))}
        generatingCandidates={hiring.generatingCandidates}
        emptyState={
          !hiring.hasConversation ? (
            <MayaDmEmptyState
              firstName={firstName}
              onSendMessage={(text) => void hiring.sendUserMessage(text)}
            />
          ) : null
        }
      />
    </div>
  );
}
