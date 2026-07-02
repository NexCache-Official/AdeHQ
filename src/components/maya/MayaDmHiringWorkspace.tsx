"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { MayaGeneralChat } from "@/components/maya/MayaGeneralChat";
import { MayaDmHiringChat } from "@/components/maya/MayaDmHiringChat";
import { MayaDmHiringProvider } from "@/components/maya/MayaDmHiringContext";
import { MayaHiringPanel } from "@/components/maya/MayaHiringPanel";
import { InterviewOverlay } from "@/components/hiring/HireScreens";
import { useMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { useStore } from "@/lib/demo-store";
import { createMayaHiringTopic } from "@/lib/hiring/maya-dm-topics";
import { inferRoleFromText } from "@/lib/hiring/role-inference";
import { getRoleByKey } from "@/lib/hiring/role-library";
import { INTERVIEW_ANSWERS, INTERVIEW_QUESTIONS } from "@/lib/hiring/data";
import type { AiEmployeeApplicant, RecruiterMessage } from "@/lib/hiring/types";
import { isGeneralTopic, isHiringTopic } from "@/lib/topics";
import type { RoomTopic } from "@/lib/types";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MayaDmHiringLayoutProps = {
  mayaRoomId: string;
  selectedTopic?: RoomTopic;
  onSelectTopic: (topicId: string) => void;
  firstName?: string;
};

function MayaHiringTopicView({ firstName }: { firstName?: string }) {
  const hiring = useMayaDmHiringContext();
  const [interviewWith, setInterviewWith] = useState<AiEmployeeApplicant | null>(null);
  const [interviewMsgs, setInterviewMsgs] = useState<RecruiterMessage[]>([]);

  const openInterview = (applicant: AiEmployeeApplicant) => {
    setInterviewWith(applicant);
    setInterviewMsgs([
      {
        role: "ade",
        text: `Hi — I'm ${applicant.name}, ${applicant.title}. Happy to give you a quick taste of how I'd work. What would you like to know?`,
      },
    ]);
  };

  return (
    <>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        <MayaDmHiringChat
          firstName={firstName}
          className="h-full min-h-0 flex-1"
          candidates={hiring.session.candidates}
          onGenerateCandidates={() => void hiring.generateCandidates()}
          onInterviewCandidate={openInterview}
          onHireCandidate={(c) => void hiring.hireCandidate(c)}
        />
      </div>
      <aside className="hidden h-full min-h-0 w-[min(400px,34vw)] shrink-0 flex-col overflow-hidden border-l border-border bg-surface md:flex">
        <MayaHiringPanel />
      </aside>
      {interviewWith && (
        <InterviewOverlay
          applicant={interviewWith}
          messages={interviewMsgs}
          onClose={() => setInterviewWith(null)}
          onHire={() => {
            void hiring.hireCandidate(interviewWith);
            setInterviewWith(null);
          }}
          onAsk={(qid) => {
            const q = INTERVIEW_QUESTIONS.find((item) => item.id === qid);
            if (!q) return;
            const answers = INTERVIEW_ANSWERS[interviewWith.id] ?? INTERVIEW_ANSWERS.recommended;
            setInterviewMsgs((prev) => [
              ...prev,
              { role: "user", text: q.label },
              { role: "ade", text: answers[qid] ?? "I'd focus on clear, actionable output for your team." },
            ]);
          }}
        />
      )}
    </>
  );
}

function MayaHiringTopicShell({
  mayaRoomId,
  mayaTopicId,
  pendingStartText,
  onPendingStartConsumed,
  firstName,
  mobileBriefOpen,
  setMobileBriefOpen,
}: {
  mayaRoomId: string;
  mayaTopicId: string;
  pendingStartText?: string;
  onPendingStartConsumed: () => void;
  firstName?: string;
  mobileBriefOpen: boolean;
  setMobileBriefOpen: (open: boolean) => void;
}) {
  return (
    <MayaDmHiringProvider
      mayaRoomId={mayaRoomId}
      mayaTopicId={mayaTopicId}
      pendingStartText={pendingStartText}
      onPendingStartConsumed={onPendingStartConsumed}
    >
      <div className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden">
        <MayaHiringTopicView firstName={firstName} />
      </div>
      <button
        type="button"
        onClick={() => setMobileBriefOpen(true)}
        className="absolute bottom-[5.5rem] right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-xs font-medium text-ink shadow-md md:hidden"
      >
        <FileText className="h-3.5 w-3.5" />
        Job brief
      </button>
      {mobileBriefOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close job brief"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileBriefOpen(false)}
          />
          <div
            className={cn(
              "absolute inset-y-0 right-0 flex w-[min(100%,420px)] flex-col bg-surface shadow-xl",
              "animate-in slide-in-from-right duration-200",
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-ink">Job brief</span>
              <button
                type="button"
                onClick={() => setMobileBriefOpen(false)}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MayaHiringPanel />
            </div>
          </div>
        </div>
      )}
    </MayaDmHiringProvider>
  );
}

export function MayaDmHiringLayout({
  mayaRoomId,
  selectedTopic,
  onSelectTopic,
  firstName,
}: MayaDmHiringLayoutProps) {
  const { state, actions, backend } = useStore();
  const router = useRouter();
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false);
  const [pendingHire, setPendingHire] = useState<{ topicId: string; text: string } | null>(null);

  const showGeneral =
    !selectedTopic || (isGeneralTopic(selectedTopic) && !isHiringTopic(selectedTopic));
  const showHiring = selectedTopic && isHiringTopic(selectedTopic);

  const handleStartHiring = useCallback(
    async (text: string) => {
      const inference = inferRoleFromText(text);
      const roleKey = inference.matches[0]?.roleKey ?? "custom";
      const roleTitle =
        inference.matches[0]?.title ??
        getRoleByKey(roleKey)?.title ??
        text.trim().slice(0, 48) ??
        "AI Employee";

      const topic = await createMayaHiringTopic({
        roomId: mayaRoomId,
        workspaceId: state.workspace.id,
        userId: state.user?.id,
        roleTitle,
        roleKey,
        backend,
        upsertTopic: actions.upsertTopic,
      });

      setPendingHire({ topicId: topic.id, text });
      onSelectTopic(topic.id);
      router.replace(`/rooms/${mayaRoomId}?topic=${topic.id}`, { scroll: false });
    },
    [actions.upsertTopic, backend, mayaRoomId, onSelectTopic, router, state.user?.id, state.workspace.id],
  );

  if (showGeneral) {
    const generalTopic = selectedTopic;
    if (!generalTopic) {
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-2">
          Loading Maya chat…
        </div>
      );
    }
    return (
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <MayaGeneralChat
          mayaRoomId={mayaRoomId}
          topic={generalTopic}
          firstName={firstName}
          onStartHiring={handleStartHiring}
        />
      </div>
    );
  }

  if (showHiring && selectedTopic) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <MayaHiringTopicShell
          mayaRoomId={mayaRoomId}
          mayaTopicId={selectedTopic.id}
          pendingStartText={
            pendingHire?.topicId === selectedTopic.id ? pendingHire.text : undefined
          }
          onPendingStartConsumed={() => setPendingHire(null)}
          firstName={firstName}
          mobileBriefOpen={mobileBriefOpen}
          setMobileBriefOpen={setMobileBriefOpen}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <MayaGeneralChat
        mayaRoomId={mayaRoomId}
        topic={selectedTopic!}
        firstName={firstName}
        onStartHiring={handleStartHiring}
      />
    </div>
  );
}
