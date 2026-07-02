"use client";

import { createContext, useContext } from "react";
import { useMayaDmHiring } from "@/components/maya/useMayaDmHiring";

type MayaDmHiringValue = ReturnType<typeof useMayaDmHiring>;

const MayaDmHiringContext = createContext<MayaDmHiringValue | null>(null);

export function MayaDmHiringProvider({
  mayaRoomId,
  mayaTopicId,
  pendingStartText,
  onPendingStartConsumed,
  children,
}: {
  mayaRoomId: string;
  mayaTopicId?: string;
  pendingStartText?: string;
  onPendingStartConsumed?: () => void;
  children: React.ReactNode;
}) {
  const hiring = useMayaDmHiring({
    mayaRoomId,
    mayaTopicId,
    pendingStartText,
    onPendingStartConsumed,
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
