"use client";

import { useCallback, useState } from "react";
import { callCandidateInterview, type HiringApiContext } from "./hiring-api";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, RecruiterMessage } from "./types";

type UseCandidateInterviewOptions = {
  getBrief: () => AiEmployeeJobBrief | undefined;
  hiringContext?: HiringApiContext;
};

export function useCandidateInterview({ getBrief, hiringContext }: UseCandidateInterviewOptions) {
  const [interviewBusy, setInterviewBusy] = useState(false);

  const askInterviewQuestion = useCallback(
    async (
      applicant: AiEmployeeApplicant,
      question: string,
      messages: RecruiterMessage[],
      onMessages: (next: RecruiterMessage[]) => void,
    ) => {
      const trimmed = question.trim();
      const brief = getBrief();
      if (!trimmed || interviewBusy || !brief) return;

      const withUser: RecruiterMessage[] = [...messages, { role: "user", text: trimmed }];
      onMessages([...withUser, { role: "ade", text: "…", isOptimistic: true }]);
      setInterviewBusy(true);

      try {
        const result = await callCandidateInterview(
          {
            applicant,
            brief,
            conversation: withUser,
            question: trimmed,
          },
          hiringContext,
        );
        onMessages([...withUser, { role: "ade", text: result.reply }]);
      } catch {
        onMessages([
          ...withUser,
          {
            role: "ade",
            text: "Sorry — I couldn't reach the model just now. Try that question again.",
          },
        ]);
      } finally {
        setInterviewBusy(false);
      }
    },
    [getBrief, hiringContext, interviewBusy],
  );

  return { askInterviewQuestion, interviewBusy };
}

export function initialInterviewMessages(applicant: AiEmployeeApplicant): RecruiterMessage[] {
  return [
    {
      role: "ade",
      text: `Hi — I'm ${applicant.name}, ${applicant.title}. Ask me anything about how I'd approach this role — I'll answer the way I would once hired.`,
    },
  ];
}
