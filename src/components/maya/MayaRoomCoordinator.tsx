"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { MayaDmHiringProvider } from "@/components/maya/MayaDmHiringContext";
import { useStore } from "@/lib/demo-store";
import { createHiringTopicForSession } from "@/lib/hiring/hiring-session-service";
import { ActionOnceGuard } from "@/lib/messaging/idempotency";
import {
  findActiveHiringTopicsForRole,
  mayaDuplicateHiringTopicMessage,
} from "@/lib/hiring/hiring-topic-utils";
import {
  mayaHiringTopicReadyMessage,
  type MayaHiringProposal,
} from "@/lib/hiring/maya-hiring-proposal";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { generalTopicForRoom, isGeneralTopic, isHiringTopic } from "@/lib/topics";
import type { RoomTopic } from "@/lib/types";

type DirectChatHiring = MayaHiringProposal & { generalTopicId: string };

type MayaRoomCoordinatorValue = {
  mayaRoomId: string;
  isHiringTopic: boolean;
  isDirectChatHiring: boolean;
  duplicatePrompt: { proposal: MayaHiringProposal; existingTopic: RoomTopic } | null;
  topicCreating: boolean;
  dismissDuplicatePrompt: () => void;
  continueExistingTopic: () => void;
  startFreshTopic: () => void;
  handleCreateHiringTopic: (proposal: MayaHiringProposal, forceNew?: boolean) => Promise<void>;
  handleContinueHiringHere: (proposal: MayaHiringProposal) => Promise<void>;
  handleCreateHiringTopicForRole: (params: {
    roleTitle: string;
    roleKey: string;
    userText: string;
    forceNew?: boolean;
  }) => Promise<void>;
  pendingStartText?: string;
  onPendingStartConsumed: () => void;
  exitDirectChatHiring: () => void;
};

const MayaRoomCoordinatorContext = createContext<MayaRoomCoordinatorValue | null>(null);

export function useMayaRoomCoordinator() {
  return useContext(MayaRoomCoordinatorContext);
}

function DuplicateHiringTopicBanner({
  roleTitle,
  creating,
  onContinue,
  onStartFresh,
  onCancel,
}: {
  roleTitle: string;
  creating: boolean;
  onContinue: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50/80 px-4 py-2.5">
      <p className="text-sm text-ink">{mayaDuplicateHiringTopicMessage(roleTitle)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
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

export function MayaRoomCoordinator({
  mayaRoomId,
  selectedTopic,
  onSelectTopic,
  children,
}: {
  mayaRoomId: string;
  selectedTopic?: RoomTopic;
  onSelectTopic: (topicId: string) => void;
  children: React.ReactNode;
}) {
  const { state, actions, backend } = useStore();
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
  const isHiringTopicActive = Boolean(selectedTopic && isHiringTopic(selectedTopic));
  const isDirectChatHiring = Boolean(
    directChatHiring && generalTopic && selectedTopic && isGeneralTopic(selectedTopic),
  );

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
      if (!topicCreateGuardRef.current.tryBegin(createKey, { allowRetry: forceNew })) return;

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
      } catch {
        topicCreateGuardRef.current.abort(createKey);
        throw new Error("Could not create hiring topic.");
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
        setDirectChatHiring({ ...proposal, generalTopicId: generalTopic.id });
        setDirectChatPendingStart(proposal.userText);
        if (selectedTopic?.id !== generalTopic.id) onSelectTopic(generalTopic.id);
        continueHereGuardRef.current.complete(continueKey);
      } catch {
        continueHereGuardRef.current.abort(continueKey);
        throw new Error("Could not continue hiring in Direct Chat.");
      }
    },
    [generalTopic, mayaRoomId, onSelectTopic, selectedTopic?.id],
  );

  const coordinatorValue: MayaRoomCoordinatorValue = {
    mayaRoomId,
    isHiringTopic: isHiringTopicActive,
    isDirectChatHiring,
    duplicatePrompt,
    topicCreating,
    dismissDuplicatePrompt: () => setDuplicatePrompt(null),
    continueExistingTopic: () => {
      if (!duplicatePrompt) return;
      setDuplicatePrompt(null);
      onSelectTopic(duplicatePrompt.existingTopic.id);
    },
    startFreshTopic: () => {
      if (!duplicatePrompt) return;
      void actuallyCreateHiringTopic(duplicatePrompt.proposal, true);
    },
    handleCreateHiringTopic,
    handleContinueHiringHere,
    handleCreateHiringTopicForRole,
    pendingStartText:
      pendingHire && selectedTopic && pendingHire.topicId === selectedTopic.id
        ? pendingHire.text
        : isDirectChatHiring
          ? directChatPendingStart
          : undefined,
    onPendingStartConsumed: () => {
      setPendingHire(null);
      setDirectChatPendingStart(undefined);
    },
    exitDirectChatHiring: () => {
      setDirectChatHiring(null);
      setDirectChatPendingStart(undefined);
    },
  };

  const hiringTopicId = isHiringTopicActive
    ? selectedTopic!.id
    : isDirectChatHiring
      ? generalTopic!.id
      : undefined;

  const needsHiringProvider = Boolean(hiringTopicId && (isHiringTopicActive || isDirectChatHiring));

  const inner = (
    <>
      {duplicatePrompt && !isHiringTopicActive && (
        <DuplicateHiringTopicBanner
          roleTitle={duplicatePrompt.proposal.roleTitle}
          creating={topicCreating}
          onContinue={coordinatorValue.continueExistingTopic}
          onStartFresh={coordinatorValue.startFreshTopic}
          onCancel={coordinatorValue.dismissDuplicatePrompt}
        />
      )}
      {children}
    </>
  );

  return (
    <MayaRoomCoordinatorContext.Provider value={coordinatorValue}>
      {needsHiringProvider && hiringTopicId ? (
        <MayaDmHiringProvider
          mayaRoomId={mayaRoomId}
          mayaTopicId={hiringTopicId}
          topic={isHiringTopicActive ? selectedTopic : generalTopic}
          pendingStartText={coordinatorValue.pendingStartText}
          onPendingStartConsumed={coordinatorValue.onPendingStartConsumed}
          directChat={isDirectChatHiring}
          source={isDirectChatHiring ? "maya_direct_chat" : "maya_hiring_topic"}
          onNavigateToTopic={onSelectTopic}
          onCreateHiringTopicForRole={handleCreateHiringTopicForRole}
        >
          {inner}
        </MayaDmHiringProvider>
      ) : (
        inner
      )}
    </MayaRoomCoordinatorContext.Provider>
  );
}
