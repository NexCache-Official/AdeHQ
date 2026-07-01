"use client";

import { MayaDmEmptyState } from "@/components/maya/MayaDmEmptyState";
import { useMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { RecruiterChat } from "@/components/hiring/RecruiterChat";

type MayaDmHiringChatProps = {
  firstName?: string;
};

export function MayaDmHiringChat({ firstName }: MayaDmHiringChatProps) {
  const hiring = useMayaDmHiringContext();

  return (
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
      emptyState={
        !hiring.hasConversation ? (
          <MayaDmEmptyState
            firstName={firstName}
            onSendMessage={(text) => void hiring.sendUserMessage(text)}
          />
        ) : null
      }
    />
  );
}
