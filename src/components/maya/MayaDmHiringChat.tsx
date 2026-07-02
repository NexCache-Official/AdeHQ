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
      <RecruiterChat
        messages={hiring.session.recruiterMessages}
        chips={hiring.extraChips}
        readiness={hiring.displayReadiness}
        briefReady={hiring.session.briefReady}
        busy={hiring.session.busy || hiring.generatingCandidates}
        mayaState={hiring.mayaState}
        onSend={hiring.sendUserMessage}
        onReview={hiring.goToBriefReview}
        placeholder="What job do you need done? e.g. sales outreach, market research…"
        candidates={candidates ?? hiring.session.candidates}
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
