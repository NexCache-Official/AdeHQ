"use client";

import { createContext, useContext } from "react";
import { useMayaDmHiring } from "@/components/maya/useMayaDmHiring";
import type { RoomTopic } from "@/lib/types";

type MayaDmHiringValue = ReturnType<typeof useMayaDmHiring>;

const MayaDmHiringContext = createContext<MayaDmHiringValue | null>(null);

export function MayaDmHiringProvider({
  mayaRoomId,
  mayaTopicId,
  topic,
  pendingStartText,
  onPendingStartConsumed,
  directChat,
  source,
  onNavigateToTopic,
  onCreateHiringTopicForRole,
  children,
}: {
  mayaRoomId: string;
  mayaTopicId?: string;
  topic?: RoomTopic;
  pendingStartText?: string;
  onPendingStartConsumed?: () => void;
  directChat?: boolean;
  source?: "maya_direct_chat" | "maya_hiring_topic";
  onNavigateToTopic?: (topicId: string) => void;
  onCreateHiringTopicForRole?: (params: {
    roleTitle: string;
    roleKey: string;
    userText: string;
    forceNew?: boolean;
  }) => Promise<void>;
  children: React.ReactNode;
}) {
  const hiring = useMayaDmHiring({
    mayaRoomId,
    mayaTopicId,
    topic,
    pendingStartText,
    onPendingStartConsumed,
    directChat,
    source,
    onNavigateToTopic,
    onCreateHiringTopicForRole,
  });
  return (
    <MayaDmHiringContext.Provider value={hiring}>{children}</MayaDmHiringContext.Provider>
  );
}

export function useMayaDmHiringContext() {
  const ctx = useContext(MayaDmHiringContext);
  if (!ctx) {
    throw new Error("useMayaDmHiringContext must be used within MayaDmHiringProvider");
  }
  return ctx;
}

export function useOptionalMayaDmHiringContext() {
  return useContext(MayaDmHiringContext);
}
