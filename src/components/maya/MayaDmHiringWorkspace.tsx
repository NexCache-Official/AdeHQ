"use client";

import { useCallback, useRef, useState } from "react";
import { MayaGeneralChat } from "@/components/maya/MayaGeneralChat";
import { MayaDmHiringChat } from "@/components/maya/MayaDmHiringChat";
import { MayaDmHiringProvider } from "@/components/maya/MayaDmHiringContext";
import { MayaHiringPanel } from "@/components/maya/MayaHiringPanel";
import { InterviewOverlay } from "@/components/hiring/HireScreens";
import { useMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { useStore } from "@/lib/demo-store";
import { createHiringTopicForSession } from "@/lib/hiring/hiring-session-service";
import { ActionOnceGuard } from "@/lib/messaging/idempotency";
import {
  findActiveHiringTopicsForRole,
  mayaDuplicateHiringTopicMessage,
} from "@/lib/hiring/hiring-topic-utils";
import { mayaHiringTopicReadyMessage, type MayaHiringProposal } from "@/lib/hiring/maya-hiring-proposal";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { INTERVIEW_ANSWERS, INTERVIEW_QUESTIONS } from "@/lib/hiring/data";
import type { AiEmployeeApplicant, RecruiterMessage } from "@/lib/hiring/types";
import { generalTopicForRoom, isGeneralTopic, isHiringTopic } from "@/lib/topics";
import type { RoomTopic } from "@/lib/types";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MayaDmHiringLayoutProps = {
  mayaRoomId: string;
  selectedTopic?: RoomTopic;
  onSelectTopic: (topicId: string) => void;
  firstName?: string;
};

type DirectChatHiring = MayaHiringProposal & { generalTopicId: string };

function DuplicateHiringTopicPrompt({
  roleTitle,
  onContinue,
  onStartFresh,
  onCancel,
  creating = false,
}: {
  roleTitle: string;
  onContinue: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
  creating?: boolean;
}) {
  return (
    <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3">
      <p className="text-sm text-ink">{mayaDuplicateHiringTopicMessage(roleTitle)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={creating}
          onClick={onContinue}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Continue existing session
        </button>
        <button
          type="button"
          disabled={creating}
          onClick={onStartFresh}
          className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        >
          Start fresh topic
        </button>
        <button
          type="button"
          disabled={creating}
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-3 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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
          candidates={hiring.visibleCandidates}
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
            const answers =
              INTERVIEW_ANSWERS[interviewWith.id] ??
              INTERVIEW_ANSWERS[interviewWith.tier] ??
              INTERVIEW_ANSWERS.recommended;
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
  topic,
  pendingStartText,
  onPendingStartConsumed,
  firstName,
  mobileBriefOpen,
  setMobileBriefOpen,
  directChat = false,
  source,
  onCreateHiringTopicForRole,
  onNavigateToTopic,
  onExitDirectChatHiring,
}: {
  mayaRoomId: string;
  mayaTopicId: string;
  topic: RoomTopic;
  pendingStartText?: string;
  onPendingStartConsumed: () => void;
  firstName?: string;
  mobileBriefOpen: boolean;
  setMobileBriefOpen: (open: boolean) => void;
  directChat?: boolean;
  source?: "maya_direct_chat" | "maya_hiring_topic";
  onCreateHiringTopicForRole?: (params: {
    roleTitle: string;
    roleKey: string;
    userText: string;
    forceNew?: boolean;
  }) => Promise<void>;
  onNavigateToTopic?: (topicId: string) => void;
  onExitDirectChatHiring?: () => void;
}) {
  return (
    <MayaDmHiringProvider
      mayaRoomId={mayaRoomId}
      mayaTopicId={mayaTopicId}
      topic={topic}
      pendingStartText={pendingStartText}
      onPendingStartConsumed={onPendingStartConsumed}
      directChat={directChat}
      source={source}
      onCreateHiringTopicForRole={onCreateHiringTopicForRole}
      onNavigateToTopic={onNavigateToTopic}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {!directChat && (
          <div className="shrink-0 border-b border-border bg-surface px-4 py-2 text-xs text-ink-2">
            <span className="font-medium text-ink">Hiring topic</span>
            <span> — {topic.title}</span>
          </div>
        )}
        {directChat && (
          <div className="shrink-0 border-b border-accent-200/80 bg-accent-50/70 px-4 py-2 text-xs leading-relaxed text-accent-900">
            <span className="font-medium">Hiring in Direct Chat</span>
            <span className="text-accent-800">
              {" "}
              — job brief and candidates stay here until you create a dedicated hiring topic.
            </span>
            {onExitDirectChatHiring && (
              <button
                type="button"
                onClick={onExitDirectChatHiring}
                className="ml-2 font-medium text-accent-900 underline-offset-2 hover:underline"
              >
                Exit hiring
              </button>
            )}
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <MayaHiringTopicView firstName={firstName} />
        </div>
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
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false);
  const [pendingHire, setPendingHire] = useState<{ topicId: string; text: string } | null>(null);
  const [directChatHiring, setDirectChatHiring] = useState<DirectChatHiring | null>(null);
  const [directChatPendingStart, setDirectChatPendingStart] = useState<string | undefined>();
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    proposal: MayaHiringProposal;
    existingTopic: RoomTopic;
  } | null>(null);
  const topicCreateGuardRef = useRef(new ActionOnceGuard());
  const continueHereGuardRef = useRef(new ActionOnceGuard());
  const [topicCreating, setTopicCreating] = useState(false);

  const roomTopics = state.topics.filter((t) => t.roomId === mayaRoomId);
  const generalTopic = generalTopicForRoom(roomTopics, mayaRoomId);

  const showGeneral =
    !selectedTopic || (isGeneralTopic(selectedTopic) && !isHiringTopic(selectedTopic));
  const showHiring = selectedTopic && isHiringTopic(selectedTopic);

  const postTopicReadyNote = useCallback(
    (topicId: string, roleTitle: string, topicTitle: string) => {
      actions.addMessage(mayaRoomId, {
        topicId,
        senderType: "ai",
        senderId: MAYA_EMPLOYEE_ID,
        senderName: MAYA_EMPLOYEE_NAME,
        content: mayaHiringTopicReadyMessage(roleTitle, topicTitle),
      });
    },
    [actions, mayaRoomId],
  );

  const actuallyCreateHiringTopic = useCallback(
    async (proposal: MayaHiringProposal, forceNew = false) => {
      const createKey = `topic:${mayaRoomId}:${proposal.roleKey}:${proposal.roleTitle}:${forceNew ? "new" : "std"}`;
      if (!topicCreateGuardRef.current.tryBegin(createKey, { allowRetry: forceNew })) {
        return;
      }

      setTopicCreating(true);
      try {
        const topic = await createHiringTopicForSession({
          roomId: mayaRoomId,
          workspaceId: state.workspace.id,
          userId: state.user?.id,
          roleTitle: proposal.roleTitle,
          roleKey: proposal.roleKey,
          backend,
          upsertTopic: actions.upsertTopic,
          existingTopics: roomTopics,
          forceNewTitle: forceNew,
        });

        setDuplicatePrompt(null);
        setDirectChatHiring(null);
        setDirectChatPendingStart(undefined);
        setPendingHire({ topicId: topic.id, text: proposal.userText });
        onSelectTopic(topic.id);
        postTopicReadyNote(topic.id, proposal.roleTitle, topic.title);
        topicCreateGuardRef.current.complete(createKey);
      } catch (error) {
        topicCreateGuardRef.current.abort(createKey);
        throw error;
      } finally {
        setTopicCreating(false);
      }
    },
    [
      actions.upsertTopic,
      backend,
      mayaRoomId,
      onSelectTopic,
      postTopicReadyNote,
      roomTopics,
      state.user?.id,
      state.workspace.id,
    ],
  );

  const handleCreateHiringTopic = useCallback(
    async (proposal: MayaHiringProposal, forceNew = false) => {
      if (!forceNew) {
        const existing = findActiveHiringTopicsForRole(
          roomTopics,
          mayaRoomId,
          proposal.roleKey,
          proposal.roleTitle,
        );
        if (existing.length > 0) {
          setDuplicatePrompt({ proposal, existingTopic: existing[0] });
          return;
        }
      }
      await actuallyCreateHiringTopic(proposal, forceNew);
    },
    [actuallyCreateHiringTopic, mayaRoomId, roomTopics],
  );

  const handleCreateHiringTopicForRole = useCallback(
    async (params: {
      roleTitle: string;
      roleKey: string;
      userText: string;
      forceNew?: boolean;
    }) => {
      await handleCreateHiringTopic(
        {
          userText: params.userText,
          roleTitle: params.roleTitle,
          roleKey: params.roleKey,
        },
        params.forceNew ?? false,
      );
    },
    [handleCreateHiringTopic],
  );

  const handleContinueHiringHere = useCallback(
    async (proposal: MayaHiringProposal) => {
      if (!generalTopic) return;
      const continueKey = `continue:${mayaRoomId}:${proposal.roleKey}:${proposal.roleTitle}`;
      if (!continueHereGuardRef.current.tryBegin(continueKey)) return;
      try {
        setDirectChatHiring({
          ...proposal,
          generalTopicId: generalTopic.id,
        });
        setDirectChatPendingStart(proposal.userText);
        continueHereGuardRef.current.complete(continueKey);
      } catch {
        continueHereGuardRef.current.abort(continueKey);
        throw new Error("Could not continue hiring in Direct Chat.");
      }
    },
    [generalTopic, mayaRoomId],
  );

  if (directChatHiring && generalTopic) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <MayaHiringTopicShell
          mayaRoomId={mayaRoomId}
          mayaTopicId={generalTopic.id}
          topic={generalTopic}
          pendingStartText={directChatPendingStart}
          onPendingStartConsumed={() => setDirectChatPendingStart(undefined)}
          firstName={firstName}
          mobileBriefOpen={mobileBriefOpen}
          setMobileBriefOpen={setMobileBriefOpen}
          directChat
          source="maya_direct_chat"
          onCreateHiringTopicForRole={handleCreateHiringTopicForRole}
          onNavigateToTopic={onSelectTopic}
          onExitDirectChatHiring={() => {
            setDirectChatHiring(null);
            setDirectChatPendingStart(undefined);
          }}
        />
      </div>
    );
  }

  if (showGeneral) {
    if (!generalTopic && !selectedTopic) {
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-2">
          Loading Maya chat…
        </div>
      );
    }
    const topic = selectedTopic ?? generalTopic!;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {duplicatePrompt && (
          <DuplicateHiringTopicPrompt
            roleTitle={duplicatePrompt.proposal.roleTitle}
            creating={topicCreating}
            onContinue={() => {
              setDuplicatePrompt(null);
              onSelectTopic(duplicatePrompt.existingTopic.id);
            }}
            onStartFresh={() =>
              void actuallyCreateHiringTopic(duplicatePrompt.proposal, true)
            }
            onCancel={() => setDuplicatePrompt(null)}
          />
        )}
        <MayaGeneralChat
          mayaRoomId={mayaRoomId}
          topic={topic}
          firstName={firstName}
          onCreateHiringTopic={(p) => handleCreateHiringTopic(p)}
          onContinueHiringHere={handleContinueHiringHere}
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
          topic={selectedTopic}
          pendingStartText={
            pendingHire?.topicId === selectedTopic.id ? pendingHire.text : undefined
          }
          onPendingStartConsumed={() => setPendingHire(null)}
          firstName={firstName}
          mobileBriefOpen={mobileBriefOpen}
          setMobileBriefOpen={setMobileBriefOpen}
          source="maya_hiring_topic"
          onCreateHiringTopicForRole={handleCreateHiringTopicForRole}
          onNavigateToTopic={onSelectTopic}
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
        onCreateHiringTopic={handleCreateHiringTopic}
        onContinueHiringHere={handleContinueHiringHere}
      />
    </div>
  );
}
