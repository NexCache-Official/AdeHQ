"use client";

import { MayaDmEmptyState } from "@/components/maya/MayaDmEmptyState";
import { useMayaDmHiring } from "@/components/maya/useMayaDmHiring";
import { RecruiterChat } from "@/components/hiring/RecruiterChat";

type MayaDmHiringViewProps = {
  mayaRoomId: string;
  mayaTopicId?: string;
  firstName?: string;
};

export function MayaDmHiringView({
  mayaRoomId,
  mayaTopicId,
  firstName,
}: MayaDmHiringViewProps) {
  const hiring = useMayaDmHiring({ mayaRoomId, mayaTopicId });

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
